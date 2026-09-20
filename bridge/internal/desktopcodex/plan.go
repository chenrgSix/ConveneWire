// Package desktopcodex provides the opt-in, local desktop startup boundary.
// It does not authorize or execute Room adoption operations.
package desktopcodex

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"convenewire.dev/bridge/internal/privatefs"
)

const ConfigEnvironment = "CONVENE_WIRE_CODEX_PROXY_PLAN"

type PinnedFile struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}

// Plan is an immutable owner-local launch configuration, never a Room payload.
type Plan struct {
	Version  int        `json:"version"`
	Desktop  PinnedFile `json:"desktop"`
	Archive  PinnedFile `json:"archive"`
	Provider PinnedFile `json:"provider"`
}

func pin(name string, executable bool) (PinnedFile, error) {
	if !filepath.IsAbs(name) || strings.ContainsAny(name, "\x00\r\n") {
		return PinnedFile{}, errors.New("desktop startup requires absolute file paths")
	}
	canonical, err := filepath.EvalSymlinks(name)
	if err != nil {
		return PinnedFile{}, errors.New("desktop startup file is unavailable")
	}
	file, err := os.Open(canonical)
	if err != nil {
		return PinnedFile{}, errors.New("desktop startup file cannot be opened")
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0022 != 0 || (executable && info.Mode().Perm()&0111 == 0) {
		return PinnedFile{}, errors.New("desktop startup requires protected regular binaries")
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return PinnedFile{}, errors.New("desktop startup file cannot be verified")
	}
	return PinnedFile{Path: canonical, SHA256: hex.EncodeToString(hash.Sum(nil))}, nil
}

func (p Plan) Bundle() string {
	return filepath.Dir(filepath.Dir(filepath.Dir(p.Desktop.Path)))
}

func (p Plan) validate() error {
	if p.Version != 1 || filepath.Base(filepath.Dir(p.Desktop.Path)) != "MacOS" ||
		filepath.Base(filepath.Dir(filepath.Dir(p.Desktop.Path))) != "Contents" || filepath.Ext(p.Bundle()) != ".app" {
		return errors.New("unsupported desktop launch plan")
	}
	resources := filepath.Join(p.Bundle(), "Contents", "Resources")
	if p.Provider.Path != filepath.Join(resources, "codex") || p.Archive.Path != filepath.Join(resources, "app.asar") {
		return errors.New("desktop and provider must belong to the same app bundle")
	}
	for _, item := range []PinnedFile{p.Desktop, p.Archive, p.Provider} {
		digest, err := hex.DecodeString(item.SHA256)
		if err != nil || len(digest) != sha256.Size || item.SHA256 != strings.ToLower(item.SHA256) ||
			!filepath.IsAbs(item.Path) || filepath.Clean(item.Path) != item.Path {
			return errors.New("invalid desktop launch fingerprint")
		}
	}
	return nil
}

func Prepare(desktopExecutable, target string) (Plan, error) {
	desktop, err := pin(desktopExecutable, true)
	if err != nil {
		return Plan{}, err
	}
	bundle := filepath.Dir(filepath.Dir(filepath.Dir(desktop.Path)))
	provider, err := pin(filepath.Join(bundle, "Contents", "Resources", "codex"), true)
	if err != nil {
		return Plan{}, err
	}
	archive, err := pin(filepath.Join(bundle, "Contents", "Resources", "app.asar"), false)
	if err != nil {
		return Plan{}, err
	}
	plan := Plan{Version: 1, Desktop: desktop, Archive: archive, Provider: provider}
	if err := plan.validate(); err != nil {
		return Plan{}, err
	}
	if !filepath.IsAbs(target) {
		return Plan{}, errors.New("launch plan path must be absolute")
	}
	if err := privatefs.EnsureDirectory(filepath.Dir(target)); err != nil {
		return Plan{}, fmt.Errorf("protect desktop launch directory: %w", err)
	}
	data, err := json.MarshalIndent(plan, "", "  ")
	if err != nil {
		return Plan{}, err
	}
	if err := privatefs.WriteFile(target, append(data, '\n')); err != nil {
		return Plan{}, fmt.Errorf("create immutable desktop launch plan: %w", err)
	}
	return plan, nil
}

func LoadVerified(target, proxyExecutable string) (Plan, error) {
	if !filepath.IsAbs(target) || !filepath.IsAbs(proxyExecutable) {
		return Plan{}, errors.New("explicit absolute launch plan and proxy paths are required")
	}
	data, err := privatefs.ReadFile(target, 16<<10)
	if err != nil {
		return Plan{}, fmt.Errorf("read private desktop launch plan: %w", err)
	}
	var plan Plan
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&plan); err != nil {
		return Plan{}, errors.New("invalid desktop launch plan JSON")
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return Plan{}, errors.New("desktop launch plan contains trailing data")
	}
	if err := plan.validate(); err != nil {
		return Plan{}, err
	}
	for index, expected := range []PinnedFile{plan.Desktop, plan.Archive, plan.Provider} {
		actual, err := pin(expected.Path, index != 1)
		if err != nil || actual != expected {
			return Plan{}, errors.New("desktop or Codex changed; validate compatibility and prepare a new launch plan")
		}
	}
	proxy, err := pin(proxyExecutable, true)
	if err != nil {
		return Plan{}, err
	}
	if proxy.Path == plan.Provider.Path || proxy.SHA256 == plan.Provider.SHA256 {
		return Plan{}, errors.New("recursive desktop proxy target is not allowed")
	}
	return plan, nil
}

// ValidateArguments restricts this entry to the desktop's version and stdio
// app-server invocations. No network listener or daemon can be started here.
func ValidateArguments(args []string) error {
	if len(args) == 1 && (args[0] == "--version" || args[0] == "-V") {
		return nil
	}
	server := false
	for index := 0; index < len(args); index++ {
		arg := args[index]
		switch {
		case arg == "app-server" && !server:
			server = true
		case arg == "-c" || arg == "--config" || arg == "--enable" || arg == "--disable":
			index++
			if index >= len(args) || args[index] == "" {
				return errors.New("desktop provider option omitted its value")
			}
		case strings.HasPrefix(arg, "--config=") || strings.HasPrefix(arg, "--enable=") || strings.HasPrefix(arg, "--disable="):
			if strings.HasSuffix(arg, "=") {
				return errors.New("desktop provider option omitted its value")
			}
		case server && arg == "--analytics-default-enabled":
		case server && arg == "--listen=stdio://":
		case server && arg == "--listen" && index+1 < len(args) && args[index+1] == "stdio://":
			index++
		default:
			return errors.New("desktop proxy only supports version checks and stdio app-server")
		}
	}
	if !server {
		return errors.New("desktop proxy requires an app-server invocation")
	}
	return nil
}

// ProviderEnvironment retains the desktop's profile and tool-host environment.
// Resource discovery must resolve to the actual provider, not this proxy.
func ProviderEnvironment(environment []string, provider string) []string {
	result := make([]string, 0, len(environment)+1)
	for _, entry := range environment {
		key, _, _ := strings.Cut(entry, "=")
		if key != "CODEX_CLI_PATH" && key != ConfigEnvironment {
			result = append(result, entry)
		}
	}
	return append(result, "CODEX_CLI_PATH="+provider)
}
