package localnode

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

type bundleFile struct {
	Path   string `json:"path"`
	Size   *int64 `json:"size"`
	SHA256 string `json:"sha256"`
}
type BundleManifest struct {
	ReleaseVersion string       `json:"releaseVersion"`
	SchemaVersion  int          `json:"schemaVersion"`
	Platform       string       `json:"platform"`
	Arch           string       `json:"arch"`
	NodeVersion    string       `json:"nodeVersion"`
	SourceCommit   string       `json:"sourceCommit"`
	SourceState    string       `json:"sourceState"`
	Files          []bundleFile `json:"files"`
}

// VerifyBundle implements the closed OPS-018 inventory before any Node code runs.
// Distribution authenticity remains the responsibility of the outer installer.
func VerifyBundle(root string) (BundleManifest, error) {
	var manifest BundleManifest
	info, err := os.Lstat(root)
	if err != nil || !info.IsDir() {
		return manifest, errors.New("Local Hub bundle is missing or is a link")
	}
	manifestPath := filepath.Join(root, "hub-manifest.json")
	info, err = os.Lstat(manifestPath)
	if err != nil || !info.Mode().IsRegular() || info.Size() > 4<<20 {
		return manifest, errors.New("invalid Hub manifest file")
	}
	file, err := os.Open(manifestPath)
	if err != nil {
		return manifest, err
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, 4<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return manifest, errors.New("invalid Hub manifest")
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return manifest, errors.New("invalid Hub manifest trailer")
	}
	platform := runtime.GOOS
	if platform == "windows" {
		platform = "win32"
	}
	arch := runtime.GOARCH
	if arch == "amd64" {
		arch = "x64"
	}
	if !regexp.MustCompile(`^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`).MatchString(manifest.ReleaseVersion) || manifest.SchemaVersion != 1 || manifest.Platform != platform || manifest.Arch != arch ||
		!regexp.MustCompile(`^v22\.\d+\.\d+$`).MatchString(manifest.NodeVersion) ||
		!regexp.MustCompile(`^[a-f0-9]{40}$`).MatchString(manifest.SourceCommit) ||
		(manifest.SourceState != "clean" && manifest.SourceState != "modified") || len(manifest.Files) == 0 {
		return manifest, errors.New("incompatible Hub manifest")
	}
	expected := make(map[string]bundleFile)
	for _, file := range manifest.Files {
		relative := filepath.FromSlash(file.Path)
		if file.Path == "" || relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) ||
			strings.ContainsAny(file.Path, "\\:") || filepath.ToSlash(filepath.Clean(relative)) != file.Path || file.Path == "hub-manifest.json" ||
			(file.Size == nil || *file.Size < 0 || *file.Size > 9007199254740991) || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(file.SHA256) {
			return manifest, errors.New("invalid Hub inventory entry")
		}
		if _, exists := expected[file.Path]; exists {
			return manifest, errors.New("duplicate Hub inventory entry")
		}
		expected[file.Path] = file
	}
	for _, key := range []string{nodeExecutable(), "apps/server/dist/local-node.js", "apps/server/dist/server.js", "apps/web/dist/index.html",
		"node_modules/better-sqlite3/package.json", "node_modules/@convene-wire/contracts/package.json", "NODE-LICENSE", "LICENSE", "NOTICE"} {
		if _, exists := expected[key]; !exists {
			return manifest, fmt.Errorf("Hub runtime file is missing: %s", key)
		}
	}
	count := 0
	err = filepath.WalkDir(root, func(target string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		if !entry.Type().IsRegular() {
			return errors.New("Hub bundle contains a link or special object")
		}
		relative, err := filepath.Rel(root, target)
		if err != nil {
			return err
		}
		key := filepath.ToSlash(relative)
		if key == "hub-manifest.json" {
			return nil
		}
		expectedFile, exists := expected[key]
		if !exists {
			return fmt.Errorf("unchecked Hub file: %s", key)
		}
		input, err := os.Open(target)
		if err != nil {
			return err
		}
		defer input.Close()
		stat, err := input.Stat()
		if err != nil || stat.Size() != *expectedFile.Size {
			return fmt.Errorf("Hub file size mismatch: %s", key)
		}
		sum := sha256.New()
		if _, err := io.Copy(sum, input); err != nil {
			return err
		}
		if hex.EncodeToString(sum.Sum(nil)) != expectedFile.SHA256 {
			return fmt.Errorf("Hub file digest mismatch: %s", key)
		}
		count++
		return nil
	})
	if err == nil && count != len(expected) {
		err = errors.New("Hub inventory is incomplete")
	}
	return manifest, err
}

func nodeExecutable() string {
	if runtime.GOOS == "windows" {
		return "bin/node.exe"
	}
	return "bin/node"
}
