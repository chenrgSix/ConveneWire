package verification

import (
	"context"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"sync/atomic"
	"time"
)

type browserSite struct {
	origin      string
	proxy       string
	root        *os.Root
	server      *http.Server
	proxyServer *http.Server
	denied      atomic.Int64
}

func openBrowserSite(workspace, documentRoot string) (*browserSite, error) {
	root, err := os.OpenRoot(workspace)
	if err != nil {
		return nil, err
	}
	fail := func(cause error) (*browserSite, error) { _ = root.Close(); return nil, cause }
	if !browserRelativePath(documentRoot) {
		return fail(ErrProfileInvalid)
	}
	if documentRoot != "." {
		for _, part := range strings.Split(documentRoot, "/") {
			if part == "." || part == ".." || strings.HasPrefix(part, ".") {
				return fail(ErrProfileInvalid)
			}
		}
		if !browserRegularPath(root, documentRoot, true) {
			return fail(ErrProfileChanged)
		}
		nested, err := root.OpenRoot(documentRoot)
		if err != nil {
			return fail(err)
		}
		_ = root.Close()
		root = nested
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return fail(err)
	}
	proxyListener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		_ = listener.Close()
		return fail(err)
	}
	site := &browserSite{root: root, origin: "http://" + listener.Addr().String(), proxy: "http://" + proxyListener.Addr().String()}
	site.server = &http.Server{Handler: http.HandlerFunc(site.serve), ReadHeaderTimeout: 2 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second, IdleTimeout: time.Second}
	transport := &http.Transport{Proxy: nil, DisableKeepAlives: true, ResponseHeaderTimeout: 2 * time.Second, DialContext: (&net.Dialer{Timeout: time.Second}).DialContext}
	site.proxyServer = &http.Server{ReadHeaderTimeout: 2 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second, IdleTimeout: time.Second,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodConnect || r.URL.Scheme+"://"+r.URL.Host != site.origin || r.Header.Get("Upgrade") != "" || (r.Method != http.MethodGet && r.Method != http.MethodHead) {
				site.denied.Add(1)
				http.Error(w, "origin denied", http.StatusForbidden)
				return
			}
			copy := r.Clone(r.Context())
			copy.RequestURI = ""
			copy.Header.Del("Proxy-Authorization")
			copy.Header.Del("Proxy-Connection")
			response, err := transport.RoundTrip(copy)
			if err != nil {
				http.Error(w, "candidate unavailable", http.StatusBadGateway)
				return
			}
			defer response.Body.Close()
			for key, values := range response.Header {
				for _, value := range values {
					w.Header().Add(key, value)
				}
			}
			w.WriteHeader(response.StatusCode)
			_, _ = io.Copy(w, io.LimitReader(response.Body, 16<<20))
		})}
	go func() { _ = site.server.Serve(listener) }()
	go func() { _ = site.proxyServer.Serve(proxyListener) }()
	return site, nil
}

func browserRegularPath(root *os.Root, name string, directory bool) bool {
	current := ""
	parts := strings.Split(name, "/")
	for index, part := range parts {
		if part == "" || part == "." || part == ".." || strings.HasPrefix(part, ".") {
			return false
		}
		current = path.Join(current, part)
		info, err := root.Lstat(current)
		if err != nil || info.Mode()&os.ModeSymlink != 0 {
			return false
		}
		if index < len(parts)-1 || directory {
			if !info.IsDir() {
				return false
			}
		} else if !info.Mode().IsRegular() || info.Size() > 16<<20 {
			return false
		}
	}
	return true
}

func (s *browserSite) serve(w http.ResponseWriter, r *http.Request) {
	origin, _ := url.Parse(s.origin)
	if r.Host != origin.Host || (r.Method != http.MethodGet && r.Method != http.MethodHead) {
		http.Error(w, "request denied", http.StatusForbidden)
		return
	}
	// Candidate markup cannot broaden these response restrictions. Scripts may
	// interact with this isolated page; outbound API, frames, forms and workers
	// are deliberately excluded from the static verifier's first version.
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	name := strings.TrimPrefix(r.URL.Path, "/")
	if name == "" {
		name = "index.html"
	}
	if strings.HasSuffix(name, "/") {
		name += "index.html"
	}
	if !browserRelativePath(name) || !browserRegularPath(s.root, name, false) {
		http.NotFound(w, r)
		return
	}
	file, err := s.root.Open(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > 16<<20 {
		http.Error(w, "candidate changed", http.StatusConflict)
		return
	}
	contentType := mime.TypeByExtension(path.Ext(name))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", fmt.Sprint(info.Size()))
	if r.Method == http.MethodGet {
		_, _ = io.CopyN(w, file, info.Size())
	}
}

func (s *browserSite) close() error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	err := s.proxyServer.Shutdown(ctx)
	if err != nil {
		_ = s.proxyServer.Close()
	}
	other := s.server.Shutdown(ctx)
	if other != nil {
		_ = s.server.Close()
	}
	rootErr := s.root.Close()
	if err != nil {
		return err
	}
	if other != nil {
		return other
	}
	return rootErr
}
