//go:build darwin || linux

package privatefs

import (
	"os"
	"syscall"
)

func owned(info os.FileInfo) bool {
	value, ok := info.Sys().(*syscall.Stat_t)
	return ok && value.Uid == uint32(os.Geteuid()) && info.Mode().Perm()&0077 == 0
}

// CreateDirectory reserves a new owner-only directory without adopting an existing path.
func CreateDirectory(target string) error {
	if err := os.Mkdir(target, 0700); err != nil {
		return err
	}
	return EnsureDirectory(target)
}

func EnsureDirectory(target string) error {
	if err := os.MkdirAll(target, 0700); err != nil {
		return err
	}
	info, err := os.Lstat(target)
	if err != nil || !info.IsDir() || !owned(info) {
		return ErrProtection
	}
	return nil
}

func createFile(target string) (*os.File, func(), error) {
	f, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	return f, func() {}, err
}

func openFile(target string) (*os.File, func(), error) {
	info, err := os.Lstat(target)
	if err != nil || !info.Mode().IsRegular() || !owned(info) {
		return nil, nil, ErrProtection
	}
	f, err := os.OpenFile(target, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, nil, err
	}
	current, err := f.Stat()
	if err != nil || !os.SameFile(info, current) || !owned(current) {
		f.Close()
		return nil, nil, ErrProtection
	}
	return f, func() {}, nil
}
