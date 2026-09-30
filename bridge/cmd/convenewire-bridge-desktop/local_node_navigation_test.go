//go:build desktop

package main

import (
	"sync"
	"testing"
)

func TestLocalWorkspaceReopenDoesNotRequestAnotherEntry(t *testing.T) {
	var navigation localNodeNavigation
	for range 3 {
		navigation.reveal()
		if _, load := navigation.beginWorkspace(); load {
			t.Fatal("reopening an existing workspace would reload its conversation")
		}
	}
}

func TestLocalSettingsReturnRequiresFreshEntryOnlyUntilLoaded(t *testing.T) {
	var navigation localNodeNavigation
	navigation.enterSettings()
	navigation.reveal()
	epoch, load := navigation.beginWorkspace()
	if !load || !navigation.current(epoch) {
		t.Fatal("returning from native settings must request a fresh local entry")
	}
	if !navigation.finishWorkspace(epoch) {
		t.Fatal("the current local entry was not accepted")
	}
	navigation.reveal()
	if _, load := navigation.beginWorkspace(); load {
		t.Fatal("later workspace reopening would erase the loaded page")
	}
}

func TestLocalWindowWakeAndSettingsRejectPendingWorkspaceNavigation(t *testing.T) {
	for name, interrupt := range map[string]func(*localNodeNavigation){
		"wake":     (*localNodeNavigation).reveal,
		"settings": (*localNodeNavigation).enterSettings,
	} {
		t.Run(name, func(t *testing.T) {
			var navigation localNodeNavigation
			navigation.enterSettings()
			epoch, load := navigation.beginWorkspace()
			if !load {
				t.Fatal("missing pending return")
			}
			interrupt(&navigation)
			if navigation.current(epoch) || navigation.finishWorkspace(epoch) {
				t.Fatal("an old entry could replace the newly revealed settings page")
			}
			latest, load := navigation.beginWorkspace()
			if !load || !navigation.finishWorkspace(latest) {
				t.Fatal("interrupted return lost the ability to enter the workspace")
			}
		})
	}
}

func TestLocalWorkspaceReturnRejectsOutOfOrderEntries(t *testing.T) {
	var navigation localNodeNavigation
	navigation.enterSettings()
	first, _ := navigation.beginWorkspace()
	second, _ := navigation.beginWorkspace()
	if navigation.finishWorkspace(first) || !navigation.finishWorkspace(second) {
		t.Fatal("out-of-order local entry replaced the latest navigation")
	}
}

func TestLocalWindowNavigationIsSafeDuringConcurrentWake(t *testing.T) {
	var navigation localNodeNavigation
	var workers sync.WaitGroup
	for range 8 {
		workers.Go(func() {
			for range 100 {
				navigation.enterSettings()
				epoch, _ := navigation.beginWorkspace()
				navigation.current(epoch)
				navigation.reveal()
				navigation.finishWorkspace(epoch)
			}
		})
	}
	workers.Wait()
	navigation.enterSettings()
	epoch, load := navigation.beginWorkspace()
	if !load || !navigation.finishWorkspace(epoch) {
		t.Fatal("concurrent wake corrupted the next explicit return")
	}
}
