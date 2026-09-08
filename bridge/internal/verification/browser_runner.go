package verification

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	bridgeruntime "convenewire.dev/bridge/internal/runtime"
)

func (r Runner) runBrowser(ctx context.Context, profile ResolvedProfile, workspace, root string) (result Result, retErr error) {
	if profile.Browser == nil || !browserExecutableName(profile.Executable) || validateBrowserSpec(*profile.Browser) != nil || len(profile.Arguments) != 0 {
		return result, ErrProfileInvalid
	}
	spec := *profile.Browser
	report := BrowserReport{Version: 1, Kind: "browser", Startup: "not_run", PageLoad: "not_run", Steps: []BrowserStepResult{},
		Screenshot: BrowserScreenshot{State: "not_requested"}, VisualReview: "not_performed", Cleanup: "pending", Reason: "startup_failed"}
	if spec.Screenshot {
		report.Screenshot.State = "not_run"
	}
	result.StartedAt = r.now()
	result.Outcome = OutcomeFailed
	runCtx, cancel := context.WithTimeout(ctx, profile.Timeout)
	defer cancel()
	var site *browserSite
	var browser *browserCDP
	var profileRoot string
	var wait <-chan error
	var stopProcess func() error
	spawned := false
	stdout := &boundedBuffer{limit: 16 << 10, cancel: cancel}
	stderr := &boundedBuffer{limit: 16 << 10, cancel: cancel}
	defer func() {
		if wait != nil {
			select {
			case processErr := <-wait:
				wait = nil
				if processErr != nil {
					report.ProcessExit = processErr.Error()
					if result.Outcome == OutcomePassed {
						result.Outcome = OutcomeFailed
						report.Reason = "browser_exited"
					}
				}
			default:
			}
		}
		if browser != nil {
			_ = browser.connection.CloseNow()
		}
		cancel()
		if spawned && stopProcess != nil {
			if err := stopProcess(); err != nil && !errors.Is(err, os.ErrProcessDone) {
				retErr = errors.Join(retErr, err)
			}
		}
		if wait != nil {
			<-wait
		}
		report.Cleanup = "completed"
		if profileRoot != "" {
			if err := os.RemoveAll(profileRoot); err != nil {
				retErr = errors.Join(retErr, err)
				report.Cleanup = "failed"
				result.Outcome = OutcomeUnknown
				report.Reason = "cleanup_failed"
			}
		}
		if site != nil {
			if err := site.close(); err != nil {
				report.Cleanup = "failed"
				result.Outcome = OutcomeUnknown
				report.Reason = "cleanup_failed"
			}
		}
		if errors.Is(ctx.Err(), context.Canceled) {
			result.Outcome = OutcomeCanceled
			report.Reason = "canceled"
		} else if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
			result.Outcome = OutcomeTimeout
			report.Reason = "timed_out"
		}
		out, truncated := stdout.snapshot()
		errout, errTruncated := stderr.snapshot()
		if truncated || errTruncated {
			result.Outcome = OutcomeFailed
			report.Reason = "diagnostic_limit"
		}
		result.FinishedAt = r.now()
		result.DurationMilliseconds = max(0, result.FinishedAt.Sub(result.StartedAt).Milliseconds())
		// Temporary-directory removal is owned by WithRunRoot and remains a
		// separate returned error if it fails after this process/listener drain.
		var envelope map[string]any
		_ = json.Unmarshal(verificationLog(out, errout, truncated || errTruncated, spawned, workspace, root), &envelope)
		envelope["browser"] = report
		result.Log, _ = json.Marshal(envelope)
		if int64(len(result.Log)) > profile.OutputLimitBytes {
			report.Screenshot = BrowserScreenshot{State: "output_limit"}
			report.Reason = "output_limit"
			result.Outcome = OutcomeFailed
			envelope["browser"] = report
			envelope["stdout"] = ""
			envelope["stderr"] = ""
			envelope["truncated"] = true
			result.Log, _ = json.Marshal(envelope)
			if int64(len(result.Log)) > profile.OutputLimitBytes {
				report.Steps = []BrowserStepResult{}
				envelope["browser"] = report
				result.Log, _ = json.Marshal(envelope)
			}
		}
		if result.Outcome == OutcomePassed {
			code := 0
			result.ExitCode = &code
		} else if result.Outcome == OutcomeFailed {
			code := 1
			result.ExitCode = &code
		}
	}()
	var err error
	site, err = openBrowserSite(workspace, spec.DocumentRoot)
	if err != nil {
		report.Reason = "candidate_unavailable"
		return result, nil
	}
	profileRoot, err = os.MkdirTemp(root, "browser-profile-")
	if err != nil {
		return result, err
	}
	// Native sandbox stays enabled. The browser is a separately owner-approved
	// verifier, with one exact loopback candidate origin and no inherited profile.
	arguments := []string{profile.Executable, "--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
		"--disable-background-networking", "--disable-component-update", "--disable-extensions", "--disable-sync", "--disable-default-apps",
		"--disable-features=MediaRouter,OptimizationHints", "--disable-quic", "--disable-breakpad", "--metrics-recording-only",
		"--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
		"--proxy-server=" + site.proxy, "--proxy-bypass-list=<-loopback>", "--user-data-dir=" + profileRoot,
		"--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", "--window-size=" + fmt.Sprint(spec.Width) + "," + fmt.Sprint(spec.Height), "about:blank"}
	command, managed, err := bridgeruntime.NewOwnedCommand(runCtx, arguments)
	if err != nil {
		return result, err
	}
	command.Dir = workspace
	stopProcess = command.Cancel
	command.Env = verificationEnvironment(profile.EnvironmentNames, root)
	command.Stdout = stdout
	command.Stderr = stderr
	if err = managed.Start(); err != nil {
		report.Startup = "failed"
		return result, nil
	}
	spawned = true
	done := make(chan error, 1)
	wait = done
	go func() { done <- managed.Wait() }()
	address, err := browserDebuggerAddress(runCtx, profileRoot, done)
	if err != nil {
		// The address helper may observe process exit; retain the consumed result
		// for the common drain path without ever starting a second process.
		report.Startup = "failed"
		return result, nil
	}
	browser, err = dialBrowserCDP(runCtx, address)
	if err != nil {
		report.Startup = "failed"
		return result, nil
	}
	var target struct {
		TargetID string `json:"targetId"`
	}
	if browser.call(runCtx, "Target.createTarget", map[string]any{"url": "about:blank"}, &target) != nil {
		report.Startup = "failed"
		return result, nil
	}
	var attached struct {
		SessionID string `json:"sessionId"`
	}
	if browser.call(runCtx, "Target.attachToTarget", map[string]any{"targetId": target.TargetID, "flatten": true}, &attached) != nil {
		report.Startup = "failed"
		return result, nil
	}
	browser.session = attached.SessionID
	report.Startup = "passed"
	for _, method := range []string{"Page.enable", "Network.enable"} {
		if browser.call(runCtx, method, map[string]any{}, nil) != nil {
			return result, nil
		}
	}
	if browser.call(runCtx, "Emulation.setDeviceMetricsOverride", map[string]any{"width": spec.Width, "height": spec.Height, "deviceScaleFactor": 1, "mobile": false}, nil) != nil {
		return result, nil
	}
	var navigation struct {
		ErrorText string `json:"errorText"`
	}
	targetURL := site.origin + spec.StartPath
	report.PageLoad = "failed"
	report.Reason = "page_load_failed"
	if browser.call(runCtx, "Page.navigate", map[string]any{"url": targetURL}, &navigation) != nil || navigation.ErrorText != "" {
		return result, nil
	}
	encodedURL, _ := json.Marshal(targetURL)
	if err = browserWait(runCtx, func() (bool, error) {
		return browser.evaluate(runCtx, `document.readyState==='complete' && location.href===`+string(encodedURL))
	}); err != nil {
		return result, nil
	}
	if browser.documentStatus < 200 || browser.documentStatus >= 400 {
		return result, nil
	}
	report.PageLoad = "passed"
	report.Reason = "assertion_failed"
	passed := true
	for _, step := range spec.Steps {
		stepCtx, stop := context.WithTimeout(runCtx, 5*time.Second)
		if step.Action == "click" || step.Action == "fill" {
			var success bool
			success, err = browser.evaluate(stepCtx, browserStepExpression(step))
			if err == nil && !success {
				err = fmt.Errorf("element unavailable")
			}
		} else {
			err = browserWait(stepCtx, func() (bool, error) { return browser.evaluate(stepCtx, browserStepExpression(step)) })
		}
		stop()
		state := "passed"
		if err != nil {
			state = "failed"
			passed = false
		}
		report.Steps = append(report.Steps, BrowserStepResult{Action: step.Action, Selector: step.Selector, State: state})
		if !passed {
			break
		}
	}
	if spec.Screenshot {
		report.Screenshot.State = "failed"
		var screenshot struct {
			Data string `json:"data"`
		}
		if err = browser.call(runCtx, "Page.captureScreenshot", map[string]any{"format": "png", "fromSurface": true, "captureBeyondViewport": false}, &screenshot); err == nil {
			if int64(len(screenshot.Data)) < profile.OutputLimitBytes-8192 {
				data, err := base64.StdEncoding.DecodeString(screenshot.Data)
				if err == nil && len(data) > 8 && string(data[:8]) == "\x89PNG\r\n\x1a\n" {
					digest := sha256.Sum256(data)
					report.Screenshot = BrowserScreenshot{State: "captured", MIMEType: "image/png", SHA256: hex.EncodeToString(digest[:]), Data: screenshot.Data}
				}
			} else {
				report.Screenshot.State = "output_limit"
			}
		}
		if report.Screenshot.State != "captured" {
			passed = false
			report.Reason = "screenshot_failed"
		}
	}
	if passed {
		result.Outcome = OutcomePassed
		report.Reason = "passed"
	}
	return result, nil
}

