//go:build desktop

package main

import (
	"context"
	"fmt"
	"html"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"convenewire.dev/bridge/internal/autostart"
	"convenewire.dev/bridge/internal/localnode"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/icons"
)

func bundledLocalHub(executable, legacyConfig string) string {
	// Released remote profiles stay in Bridge mode. Only a fresh profile defaults
	// to the Local Hub shipped with this application.
	if _, err := os.Lstat(legacyConfig); !os.IsNotExist(err) {
		return ""
	}
	root := filepath.Join(filepath.Dir(executable), "hub")
	if runtime.GOOS == "darwin" {
		root = filepath.Join(filepath.Dir(executable), "../Resources/hub")
	}
	if _, err := os.Stat(filepath.Join(root, "hub-manifest.json")); err != nil {
		return ""
	}
	return root
}

func runLocalNodeDesktop(bundle, root, workspace string, background bool, activation *desktopActivation, instance *desktopInstance) error {
	var err error
	root, err = filepath.Abs(root)
	if err != nil {
		return err
	}
	bundle, err = filepath.Abs(bundle)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(root), 0700); err != nil {
		return err
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var shell *localnode.Shell
	var closeOnce sync.Once
	closeAll := func() {
		closeOnce.Do(func() {
			cancel()
			activation.close()
			if shell != nil {
				_ = shell.Close()
			}
		})
	}
	defer closeAll()
	router := http.NewServeMux()
	windowsOptions := instance.windows
	windowsOptions.DisableQuitOnLastWindowClosed = true
	app := application.New(application.Options{Name: "ConveneWire", Description: "Local Team collaboration and Runtime", Icon: desktopApplicationIcon(runtime.GOOS),
		Assets: application.AssetOptions{Handler: router, DisableLogging: true}, SingleInstance: instance.singleInstance,
		Mac: application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: false}, Windows: windowsOptions, OnShutdown: closeAll})
	hub, startErr := localnode.Start(ctx, bundle, root)
	startupMessage := ""
	entryURL := "/"
	if startErr != nil {
		startupMessage = startErr.Error()
	} else {
		dependencies := localnode.RuntimeDependencies(version)
		arguments := []string{"--background", "--hub-bundle", bundle, "--node-data", root}
		if workspace != "" {
			arguments = append(arguments, "--workspace", workspace)
		}
		dependencies.LoginStartup = autostart.New(executable, arguments)
		shell = localnode.NewShell(hub, workspace, version, dependencies)
		entryURL, startErr = hub.Entry(ctx)
		if startErr != nil {
			startupMessage = startErr.Error()
			entryURL = "/"
		}
	}
	router.Handle("/", http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if startupMessage != "" {
			response.Header().Set("Content-Type", "text/html; charset=utf-8")
			response.Header().Set("Cache-Control", "no-store")
			fmt.Fprintf(response, "<!doctype html><html lang=zh-CN><meta charset=utf-8><title>ConveneWire</title><main style='max-width:640px;margin:12vh auto;font:18px system-ui;padding:24px'><h1>本地空间无法启动</h1><p>%s</p><p>请检查安装包、数据目录和保存的端口，然后退出并重新打开。原有数据会保留。</p></main></html>", html.EscapeString(startupMessage))
			return
		}
		shell.Handler().ServeHTTP(response, request)
	}))
	window := app.Window.NewWithOptions(application.WebviewWindowOptions{Name: "ConveneWire Local Node", Title: "ConveneWire · 本地空间", URL: entryURL,
		Width: 1280, Height: 850, MinWidth: 850, MinHeight: 620, BackgroundColour: application.NewRGB(12, 17, 13)})
	agentWindow := app.Window.NewWithOptions(application.WebviewWindowOptions{Name: "ConveneWire Local Agents", Title: "ConveneWire · 本机 Agent", URL: "/",
		Width: 980, Height: 780, MinWidth: 760, MinHeight: 620, Hidden: true, BackgroundColour: application.NewRGB(12, 17, 13)})
	show := func(target *application.WebviewWindow) { target.Show(); target.Restore(); target.Focus() }
	for _, target := range []*application.WebviewWindow{window, agentWindow} {
		target.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) { target.Hide(); event.Cancel() })
	}
	if background && startErr == nil {
		window.Hide()
	}
	openHub := func() {
		if startErr != nil {
			show(window)
			return
		}
		go func() {
			entry, err := hub.Entry(ctx)
			application.InvokeAsync(func() {
				if err != nil {
					app.Dialog.Error().SetTitle("本地空间不可用").SetMessage(err.Error()).Show()
					return
				}
				// A changed query forces a document navigation even if only the ticket
				// fragment would otherwise differ; browser cache never becomes Owner ID.
				entry = strings.Replace(entry, "/#", fmt.Sprintf("/?desktop=%d#", time.Now().UnixNano()), 1)
				window.SetURL(entry)
				show(window)
			})
		}()
	}
	openAgents := func() {
		if shell == nil {
			show(window)
			return
		}
		if service := shell.Console(); service != nil {
			agentWindow.SetURL(consoleWindowURL(service.Token(), ""))
		}
		show(agentWindow)
	}
	bindActivationToLoadedPage(window.OnWindowEvent, runtime.GOOS, activation, application.InvokeAsync, func(link string) {
		if link != "" {
			app.Dialog.Error().SetTitle("请在 Bridge 模式中配对").SetMessage("本地 Node 保留独立的本机身份；此版本的远端配对请在 Bridge 模式中打开。").Show()
			return
		}
		openHub()
	})
	if runtime.GOOS == "darwin" {
		app.Event.OnApplicationEvent(events.Mac.ApplicationShouldHandleReopen, func(*application.ApplicationEvent) { activation.accept("") })
	}
	app.Event.OnApplicationEvent(events.Common.ApplicationLaunchedWithUrl, func(event *application.ApplicationEvent) {
		if link, err := pairingLinkFromLaunch(event.Context().URL(), nil); err == nil && link != "" {
			activation.accept(link)
		}
	})
	tray := app.SystemTray.New()
	if runtime.GOOS == "darwin" {
		tray.SetTemplateIcon(icons.SystrayMacTemplate)
	} else {
		tray.SetIcon(desktopTrayIcon(runtime.GOOS))
	}
	tray.SetTooltip("ConveneWire · 本地空间")
	menu := app.NewMenu()
	menu.Add("打开本地空间").OnClick(func(*application.Context) { openHub() })
	menu.Add("配置本机 Agent").OnClick(func(*application.Context) { openAgents() })
	menu.AddSeparator()
	menu.Add("退出").OnClick(func(*application.Context) { app.Quit() })
	tray.SetMenu(menu)
	tray.OnClick(openHub)
	if shell != nil && startErr == nil {
		go func() {
			ticker := time.NewTicker(500 * time.Millisecond)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-hub.Done():
					_ = shell.Close()
					application.InvokeAsync(func() {
						app.Dialog.Error().SetTitle("本地 Hub 已停止").SetMessage("本地 Runtime 已停止。请退出并重新打开，恢复原来的 Team 和执行记录。").Show()
					})
					return
				case <-ticker.C:
					requested, err := shell.Poll(ctx)
					if err != nil {
						if ctx.Err() != nil {
							return
						}
						_ = shell.Close()
						application.InvokeAsync(func() { app.Dialog.Error().SetTitle("本地 Runtime 需要处理").SetMessage(err.Error()).Show() })
						return
					}
					if requested {
						application.InvokeAsync(openAgents)
					}
				}
			}
		}()
	}
	return app.Run()
}
