package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"convenewire.dev/bridge/internal/buildidentity"
	"convenewire.dev/bridge/internal/localnode"
)

var version = "dev"
var sourceCommit = ""

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	if err := buildidentity.Initialize(sourceCommit); err != nil {
		return err
	}
	bundle := flag.String("hub-bundle", "", "verified native Hub directory")
	root := flag.String("data-dir", "", "explicit Local Node data root")
	workspace := flag.String("workspace", "", "default Workspace for local Agent setup")
	backup := flag.String("backup", "", "write a stopped installation snapshot to this new directory")
	restore := flag.String("restore", "", "restore this snapshot to its original absent data root")
	stdio := flag.Bool("stdio", false, "private fixture/control pipe: emit one-use entry and Console URL; stop on stdin EOF")
	showVersion := flag.Bool("version", false, "print version")
	flag.Parse()
	if *showVersion {
		fmt.Println(version)
		return nil
	}
	if *root == "" {
		return fmt.Errorf("--data-dir is required")
	}
	if *backup != "" && *restore != "" {
		return fmt.Errorf("choose backup or restore")
	}
	if *backup != "" {
		return localnode.Backup(*root, *backup)
	}
	if *restore != "" {
		return localnode.Restore(*restore, *root)
	}
	if *bundle == "" {
		return fmt.Errorf("--hub-bundle is required")
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if *stdio {
		go func() { _, _ = io.Copy(io.Discard, os.Stdin); cancel() }()
	}
	hub, err := localnode.Start(ctx, *bundle, *root)
	if err != nil {
		return err
	}
	shell := localnode.NewShell(hub, *workspace, version, localnode.RuntimeDependencies(version))
	defer shell.Close()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return err
	}
	server := &http.Server{Handler: shell.Handler(), ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = server.Serve(listener) }()
	defer func() {
		deadline, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		_ = server.Shutdown(deadline)
	}()
	if *stdio {
		entry, err := hub.Entry(ctx)
		if err != nil {
			return err
		}
		if err := json.NewEncoder(os.Stdout).Encode(map[string]string{"event": "ready", "origin": hub.Data.Origin(), "nodeId": hub.Data.Identity.NodeID, "entryUrl": entry}); err != nil {
			return err
		}
	} else {
		fmt.Println("Local Hub ready at", hub.Data.Origin())
	}
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	announced := false
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-hub.Done():
			return fmt.Errorf("Local Hub exited; close and reopen the Local Node after checking its saved data and port")
		case <-ticker.C:
			requested, err := shell.Poll(ctx)
			if err != nil {
				if ctx.Err() != nil {
					return nil
				}
				return err
			}
			service := shell.Console()
			if *stdio && service != nil && (!announced || requested) {
				announced = true
				if err := json.NewEncoder(os.Stdout).Encode(map[string]string{"event": "console", "consoleUrl": "http://" + listener.Addr().String() + "/?token=" + service.Token()}); err != nil {
					return err
				}
			}
		}
	}
}
