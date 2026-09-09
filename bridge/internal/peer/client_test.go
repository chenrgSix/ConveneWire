package peer

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

func TestPeerClientNeverFollowsRedirectsOrReflectsUntrustedErrorBodies(t *testing.T) {
	f, now := readAdmissionFixture(t)
	signer, err := NewLocalSigner(f.LocalIdentity)
	if err != nil {
		t.Fatal(err)
	}
	var forwarded atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { forwarded.Add(1); w.WriteHeader(500) }))
	defer target.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", target.URL)
		w.WriteHeader(http.StatusTemporaryRedirect)
		_, _ = io.WriteString(w, "untrusted-private-secret")
	}))
	defer origin.Close()
	client, err := NewClient(origin.URL, f.Joined.Human.Host, signer, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	client.clock = func() time.Time { return now }
	_, err = client.Preview(context.Background(), f.Joined.Runtime.Invitation.InvitationID, f.LocalIdentity.Secret, "op_redirect001")
	if err == nil || strings.Contains(err.Error(), "untrusted-private-secret") || forwarded.Load() != 0 {
		t.Fatal("redirect or untrusted body escaped", err)
	}
}
func TestPeerClientKeepsCookiesAndLegacyCredentialsOutOfRequests(t *testing.T) {
	f, now := readAdmissionFixture(t)
	participant, err := NewLocalSigner(f.LocalIdentity)
	if err != nil {
		t.Fatal(err)
	}
	hostIdentity := f.LocalIdentity
	hostIdentity.NodeID = "node_cookiehost001"
	host, err := NewLocalSigner(hostIdentity)
	if err != nil {
		t.Fatal(err)
	}
	var previewed atomic.Int32
	var origin string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, header := range []string{"cookie", "origin", "authorization", "x-agent-room-server-token", "x-convene-wire-server-token"} {
			if r.Header.Get(header) != "" {
				t.Error("legacy/browser authority forwarded", header)
			}
		}
		if r.URL.Path != "/api/peer/identity" {
			previewed.Add(1)
			w.WriteHeader(403)
			_, _ = io.WriteString(w, `{"code":"SCOPE_DENIED"}`)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		var request wire.PeerIdentityRequest
		if wire.Decode("PeerIdentityRequest", raw, &request) != nil {
			t.Error("identity request")
			w.WriteHeader(400)
			return
		}
		value := IdentityProof{SchemaVersion: 1, Host: host.Identity(), HostOrigin: origin}
		digest, _ := semanticDigest(map[string]any{"host": value.Host, "hostOrigin": value.HostOrigin})
		proof, err := host.Sign(ProofContext{Purpose: "node.identity", AudienceNodeID: request.Participant.NodeID, OperationID: request.OperationID, Nonce: request.Nonce, SubjectDigest: digest}, now)
		if err != nil {
			t.Error(err)
			return
		}
		value.Proof = proof
		w.Header().Set("Set-Cookie", "owner_session=should-not-be-forwarded; Path=/")
		_ = json.NewEncoder(w).Encode(value)
	}))
	defer server.Close()
	origin = server.URL
	client, err := NewClient(origin, host.Identity(), participant, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	client.clock = func() time.Time { return now }
	if _, err = client.Preview(context.Background(), f.Joined.Runtime.Invitation.InvitationID, f.LocalIdentity.Secret, "op_nocookie001"); err == nil {
		t.Fatal("fixture preview should deny")
	}
	if previewed.Load() != 1 {
		t.Fatal("valid identity did not precede preview")
	}
}
