package console

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/desktopcodex"
	localwire "convenewire.dev/contracts/generated/go/localnode"
)

type nativeAssetOwner struct {
	*consolePeerOwner
	coordinator *desktopcodex.Coordinator
}

func (o *nativeAssetOwner) DesktopHandoff() (*desktopcodex.Coordinator, error) {
	return o.coordinator, nil
}

func TestWindowsAndMacNativeAssetsReachActualHandoffWithoutTrustingHTTPHeaders(t *testing.T) {
	service, owner, _ := peerConsoleFixture(t)
	root := t.TempDir()
	coordinator, err := desktopcodex.NewCoordinator(filepath.Join(root, "adoptions"), "node_nativeassets001", filepath.Join(root, "absent-connection.json"),
		func(context.Context, localwire.DesktopHandoffRequest) (localwire.DesktopHandoffScope, error) {
			t.Error("an empty handoff view changed Hub state")
			return localwire.DesktopHandoffScope{}, desktopcodex.ErrUnavailable
		}, func(string) (config.AgentConfig, error) { return config.AgentConfig{}, desktopcodex.ErrUnavailable })
	if err != nil {
		t.Fatal(err)
	}
	service.options.NativePeers = &nativeAssetOwner{consolePeerOwner: owner, coordinator: coordinator}
	for platform, origin := range map[string]string{"darwin": "wails://localhost", "windows": "http://wails.localhost"} {
		t.Run(platform, func(t *testing.T) {
			native := NativeAssetHandler(service.Handler(), platform)
			for _, method := range []string{http.MethodGet, http.MethodPost} {
				for _, scenario := range []string{"native", "native origin", "HTTP forgery", "missing token", "foreign origin", "foreign host", "cross site", "forwarded", "forwarded host", "query"} {
					t.Run(method+"/"+scenario, func(t *testing.T) {
						request := httptest.NewRequest(method, origin+"/api/desktop-codex", strings.NewReader(`{"action":"invalid"}`))
						// Wails strips the URI scheme/host, retains Request.Host and
						// assigns a synthetic peer address to in-process requests.
						request.URL.Scheme, request.URL.Host = "", ""
						request.RemoteAddr = "192.0.2.1:1234"
						request.Header.Set("authorization", "Bearer "+service.Token())
						handler := native
						want := http.StatusForbidden
						switch scenario {
						case "native", "native origin":
							want = http.StatusOK
							if method == http.MethodPost {
								want = http.StatusBadRequest
							}
							if scenario == "native origin" {
								request.Header.Set("origin", origin)
							}
						case "HTTP forgery":
							handler = service.Handler()
							request.Header.Set("origin", origin)
							request.Header.Set("x-native-assets", "true")
						case "missing token":
							request.Header.Del("authorization")
							want = http.StatusUnauthorized
						case "foreign origin":
							request.Header.Set("origin", "https://foreign.example")
						case "foreign host":
							request.Host = "foreign.example"
						case "cross site":
							request.Header.Set("sec-fetch-site", "cross-site")
						case "forwarded":
							request.Header.Set("forwarded", "host=localhost")
						case "forwarded host":
							request.Header.Set("x-forwarded-host", "localhost")
						case "query":
							request.URL.RawQuery = "native=true"
						}
						response := httptest.NewRecorder()
						handler.ServeHTTP(response, request)
						if response.Code != want {
							t.Fatalf("status %d, wanted %d: %s", response.Code, want, response.Body.String())
						}
						if want == http.StatusOK {
							var view desktopcodex.CoordinatorView
							if json.Unmarshal(response.Body.Bytes(), &view) != nil || view.Connected || len(view.Threads) != 0 {
								t.Fatal("invalid disconnected handoff view")
							}
						}
					})
				}
			}
		})
	}
}
