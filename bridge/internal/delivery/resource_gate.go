package delivery

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type ExecutionGate interface {
	Acquire(context.Context, string) (func(), error)
}
type LocalResource struct {
	AgentID   string
	Workspace string
}
type resourceWaiter struct {
	resource LocalResource
	ready    chan struct{}
	active   bool
}

// ResourceGate is owned once by the Runtime core. Earlier conflicting waiters
// keep priority without blocking independent Agents and Workspaces.
type ResourceGate struct {
	mu      sync.Mutex
	active  []*resourceWaiter
	waiting []*resourceWaiter
}

func (g *ResourceGate) Acquire(ctx context.Context, resource LocalResource) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if resource.AgentID == "" || !filepath.IsAbs(resource.Workspace) {
		return nil, errors.New("local execution resource is unresolved")
	}
	w := &resourceWaiter{resource: resource, ready: make(chan struct{})}
	g.mu.Lock()
	g.waiting = append(g.waiting, w)
	g.schedule()
	g.mu.Unlock()
	var once sync.Once
	release := func() { once.Do(func() { g.remove(w) }) }
	select {
	case <-w.ready:
		if err := ctx.Err(); err != nil {
			release()
			return nil, err
		}
		return release, nil
	case <-ctx.Done():
		release()
		return nil, ctx.Err()
	}
}
func (g *ResourceGate) remove(w *resourceWaiter) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if w.active {
		g.active = removeWaiter(g.active, w)
	} else {
		g.waiting = removeWaiter(g.waiting, w)
	}
	g.schedule()
}
func removeWaiter(items []*resourceWaiter, w *resourceWaiter) []*resourceWaiter {
	for i, item := range items {
		if item == w {
			return append(items[:i], items[i+1:]...)
		}
	}
	return items
}
func (g *ResourceGate) schedule() {
	pending := make([]*resourceWaiter, 0, len(g.waiting))
	for _, w := range g.waiting {
		blocked := false
		for _, other := range g.active {
			if resourcesConflict(w.resource, other.resource) {
				blocked = true
				break
			}
		}
		if !blocked {
			for _, other := range pending {
				if resourcesConflict(w.resource, other.resource) {
					blocked = true
					break
				}
			}
		}
		if blocked {
			pending = append(pending, w)
			continue
		}
		w.active = true
		g.active = append(g.active, w)
		close(w.ready)
	}
	g.waiting = pending
}
func resourcesConflict(a, b LocalResource) bool {
	return a.AgentID == b.AgentID || pathContains(a.Workspace, b.Workspace) || pathContains(b.Workspace, a.Workspace)
}
func pathContains(parent, child string) bool {
	relative, err := filepath.Rel(parent, child)
	if err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return true
	}
	// Case aliases on a case-insensitive volume can have different path strings
	// after EvalSymlinks. Compare physical ancestors as well.
	parentInfo, err := os.Stat(parent)
	if err != nil {
		return false
	}
	for current := child; ; current = filepath.Dir(current) {
		info, err := os.Stat(current)
		if err == nil && os.SameFile(parentInfo, info) {
			return true
		}
		if filepath.Dir(current) == current {
			return false
		}
	}
}

// MappedExecutionGate resolves aliases without changing the original Run bytes.
type MappedExecutionGate struct {
	Shared    *ResourceGate
	Resources map[string]LocalResource
	Paths     map[string]string
}

func (g *MappedExecutionGate) Acquire(ctx context.Context, projection string) (func(), error) {
	r, ok := g.Resources[projection]
	if !ok || g.Shared == nil {
		return nil, errors.New("Agent projection has no local resource")
	}
	canonical, err := CanonicalWorkspace(g.Paths[projection])
	if err != nil || canonical != r.Workspace {
		return nil, errors.New("local Workspace identity changed")
	}
	release, err := g.Shared.Acquire(ctx, r)
	if err != nil {
		return nil, err
	}
	canonical, err = CanonicalWorkspace(g.Paths[projection])
	if err != nil || canonical != r.Workspace {
		release()
		return nil, errors.New("local Workspace identity changed while waiting")
	}
	return release, nil
}
func CanonicalWorkspace(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	canonical, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(canonical)
	if err != nil || !info.IsDir() {
		return "", errors.New("Workspace must be an existing directory")
	}
	return filepath.Clean(canonical), nil
}
