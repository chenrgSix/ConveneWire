package bridgecore

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestWindowsNativeProcessRootUsesTheSamePhysicalDirectory(t *testing.T) {
	root := t.TempDir()
	want, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS == "windows" {
		root = strings.ToUpper(root)
	}
	got, err := canonicalNativeProcessRoot(root)
	if err != nil || got != want {
		t.Fatal("physical process namespace changed", got, want, err)
	}
}

func TestNativeProcessRootAcceptsParentAliasButRejectsLinkedLeaf(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix alias and symlink fixture; Windows case normalization is tested separately")
	}
	root := t.TempDir()
	actual := filepath.Join(root, "actual")
	if err := os.MkdirAll(filepath.Join(actual, "processes"), 0700); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(root, "alias")
	if err := os.Symlink(actual, alias); err != nil {
		t.Fatal(err)
	}
	got, err := canonicalNativeProcessRoot(filepath.Join(alias, "processes"))
	want, _ := filepath.EvalSymlinks(filepath.Join(actual, "processes"))
	if err != nil || got != want {
		t.Fatal("parent alias selected another namespace", got, err)
	}
	if _, err := canonicalNativeProcessRoot(alias); err == nil {
		t.Fatal("linked leaf accepted")
	}
	if _, err := canonicalNativeProcessRoot(filepath.Join(actual, "missing")); err == nil {
		t.Fatal("missing namespace accepted")
	}
}
