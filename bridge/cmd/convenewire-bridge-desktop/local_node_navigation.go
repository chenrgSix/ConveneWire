//go:build desktop

package main

import "sync"

// Local window navigation remembers only which surface is displayed. Waking the
// existing document preserves its URL, session, draft and reading position.
type localNodeNavigation struct {
	mu       sync.Mutex
	epoch    uint64
	settings bool
}

func (n *localNodeNavigation) reveal() {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.epoch++
}

func (n *localNodeNavigation) enterSettings() {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.epoch++
	n.settings = true
}

func (n *localNodeNavigation) beginWorkspace() (uint64, bool) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.epoch++
	return n.epoch, n.settings
}

func (n *localNodeNavigation) current(epoch uint64) bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.epoch == epoch
}

func (n *localNodeNavigation) finishWorkspace(epoch uint64) bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.epoch != epoch {
		return false
	}
	n.settings = false
	return true
}
