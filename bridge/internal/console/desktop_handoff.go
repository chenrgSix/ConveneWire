package console

import (
	"context"
	"net/http"
	"time"

	"convenewire.dev/bridge/internal/desktopcodex"
)

type nativeDesktopHandoff interface {
	DesktopHandoff() (*desktopcodex.Coordinator, error)
}

func (s *Service) desktopCoordinator() (*desktopcodex.Coordinator, error) {
	capability, ok := s.options.NativePeers.(nativeDesktopHandoff)
	if !ok {
		return nil, desktopcodex.ErrUnavailable
	}
	return capability.DesktopHandoff()
}
func (s *Service) getDesktopHandoff(w http.ResponseWriter, r *http.Request) {
	coordinator, err := s.desktopCoordinator()
	if err != nil {
		writeError(w, 409, "Codex 接管需要本机 Node")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	view, err := coordinator.View(ctx)
	if err != nil {
		writeError(w, 409, "任务或权限已变化，请从房间重新打开接管入口")
		return
	}
	writeJSON(w, 200, view)
}
func (s *Service) postDesktopHandoff(w http.ResponseWriter, r *http.Request) {
	coordinator, err := s.desktopCoordinator()
	if err != nil {
		writeError(w, 409, "Codex 接管需要本机 Node")
		return
	}
	var input struct {
		Action   string `json:"action"`
		TaskID   string `json:"taskId"`
		ThreadID string `json:"threadId"`
		ReviewID string `json:"reviewId"`
		Disclose bool   `json:"disclose"`
	}
	if decodePeerJSON(r, &input) != nil {
		writeError(w, 400, "请提交完整的本机确认")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	var result any = map[string]bool{"ok": true}
	switch input.Action {
	case "select":
		if !coordinator.HasTask(input.TaskID) {
			err = desktopcodex.ErrUnavailable
		} else {
			coordinator.SetPending(input.TaskID)
		}
	case "review":
		result, err = coordinator.Review(ctx, input.TaskID, input.ThreadID)
	case "confirm":
		result, err = coordinator.Confirm(ctx, input.TaskID, input.ReviewID, input.Disclose)
	case "release":
		err = coordinator.Release(ctx, input.TaskID)
	case "setup":
		_, err = desktopcodex.Setup()
	case "launch":
		err = desktopcodex.LaunchPrepared()
	default:
		writeError(w, 400, "不支持的本机操作")
		return
	}
	if err != nil {
		message := "操作未完成。请确认 Codex 已通过协作入口启动、所选会话空闲，且工作区与 Agent 一致；有未确认的执行时请先在原会话核对。"
		if err == desktopcodex.ErrDesktopRunning {
			message = "请先自行退出 Codex，再点击启动。正在运行的会话不会被强制关闭。"
		}
		writeError(w, 409, message)
		return
	}
	writeJSON(w, 200, result)
}
