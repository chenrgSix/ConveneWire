package verification

import (
	"net/url"
	"path"
	"path/filepath"
	"strings"
)

// BrowserSpec serves only one disposable candidate directory. The exact allowed
// origin is allocated and owned by Runner, never supplied by a Task or model.
// Command contains only the owner-selected Chromium executable; flags are typed.
type BrowserSpec struct {
	Version      int           `json:"version"`
	DocumentRoot string        `json:"documentRoot"`
	StartPath    string        `json:"startPath"`
	Width        int           `json:"width"`
	Height       int           `json:"height"`
	Steps        []BrowserStep `json:"steps"`
	Screenshot   bool          `json:"screenshot"`
}

type BrowserStep struct {
	Action   string `json:"action"`
	Selector string `json:"selector"`
	Value    string `json:"value,omitempty"`
}

type BrowserStepResult struct {
	Action   string `json:"action"`
	Selector string `json:"selector"`
	State    string `json:"state"`
}

type BrowserScreenshot struct {
	State    string `json:"state"`
	MIMEType string `json:"mimeType,omitempty"`
	SHA256   string `json:"sha256,omitempty"`
	Data     string `json:"data,omitempty"`
}

type BrowserReport struct {
	ProcessExit  string              `json:"processExit,omitempty"`
	Version      int                 `json:"version"`
	Kind         string              `json:"kind"`
	Startup      string              `json:"startup"`
	PageLoad     string              `json:"pageLoad"`
	Steps        []BrowserStepResult `json:"steps"`
	Screenshot   BrowserScreenshot   `json:"screenshot"`
	VisualReview string              `json:"visualReview"`
	Cleanup      string              `json:"cleanup"`
	Reason       string              `json:"reason"`
}

func validateBrowserSpec(spec BrowserSpec) error {
	if spec.Version != 1 || !browserRelativePath(spec.DocumentRoot) || spec.Width < 320 || spec.Width > 1920 || spec.Height < 240 || spec.Height > 1080 ||
		spec.Steps == nil || len(spec.Steps) > 32 || len(spec.StartPath) > 2048 || !strings.HasPrefix(spec.StartPath, "/") || strings.HasPrefix(spec.StartPath, "//") {
		return ErrProfileInvalid
	}
	u, err := url.ParseRequestURI(spec.StartPath)
	if err != nil || u.IsAbs() || u.Host != "" || u.Fragment != "" {
		return ErrProfileInvalid
	}
	for _, step := range spec.Steps {
		if step.Selector == "" || len(step.Selector) > 512 || len(step.Value) > 2000 || strings.ContainsRune(step.Selector+step.Value, 0) {
			return ErrProfileInvalid
		}
		switch step.Action {
		case "click", "visible":
			if step.Value != "" {
				return ErrProfileInvalid
			}
		case "fill", "text":
		default:
			return ErrProfileInvalid
		}
	}
	return nil
}

func browserRelativePath(value string) bool {
	return value != "" && len(value) <= 1024 && path.Clean(value) == value && !path.IsAbs(value) && value != ".." && !strings.HasPrefix(value, "../") && !strings.ContainsAny(value, "\\\x00:")
}

func cloneBrowserSpec(spec *BrowserSpec) *BrowserSpec {
	if spec == nil {
		return nil
	}
	copy := *spec
	copy.Steps = append([]BrowserStep{}, spec.Steps...)
	return &copy
}

func browserExecutableName(executable string) bool {
	name := strings.ToLower(filepath.Base(executable))
	return name == "chrome-headless-shell" || name == "chrome-headless-shell.exe" || name == "headless_shell" || name == "headless_shell.exe"
}
