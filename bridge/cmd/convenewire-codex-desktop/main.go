package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"runtime"
	"syscall"

	"convenewire.dev/bridge/internal/desktopcodex"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if runtime.GOOS != "darwin" {
		return errors.New("experimental desktop startup currently requires macOS")
	}
	if len(args) > 0 && args[0] == "prepare" {
		flags := flag.NewFlagSet("prepare", flag.ContinueOnError)
		desktop := flags.String("desktop", "", "absolute desktop executable inside the installed app")
		out := flags.String("out", "", "new immutable private launch plan")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if flags.NArg() != 0 {
			return errors.New("unexpected prepare arguments")
		}
		if _, err := desktopcodex.Prepare(*desktop, *out); err != nil {
			return err
		}
		fmt.Fprintln(os.Stdout, "Prepared experimental launch plan. This does not enable Room adoption.")
		return nil
	}
	self, err := os.Executable()
	if err != nil {
		return err
	}
	if len(args) > 0 && args[0] == "launch" {
		flags := flag.NewFlagSet("launch", flag.ContinueOnError)
		plan := flags.String("plan", "", "prepared private launch plan")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if flags.NArg() != 0 {
			return errors.New("unexpected launch arguments")
		}
		return desktopcodex.Launch(*plan, self)
	}
	if err := desktopcodex.ValidateArguments(args); err != nil {
		return err
	}
	plan, err := desktopcodex.LoadVerified(os.Getenv(desktopcodex.ConfigEnvironment), self)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return desktopcodex.RunProvider(ctx, plan, args, os.Environ())
}
