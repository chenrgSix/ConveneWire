package runtime

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	"convenewire.dev/bridge/internal/durablefs"
	contracts "convenewire.dev/contracts/generated/go"
)

// PrivateOutputAdapter is a transport boundary, not an OS sandbox or an egress
// policy for arbitrary child-process network access. The owner controls Runtime tools.
type PrivateOutputAdapter struct {
	Inner   Adapter
	DataDir string
}

func (a PrivateOutputAdapter) Name() string             { return a.Inner.Name() }
func (a PrivateOutputAdapter) OwnerPrivateOutput() bool { return true }
func (a PrivateOutputAdapter) Capabilities() Capabilities {
	return Capabilities{SupportsInterrupt: a.Inner.Capabilities().SupportsInterrupt}
}
func PrivateOutputError() *contracts.ConveneWireError {
	return &contracts.ConveneWireError{Code: "PRIVATE_OUTPUT_WITHHELD", Message: "Private output remains on the owner device.", Retryable: false}
}
func (a PrivateOutputAdapter) Execute(ctx context.Context, request Request, emit EmitFunc) error {
	if request.Run.OwnerPrivateOutput == nil || !*request.Run.OwnerPrivateOutput ||
		(request.Run.ContextManifest != nil && request.Run.ContextManifest.Execution != nil) {
		return errors.New("private output delivery mode mismatch")
	}
	// Native resume is disabled as well as its advertised capability. A private
	// transcript must never be handed to an ordinary execution after a mode change.
	request.Run.Session = nil
	var candidate string
	terminal := false
	var transportError error
	safeEmit := func(c context.Context, status contracts.RunExecutionStatus, failure bool) error {
		event := Event{Status: &status}
		if failure {
			event.Error = PrivateOutputError()
		}
		err := emit(c, event)
		if err != nil {
			transportError = err
		}
		return err
	}
	err := a.Inner.Execute(ctx, request, func(c context.Context, event Event) error {
		if terminal {
			return nil
		}
		if event.Reply != "" {
			if !utf8.ValidString(event.Reply) || len(event.Reply) > 64<<10 {
				return errors.New("private candidate exceeds local bound")
			}
			candidate = strings.TrimSpace(event.Reply)
		}
		if event.Status == nil {
			return nil
		}
		status := *event.Status
		switch status {
		case contracts.Completed:
			terminal = true
			if candidate == "" || StorePrivateCandidate(a.DataDir, request.Run.RunID, []byte(candidate)) != nil {
				return safeEmit(c, contracts.Failed, true)
			}
			return safeEmit(c, status, false)
		case contracts.Failed, contracts.OutcomeUnknown, contracts.InputRequired:
			terminal = true
			if status == contracts.InputRequired {
				status = contracts.Failed
			}
			return safeEmit(c, status, true)
		case contracts.Canceled:
			terminal = true
			return safeEmit(c, status, false)
		case contracts.Working:
			return safeEmit(c, status, false)
		default:
			return errors.New("unsupported private Runtime status")
		}
	})
	if transportError != nil {
		return transportError
	}
	if !terminal {
		status := contracts.OutcomeUnknown
		if ctx.Err() != nil {
			status = contracts.Canceled
		}
		// Never send a Runtime error string, stderr, clarification, or native session.
		return safeEmit(context.WithoutCancel(ctx), status, status != contracts.Canceled)
	}
	_ = err
	return nil
}

func PrivateCandidatePath(dataDir, runID string) (string, error) {
	if !regexp.MustCompile(`^run_[A-Za-z0-9_-]{8,128}$`).MatchString(runID) {
		return "", errors.New("invalid private Run identity")
	}
	return filepath.Join(dataDir, "private-output", runID+".txt"), nil
}
func StorePrivateCandidate(dataDir, runID string, content []byte) error {
	target, err := PrivateCandidatePath(dataDir, runID)
	if err != nil {
		return err
	}
	directory := filepath.Dir(target)
	if err := os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0077 != 0 {
		return errors.New("private output directory is not owner-only")
	}
	return WritePrivateFile(target, content)
}

// Exclusive creation refuses replacement and symlinks. Partial writes are never
// treated as a completed candidate by the Runtime or a prepared disclosure.
func WritePrivateFile(target string, content []byte) error {
	file, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return errors.New("private file already exists or cannot be created")
	}
	ok := false
	defer func() {
		file.Close()
		if !ok {
			os.Remove(target)
		}
	}()
	if _, err := file.Write(content); err != nil {
		return fmt.Errorf("write private file: %w", err)
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := durablefs.SyncParent(target); err != nil {
		return err
	}
	ok = true
	return nil
}
