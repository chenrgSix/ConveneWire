package privatefs

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestPrivateRoundTripAndBounds(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "private")
	if err := EnsureDirectory(directory); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(directory, "candidate.txt")
	if err := WriteFile(target, []byte("private candidate")); err != nil {
		t.Fatal(err)
	}
	data, err := ReadFile(target, 64)
	if err != nil || string(data) != "private candidate" {
		t.Fatal(string(data), err)
	}
	if _, err := ReadFile(target, 2); err == nil {
		t.Fatal("ignored bound")
	}
	if _, err := ReadFile(directory, 64); err == nil {
		t.Fatal("read directory")
	}
	if err := WriteFile(target, []byte("replacement")); err == nil {
		t.Fatal("replaced immutable file")
	}
	data, _ = ReadFile(target, 64)
	if string(data) != "private candidate" {
		t.Fatal("changed original")
	}
}

func TestPrivateCreationHasOneWinner(t *testing.T) {
	target := filepath.Join(t.TempDir(), "candidate.txt")
	var wg sync.WaitGroup
	results := make(chan error, 8)
	for range 8 {
		wg.Go(func() { results <- WriteFile(target, []byte("one candidate")) })
	}
	wg.Wait()
	close(results)
	winners := 0
	for err := range results {
		if err == nil {
			winners++
		}
	}
	if winners != 1 {
		t.Fatalf("successful writers: %d", winners)
	}
	if _, err := ReadFile(target, 64); err != nil {
		t.Fatal(err)
	}
}

func TestPrivateFileRejectsSymlinkWithoutChangingTarget(t *testing.T) {
	dir := t.TempDir()
	original, link := filepath.Join(dir, "original"), filepath.Join(dir, "link")
	if err := WriteFile(original, []byte("keep")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(original, link); err != nil {
		t.Skipf("OS symlink privilege unavailable: %v", err)
	}
	if err := WriteFile(link, []byte("replace")); err == nil {
		t.Fatal("wrote through link")
	}
	if _, err := ReadFile(link, 64); err == nil {
		t.Fatal("read through link")
	}
	data, _ := ReadFile(original, 64)
	if string(data) != "keep" {
		t.Fatal("changed linked target")
	}
}
