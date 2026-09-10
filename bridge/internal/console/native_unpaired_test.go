package console

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestUnpairedAgentMutationRequiresNativeExecutionCapability(t *testing.T) {
	for _, advertisedNode := range []bool{false, true} {
		t.Run(map[bool]string{false: "legacy profile", true: "Node ID and Peer metadata only"}[advertisedNode], func(t *testing.T) {
			service, path, before := genericEditorFixture(t)
			saved, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			service.mu.Lock()
			service.credential = nil
			service.state.Paired = false
			if advertisedNode {
				service.configuration.LocalNodeID = "node_notnative001"
				service.options.NativePeers = &consolePeerOwner{}
			}
			service.mu.Unlock()
			if _, err := service.StartBridge(); err == nil {
				t.Fatal("unpaired profile started without native execution ownership")
			}
			server := httptest.NewServer(service.Handler())
			defer server.Close()
			input := genericEditorInput(before.Agents[0])
			input.Name = "Unauthorized rename"
			response := consoleRequest(t, server.URL, service.Token(), http.MethodPut, "/api/agents/"+service.State().Agents[0].AgentID, input)
			response.Body.Close()
			if response.StatusCode != http.StatusConflict {
				t.Fatal("unpaired profile edited configuration without native execution capability", response.StatusCode)
			}
			after, err := os.ReadFile(path)
			if err != nil || string(saved) != string(after) {
				t.Fatal("rejected unpaired mutation changed configuration", err)
			}
		})
	}
}
