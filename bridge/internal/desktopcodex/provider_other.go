//go:build !darwin

package desktopcodex

import "context"

func RunProvider(_ context.Context, _ Plan, _, _ []string) error {
	return ErrUnavailable
}
