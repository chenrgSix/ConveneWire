package localnode

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"

	"convenewire.dev/bridge/internal/durablefs"
	"convenewire.dev/bridge/internal/privatefs"
)

type snapshotFile struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}
type snapshotManifest struct {
	SchemaVersion int            `json:"schemaVersion"`
	OriginalRoot  string         `json:"originalRoot"`
	NodeID        string         `json:"nodeId"`
	Files         []snapshotFile `json:"files"`
}

// Backup copies a stopped installation, including identity and execution state.
// A live supervisor lease or listener prevents taking a split-generation copy.
func Backup(root, destination string) error {
	data, err := openData(root, false)
	if err != nil {
		return err
	}
	defer data.Close()
	listener, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", data.Identity.Port))
	if err != nil {
		return errors.New("stop the Local Hub before backup")
	}
	defer listener.Close()
	if _, err := os.Stat(filepath.Join(data.Root, "hub", "hub.sqlite")); err != nil {
		return errors.New("Local Hub has no database to back up")
	}
	destination, err = filepath.Abs(destination)
	if err != nil {
		return err
	}
	relative, err := filepath.Rel(data.Root, destination)
	if err != nil || (relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))) {
		return errors.New("backup destination must be outside the Node root")
	}
	if err := privatefs.CreateDirectory(destination); err != nil {
		return err
	}
	success := false
	defer func() {
		if !success {
			os.RemoveAll(destination)
		}
	}()
	if err := privatefs.EnsureDirectory(destination); err != nil {
		return err
	}
	manifest := snapshotManifest{SchemaVersion: 1, OriginalRoot: data.Root, NodeID: data.Identity.NodeID}
	err = filepath.WalkDir(data.Root, func(source string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(data.Root, source)
		if err != nil {
			return err
		}
		if relative == "." {
			return nil
		}
		if entry.Name() == ".bridge-owner.lock" {
			return nil
		}
		target := filepath.Join(destination, relative)
		if entry.IsDir() {
			return privatefs.EnsureDirectory(target)
		}
		sum, err := copyRegular(source, target)
		if err != nil {
			return err
		}
		manifest.Files = append(manifest.Files, snapshotFile{Path: filepath.ToSlash(relative), SHA256: sum})
		return nil
	})
	if err != nil {
		return err
	}
	encoded, err := json.Marshal(manifest)
	if err != nil {
		return err
	}
	if err := privatefs.WriteFile(filepath.Join(destination, "snapshot.json"), encoded); err != nil {
		return err
	}
	success = true
	return nil
}

// Restore requires the original, now absent location. Keeping absolute Bridge
// configuration and Workspace semantics avoids treating restore as a clone.
func Restore(snapshot, destination string) error {
	source, err := privatefs.ReadFile(filepath.Join(snapshot, "snapshot.json"), 4<<20)
	if err != nil {
		return err
	}
	var manifest snapshotManifest
	if err := json.Unmarshal(source, &manifest); err != nil || manifest.SchemaVersion != 1 || len(manifest.Files) == 0 {
		return errors.New("invalid Local Node snapshot")
	}
	destination, err = filepath.Abs(destination)
	if err != nil || destination != manifest.OriginalRoot {
		return errors.New("restore requires the original Node location")
	}
	if err := privatefs.CreateDirectory(destination); err != nil {
		return err
	}
	success := false
	defer func() {
		if !success {
			os.RemoveAll(destination)
		}
	}()
	if err := privatefs.EnsureDirectory(destination); err != nil {
		return err
	}
	seen := make(map[string]bool)
	for _, file := range manifest.Files {
		relative := filepath.FromSlash(file.Path)
		if relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) ||
			strings.ContainsAny(file.Path, "\\:") || filepath.ToSlash(filepath.Clean(relative)) != file.Path || seen[file.Path] {
			return errors.New("invalid snapshot member")
		}
		seen[file.Path] = true
		target := filepath.Join(destination, relative)
		if err := privatefs.EnsureDirectory(filepath.Dir(target)); err != nil {
			return err
		}
		sum, err := copyRegular(filepath.Join(snapshot, relative), target)
		if err != nil {
			return err
		}
		if sum != file.SHA256 {
			return errors.New("snapshot digest mismatch")
		}
	}
	count := 0
	if err := filepath.WalkDir(snapshot, func(source string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		relative, err := filepath.Rel(snapshot, source)
		if err != nil {
			return err
		}
		if !entry.Type().IsRegular() {
			return errors.New("snapshot contains a link or special object")
		}
		if relative == "snapshot.json" {
			return nil
		}
		if !seen[filepath.ToSlash(relative)] {
			return errors.New("snapshot contains an unchecked extra file")
		}
		count++
		return nil
	}); err != nil {
		return err
	}
	if count != len(seen) {
		return errors.New("snapshot file inventory mismatch")
	}
	if !seen[identityFile] || !seen["hub/hub.sqlite"] {
		return errors.New("snapshot omits identity or database")
	}
	data, err := openData(destination, false)
	if err != nil {
		return err
	}
	defer data.Close()
	if data.Identity.NodeID != manifest.NodeID {
		return errors.New("snapshot identity mismatch")
	}
	success = true
	return durablefs.SyncParent(destination)
}

func copyRegular(source, target string) (string, error) {
	info, err := os.Lstat(source)
	if err != nil || !info.Mode().IsRegular() {
		return "", errors.New("snapshot requires regular files without links")
	}
	input, err := os.Open(source)
	if err != nil {
		return "", err
	}
	defer input.Close()
	actual, err := input.Stat()
	if err != nil || !os.SameFile(info, actual) {
		return "", errors.New("snapshot source changed")
	}
	output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", err
	}
	defer output.Close()
	hasher := sha256.New()
	if _, err := io.Copy(io.MultiWriter(output, hasher), input); err != nil {
		return "", err
	}
	if err := output.Sync(); err != nil {
		return "", err
	}
	if err := output.Close(); err != nil {
		return "", err
	}
	return hex.EncodeToString(hasher.Sum(nil)), durablefs.SyncParent(target)
}
