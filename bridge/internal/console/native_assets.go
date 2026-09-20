package console

import (
	"context"
	"net/http"
)

type nativeAssetOriginKey struct{}

// NativeAssetHandler is only for the in-process desktop asset transport, never
// a TCP listener. Its provenance cannot be supplied by an HTTP header or token.
// The platform selects the pinned Wails asset origin; ordinary Console listeners
// continue to require their loopback HTTP origin.
func NativeAssetHandler(next http.Handler, platform string) http.Handler {
	origin := map[string]string{"darwin": "wails://localhost", "windows": "http://wails.localhost"}[platform]
	if origin == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), nativeAssetOriginKey{}, origin)))
	})
}
