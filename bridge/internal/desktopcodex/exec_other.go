//go:build !darwin

package desktopcodex

import "errors"

func Replace(_ Plan, _, _ []string) error {
	return errors.New("experimental desktop startup currently requires macOS")
}
