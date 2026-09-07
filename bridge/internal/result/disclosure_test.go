package result

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/pairing"
	work "convenewire.dev/contracts/generated/go/work"
)

func preparedFixture(t *testing.T) PreparedDisclosure {
	t.Helper()
	source := filepath.Join(t.TempDir(), "source.txt")
	os.WriteFile(source, []byte("snapshot"), 0600)
	return PreparedDisclosure{SourcePath: source, Content: "Released observation.", Intent: work.EvidenceDisclosureIntent{
		Version: 1, OperationID: "op_disclosure_test0001", AgentID: "agent_disclosure_test0001", DeviceID: "device_disclosure_test0001", RunID: "run_disclosure_test0001", TaskID: "task_disclosure_test0001", RoomID: "room_disclosure_test0001", DefinitionRevision: 1, CriteriaRevision: 1,
		ContentBytes: 21, ContentSha256: DisclosureDigest([]byte("Released observation.")), Audience: work.RoomMembers, ExpiresAt: time.Now().UTC().Truncate(time.Second).Add(time.Hour),
		Source: work.EvidenceDisclosureIntentSource{EvidenceRef: "evidence_disclosure_test0001", Revision: DisclosureDigest([]byte("snapshot")), ContentSha256: DisclosureDigest([]byte("snapshot")), Start: 0, End: 8},
	}}
}
func grantFixture(p PreparedDisclosure) work.EvidenceDisclosureGrant {
	var intent work.Intent
	raw, _ := json.Marshal(p.Intent)
	json.Unmarshal(raw, &intent)
	return work.EvidenceDisclosureGrant{GrantID: "disclosure_grant00001", Intent: intent, OwnerMemberID: "member_owner00001", TeamID: "team_disclosure0001", State: "active", Revision: 1, CreatedAt: time.Now().UTC()}
}
func TestDisclosurePreflightDeniesWithoutSendingContent(t *testing.T) {
	for _, change := range []string{"revoked", "expired", "scope", "range", "source", "owner", "device", "body"} {
		t.Run(change, func(t *testing.T) {
			p := preparedFixture(t)
			grant := grantFixture(p)
			switch change {
			case "revoked":
				grant.State = "revoked"
				grant.Revision = 2
				at := time.Now().UTC()
				grant.RevokedAt = &at
			case "expired":
				p.Intent.ExpiresAt = time.Now().UTC().Add(-time.Minute)
				grant.Intent.ExpiresAt = p.Intent.ExpiresAt
			case "scope":
				grant.Intent.RunID = "run_another00000001"
			case "range":
				grant.Intent.Source.Start = 1
			case "source":
				os.WriteFile(p.SourcePath, []byte("changed!"), 0600)
			case "owner":
				grant.OwnerMemberID = "member_other0001"
			case "device":
				grant.Intent.DeviceID = "device_other0001"
			case "body":
				p.Content = "unauthorized content"
			}
			client := NewClient(config.Config{ServerURL: "http://127.0.0.1"}, pairing.Credential{ServerURL: "http://127.0.0.1", DeviceID: p.Intent.DeviceID, OwnerMemberID: "member_owner00001", TeamID: "team_disclosure0001"})
			client.httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				if r.Method != http.MethodGet {
					t.Fatal("sent content without valid consent")
				}
				raw, _ := json.Marshal(grant)
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(raw))), Header: http.Header{}}, nil
			})}
			if _, err := client.PublishDisclosure(context.Background(), grant.GrantID, p); err == nil {
				t.Fatal("accepted invalid disclosure")
			}
		})
	}
}
func TestDisclosureResponseLossDoesNotAutomaticallyResendBytes(t *testing.T) {
	p := preparedFixture(t)
	grant := grantFixture(p)
	posts := 0
	client := NewClient(config.Config{ServerURL: "http://127.0.0.1"}, pairing.Credential{ServerURL: "http://127.0.0.1", DeviceID: p.Intent.DeviceID, OwnerMemberID: grant.OwnerMemberID, TeamID: grant.TeamID})
	client.httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.Method == http.MethodPost {
			posts++
			body, _ := io.ReadAll(r.Body)
			if strings.Contains(string(body), p.SourcePath) || strings.Contains(string(body), "snapshot") {
				t.Fatal("raw source metadata escaped")
			}
			return nil, errors.New("response lost")
		}
		raw, _ := json.Marshal(grant)
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(raw))), Header: http.Header{}}, nil
	})}
	if _, err := client.PublishDisclosure(context.Background(), grant.GrantID, p); err == nil || posts != 1 {
		t.Fatalf("posts=%d err=%v", posts, err)
	}
}

// This test is launched by the Node integration suite against a real disposable
// Central. Its input path and credentials stay in the invocation's owned temp root.
func TestDisclosureProductionInterop(t *testing.T) {
	path := os.Getenv("CONVENE_WIRE_DISCLOSURE_INTEROP_INPUT")
	if path == "" {
		t.Skip("requires disposable Central integration fixture")
	}
	raw, err := ReadLocalDisclosureFile(path, 128<<10)
	if err != nil {
		t.Fatal(err)
	}
	var input struct {
		URL        string
		Credential pairing.Credential
		Prepared   PreparedDisclosure
		GrantID    string
	}
	if err := json.Unmarshal(raw, &input); err != nil {
		t.Fatal(err)
	}
	client := NewClient(config.Config{ServerURL: input.URL}, input.Credential)
	first, err := client.PublishDisclosure(context.Background(), input.GrantID, input.Prepared)
	if err != nil {
		t.Fatal(err)
	}
	second, err := client.PublishDisclosure(context.Background(), input.GrantID, input.Prepared)
	if err != nil {
		t.Fatal(err)
	}
	if first.Replayed || !second.Replayed || first.Result.ResultID != second.Result.ResultID || first.Result.Proposal.Summary != input.Prepared.Content {
		t.Fatal("publication/metadata recovery mismatch")
	}
}

func TestDisclosureRejectsOriginSubstitutionAndRedirect(t *testing.T) {
	p := preparedFixture(t)
	grant := grantFixture(p)
	foreignCalls := 0
	foreign := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { foreignCalls++ }))
	defer foreign.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			json.NewEncoder(w).Encode(grant)
			return
		}
		w.Header().Set("Location", foreign.URL)
		w.WriteHeader(http.StatusTemporaryRedirect)
	}))
	defer source.Close()
	credential := pairing.Credential{ServerURL: source.URL, DeviceID: p.Intent.DeviceID, OwnerMemberID: grant.OwnerMemberID, TeamID: grant.TeamID}
	if _, err := NewClient(config.Config{ServerURL: foreign.URL}, credential).PublishDisclosure(context.Background(), grant.GrantID, p); err == nil {
		t.Fatal("origin substitution accepted")
	}
	if _, err := NewClient(config.Config{ServerURL: source.URL}, credential).PublishDisclosure(context.Background(), grant.GrantID, p); err == nil {
		t.Fatal("publication redirect accepted")
	}
	if foreignCalls != 0 {
		t.Fatal("private bytes or credentials reached redirect target")
	}
}
