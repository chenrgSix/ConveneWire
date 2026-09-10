// Deterministic native Codex/Pi protocol fixture. It reads only stdin and writes
// its invocation journal in the explicitly selected disposable Workspace.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
)

func reply(input []byte, kind string) string {
	entry, _ := json.Marshal(map[string]any{"bytes": len(input), "args": os.Args[1:], "runtimeKind": kind})
	file, err := os.OpenFile("fixture-calls.jsonl", os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		panic(err)
	}
	if _, err := file.Write(append(entry, '\n')); err != nil {
		panic(err)
	}
	if err := file.Sync(); err != nil {
		panic(err)
	}
	if err := file.Close(); err != nil {
		panic(err)
	}
	text := "Local Node fixture reply. Team collaboration remains on this computer."
	if strings.Contains(string(input), "Discussion ID:") {
		text += `
<agentroom-assessment>{"goalSatisfied":true,"confidence":0.95,"newInformationAdded":true,"reviewerApproved":true,"disagreementRemaining":"none","recommendation":"finish"}</agentroom-assessment>`
	}
	return text
}

func main() {
	for _, argument := range os.Args[1:] {
		if argument == "--version" {
			fmt.Println("offline-runtime 1.0.0")
			return
		}
		if argument == "app-server" {
			codex()
			return
		}
	}
	input, err := io.ReadAll(os.Stdin)
	if err != nil {
		panic(err)
	}
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"type": "message_end", "message": map[string]any{
		"role": "assistant", "content": []any{map[string]string{"type": "text", "text": reply(input, "pi")}}, "stopReason": "stop"}})
}

func codex() {
	encoder, scanner := json.NewEncoder(os.Stdout), bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 4096), 2*1024*1024)
	threadID := fmt.Sprintf("thread-offline-%d", os.Getpid())
	turn := 0
	for scanner.Scan() {
		var request struct {
			ID     json.RawMessage            `json:"id"`
			Method string                     `json:"method"`
			Params map[string]json.RawMessage `json:"params"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &request); err != nil {
			panic(err)
		}
		if len(request.ID) == 0 {
			continue
		}
		respond := func(result any) { _ = encoder.Encode(map[string]any{"id": request.ID, "result": result}) }
		switch request.Method {
		case "initialize":
			respond(map[string]string{"userAgent": "convenewire-offline-fixture"})
		case "thread/start", "thread/resume":
			if request.Method == "thread/resume" {
				if err := json.Unmarshal(request.Params["threadId"], &threadID); err != nil {
					panic(err)
				}
			}
			respond(map[string]any{"thread": map[string]string{"id": threadID}, "approvalPolicy": "on-request", "approvalsReviewer": "user"})
		case "turn/start":
			turn++
			turnID := fmt.Sprintf("turn-offline-%d-%d", os.Getpid(), turn)
			text := reply(scanner.Bytes(), "codex")
			respond(map[string]any{"turn": map[string]string{"id": turnID}})
			_ = encoder.Encode(map[string]any{"method": "item/completed", "params": map[string]any{
				"threadId": threadID, "turnId": turnID, "item": map[string]string{"id": "reply-offline", "type": "agentMessage", "text": text}}})
			_ = encoder.Encode(map[string]any{"method": "turn/completed", "params": map[string]any{
				"threadId": threadID, "turn": map[string]string{"id": turnID, "status": "completed"}}})
		case "turn/interrupt":
			respond(map[string]any{})
		default:
			_ = encoder.Encode(map[string]any{"id": request.ID, "error": map[string]any{"code": -32601, "message": "Unsupported fixture method"}})
		}
	}
	if err := scanner.Err(); err != nil {
		panic(err)
	}
}