var debuggerPath = regexp.MustCompile(`^/devtools/browser/[A-Za-z0-9-]{8,128}$`)

func browserDebuggerAddress(ctx context.Context, root string, done chan error) (string, error) {
	var address string
	err := browserWait(ctx, func() (bool, error) {
		select {
		case err := <-done:
			done <- err
			return false, fmt.Errorf("browser exited before readiness")
		default:
		}
		file := filepath.Join(root, "DevToolsActivePort")
		info, err := os.Lstat(file)
		if errors.Is(err, os.ErrNotExist) {
			return false, nil
		}
		if err != nil || !info.Mode().IsRegular() || info.Size() > 512 {
			return false, fmt.Errorf("invalid browser endpoint")
		}
		raw, err := os.ReadFile(file)
		if err != nil {
			return false, err
		}
		parts := strings.Split(strings.TrimSpace(string(raw)), "\n")
		if len(parts) != 2 {
			return false, nil
		}
		port, err := strconv.Atoi(parts[0])
		if err != nil || port < 1 || port > 65535 || !debuggerPath.MatchString(parts[1]) {
			return false, fmt.Errorf("invalid browser endpoint")
		}
		address = "ws://127.0.0.1:" + parts[0] + parts[1]
		return true, nil
	})
	return address, err
}

func browserWait(ctx context.Context, check func() (bool, error)) error {
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		done, err := check()
		if err != nil {
			return err
		}
		if done {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}
