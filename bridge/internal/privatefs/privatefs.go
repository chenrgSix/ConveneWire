// Package privatefs protects owner-local candidates and prepared disclosures.
// It is a storage boundary, not a sandbox for the owner's Runtime processes.
package privatefs

import (
	"errors"
	"io"
	"os"

	"convenewire.dev/bridge/internal/durablefs"
)

var ErrProtection = errors.New("private storage requires an owner-only regular object without links")

// WriteFile creates an immutable file with protection established before writing.
func WriteFile(target string, content []byte) error {
	file, release, err := createFile(target)
	if err != nil {
		return err
	}
	defer release()
	ok := false
	defer func() {
		file.Close()
		if !ok {
			os.Remove(target)
		}
	}()
	if _, err := file.Write(content); err != nil {
		return err
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

// ReadFile rechecks the opened object's protection and bounds before reading.
func ReadFile(target string, maximum int64) ([]byte, error) {
	if maximum < 0 || maximum > 4<<20 {
		return nil, ErrProtection
	}
	file, release, err := openFile(target)
	if err != nil {
		return nil, err
	}
	defer release()
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > maximum {
		return nil, ErrProtection
	}
	data, err := io.ReadAll(io.LimitReader(file, maximum+1))
	if err != nil || int64(len(data)) > maximum {
		return nil, ErrProtection
	}
	return data, nil
}
