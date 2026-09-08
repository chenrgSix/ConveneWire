package verification

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/coder/websocket"
)

// This client is private to the owned verifier process. It never attaches to a
// user's browser, exposes a remote-debugging service, or accepts arbitrary JS.
type browserCDP struct {
	connection     *websocket.Conn
	id             int
	session        string
	documentStatus int
}

func dialBrowserCDP(ctx context.Context, address string) (*browserCDP, error) {
	connection, _, err := websocket.Dial(ctx, address, &websocket.DialOptions{HTTPClient: &http.Client{Transport: &http.Transport{Proxy: nil}}})
	if err != nil {
		return nil, err
	}
	connection.SetReadLimit(2 << 20)
	return &browserCDP{connection: connection}, nil
}

func (c *browserCDP) call(ctx context.Context, method string, params any, result any) error {
	c.id++
	message := map[string]any{"id": c.id, "method": method, "params": params}
	if c.session != "" {
		message["sessionId"] = c.session
	}
	raw, err := json.Marshal(message)
	if err != nil {
		return err
	}
	if err = c.connection.Write(ctx, websocket.MessageText, raw); err != nil {
		return err
	}
	for {
		_, raw, err = c.connection.Read(ctx)
		if err != nil {
			return err
		}
		var reply struct {
			ID     int             `json:"id"`
			Method string          `json:"method"`
			Result json.RawMessage `json:"result"`
			Error  json.RawMessage `json:"error"`
			Params struct {
				Type     string `json:"type"`
				Response struct {
					Status int `json:"status"`
				} `json:"response"`
			} `json:"params"`
		}
		if json.Unmarshal(raw, &reply) != nil {
			return fmt.Errorf("invalid browser protocol reply")
		}
		if reply.Method == "Network.responseReceived" && reply.Params.Type == "Document" {
			c.documentStatus = reply.Params.Response.Status
		}
		if reply.ID != c.id {
			continue
		}
		if len(reply.Error) > 0 {
			return fmt.Errorf("browser operation failed: %s", method)
		}
		if result != nil {
			return json.Unmarshal(reply.Result, result)
		}
		return nil
	}
}

func (c *browserCDP) evaluate(ctx context.Context, expression string) (bool, error) {
	var result struct {
		Result struct {
			Value bool `json:"value"`
		} `json:"result"`
		Exception json.RawMessage `json:"exceptionDetails"`
	}
	if err := c.call(ctx, "Runtime.evaluate", map[string]any{"expression": expression, "returnByValue": true, "awaitPromise": false}, &result); err != nil {
		return false, err
	}
	if len(result.Exception) > 0 {
		return false, fmt.Errorf("browser assertion could not run")
	}
	return result.Result.Value, nil
}

func browserStepExpression(step BrowserStep) string {
	selector, _ := json.Marshal(step.Selector)
	value, _ := json.Marshal(step.Value)
	prefix := `(() => { const es=document.querySelectorAll(` + string(selector) + `); if(es.length!==1)return false; const e=es[0]; const r=e.getBoundingClientRect(); const visible=r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'; `
	switch step.Action {
	case "visible":
		return prefix + `return visible;})()`
	case "text":
		return prefix + `return visible && e.textContent.includes(` + string(value) + `);})()`
	case "click":
		return prefix + `if(!visible||e.disabled)return false; e.click();return true;})()`
	case "fill":
		return prefix + `if(!visible||e.disabled||e.readOnly)return false; const proto=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; if(!(e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement))return false; Object.getOwnPropertyDescriptor(proto,'value').set.call(e,` + string(value) + `);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`
	default:
		return "false"
	}
}
