// Standalone protocol double: do not import Bridge or generated contracts.
// Loading their package initializers would spend the metadata query deadline
// compiling unrelated schemas before the first protocol response.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func main() {
	mode := os.Getenv("CONVENE_WIRE_CONVERSATION_FIXTURE")
	if mode == "" || len(os.Args) != 4 || os.Args[1] != "app-server" {
		os.Exit(1)
	}
	journal, err := os.OpenFile(os.Getenv("CONVENE_WIRE_CONVERSATION_JOURNAL"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		os.Exit(2)
	}
	defer journal.Close()
	workspace, _ := os.Getwd()
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var message struct {
			ID     int            `json:"id"`
			Method string         `json:"method"`
			Params map[string]any `json:"params"`
		}
		if json.Unmarshal(scanner.Bytes(), &message) != nil {
			os.Exit(3)
		}
		_, _ = journal.Write(append(append([]byte{}, scanner.Bytes()...), '\n'))
		switch message.Method {
		case "initialize":
			fmt.Println(`{"id":1,"result":{}}`)
		case "initialized":
		case "thread/list", "thread/read":
			thread := map[string]any{"id": "thread_fixture", "name": "Existing conversation", "cwd": workspace, "updatedAt": 123,
				"historyMode": "legacy", "preview": "PRIVATE_FIRST_MESSAGE", "path": "/private/rollout", "turns": []any{"PRIVATE_HISTORY"}, "status": map[string]any{"type": "idle"}}
			switch mode {
			case "foreign-workspace":
				thread["cwd"] = filepath.Dir(workspace)
			case "wrong-thread":
				thread["id"] = "thread_foreign"
			case "invalid-thread":
				thread["id"] = "../thread"
			case "title-control":
				thread["name"] = "bad\x1btitle"
			case "unknown-history":
				thread["historyMode"] = "future-unsupported"
			case "old-server":
				delete(thread, "historyMode")
			case "paginated":
				thread["historyMode"] = "paginated"
			case "error":
				fmt.Println(`{"id":2,"error":{"message":"PRIVATE_PROVIDER_ERROR"}}`)
				continue
			case "wrong-id":
				fmt.Println(`{"id":9,"result":{}}`)
				continue
			case "request":
				fmt.Println(`{"id":3,"method":"item/tool/call","params":{}}`)
				continue
			case "request-zero":
				fmt.Println(`{"id":0,"method":"item/tool/call","params":{}}`)
			case "notification":
				fmt.Println(`{"method":"server/notice","params":{}}`)
			case "oversize":
				fmt.Println(strings.Repeat("x", (1<<20)+1))
				continue
			case "hang":
				time.Sleep(time.Minute)
				continue
			}
			var result any = map[string]any{"thread": thread}
			if message.Method == "thread/list" {
				if message.Params["cwd"] != workspace || message.Params["limit"] != float64(25) || message.Params["useStateDbOnly"] != true {
					os.Exit(4)
				}
				rows := []any{thread}
				if mode == "duplicate" {
					rows = append(rows, thread)
				}
				if mode == "too-many" {
					rows = make([]any, 26)
				}
				result = map[string]any{"data": rows, "nextCursor": "next-page"}
			} else if message.Params["includeTurns"] != false {
				os.Exit(5)
			}
			_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"id": 2, "result": result})
		default:
			os.Exit(6) // Never resume, start, mutate configuration, or answer tools.
		}
	}
	os.Exit(0)
}
