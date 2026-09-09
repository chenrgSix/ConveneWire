package peer

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
	"github.com/coder/websocket"
)

type runtimeChallenge struct {
	SchemaVersion int64                   `json:"schemaVersion"`
	Binding       wire.PeerRuntimeBinding `json:"binding"`
	Nonce         string                  `json:"nonce"`
	Proof         wire.PeerProof          `json:"proof"`
}

type runtimeReady struct {
	SchemaVersion int64          `json:"schemaVersion"`
	BindingDigest string         `json:"bindingDigest"`
	Proof         wire.PeerProof `json:"proof"`
}

type runtimeMessage struct {
	ProtocolVersion string          `json:"protocolVersion"`
	MessageID       string          `json:"messageId"`
	Timestamp       string          `json:"timestamp"`
	Type            string          `json:"type"`
	Payload         json.RawMessage `json:"payload"`
}

// RuntimeConnection is an independently proven Peer machine channel. It owns
// no Device credential, human session, Agent permission or Run admission.
type RuntimeConnection struct {
	client       *Client
	store        *Store
	membershipID string
	binding      wire.PeerRuntimeBinding
	digest       string
	socket       *websocket.Conn
	ctx          context.Context
	cancel       context.CancelFunc
	stop         func() bool
	readDone     chan struct{}
	acks         chan int64
	sequence     atomic.Int64
	heartbeat    sync.Mutex
	closeOnce    sync.Once
}

func (c *Client) runtimeMembership(store *Store, membershipID string) (LocalConnection, error) {
	if store == nil {
		return LocalConnection{}, ErrStore
	}
	state, err := store.Read()
	if err != nil {
		return LocalConnection{}, err
	}
	_, connection, ok := exportConnection(state, membershipID)
	if !ok || state.Participant != c.signer.Identity() || state.LocalUserID != c.signer.LocalUserID() || connection.State != "active" ||
		!equalJSON(connection.Receipt.Invitation.Host, c.host) || connection.Receipt.Invitation.HostOrigin != c.origin ||
		!after(connection.Receipt.Membership.ExpiresAt, c.clock()) || !after(connection.Receipt.MachineCredential.ExpiresAt, c.clock()) {
		return LocalConnection{}, ErrProof
	}
	return connection, nil
}

// ConnectRuntime proves the pinned Host over its isolated HTTPS client before
// sending a machine bearer. The WS handshake then proves both Nodes against a
// new server nonce and one exact connection/credential/membership binding.
func (c *Client) ConnectRuntime(ctx context.Context, store *Store, membershipID string) (*RuntimeConnection, error) {
	local, err := c.runtimeMembership(store, membershipID)
	if err != nil {
		return nil, err
	}
	nonce, err := NewNonce()
	if err != nil {
		return nil, err
	}
	if err := c.identity(ctx, "op_"+nonce); err != nil {
		return nil, err
	}
	local, err = c.runtimeMembership(store, membershipID)
	if err != nil {
		return nil, err
	}
	handshake, cancelHandshake := context.WithTimeout(ctx, 15*time.Second)
	defer cancelHandshake()
	endpoint := "ws" + strings.TrimPrefix(c.origin, "http") + "/ws/peer/runtime"
	socket, response, err := websocket.Dial(handshake, endpoint, &websocket.DialOptions{
		HTTPClient:      &http.Client{Transport: c.transport, CheckRedirect: c.http.CheckRedirect},
		HTTPHeader:      http.Header{"Authorization": []string{"Bearer " + local.Receipt.MachineCredential.Token}},
		CompressionMode: websocket.CompressionDisabled,
	})
	if err != nil {
		if response != nil && response.Body != nil {
			_ = response.Body.Close()
		}
		return nil, ErrTransport
	}
	socket.SetReadLimit(32 * 1024)
	keep := false
	defer func() {
		if !keep {
			_ = socket.CloseNow()
		}
	}()
	message, err := readRuntimeMessage(handshake, socket)
	if err != nil || message.Type != "peer.runtime.challenge" {
		return nil, ErrTransport
	}
	var challenge runtimeChallenge
	if wire.Decode("PeerRuntimeChallenge", message.Payload, &challenge) != nil {
		return nil, ErrProof
	}
	b := challenge.Binding
	m := local.Receipt.Membership
	if !equalJSON(b.Host, c.host) || !equalJSON(b.Participant, c.signer.Identity()) || b.HostOrigin != c.origin ||
		b.PeerID != m.PeerID || b.MembershipID != m.MembershipID || b.CredentialID != local.Receipt.MachineCredential.CredentialID ||
		b.TeamID != m.Scope.TeamID || b.MemberID != m.MemberID {
		return nil, ErrProof
	}
	subject, _ := semanticDigest(map[string]any{"phase": "challenge", "binding": b})
	proofContext := ProofContext{Purpose: "peer.connect", AudienceNodeID: c.signer.Identity().NodeID,
		OperationID: b.OperationID, Nonce: challenge.Nonce, SubjectDigest: subject}
	if VerifyProof(challenge.Proof, c.host, proofContext, c.clock()) != nil {
		return nil, ErrProof
	}
	if _, err := c.runtimeMembership(store, membershipID); err != nil {
		return nil, err
	}
	digest, _ := semanticDigest(b)
	proofContext.AudienceNodeID = c.host.NodeID
	proofContext.SubjectDigest, _ = semanticDigest(map[string]any{"phase": "authenticate", "binding": b})
	proof, err := c.signer.Sign(proofContext, c.clock())
	if err != nil {
		return nil, err
	}
	if err := writeRuntimeMessage(handshake, socket, "peer.runtime.authenticate", runtimeReady{SchemaVersion: 1, BindingDigest: digest, Proof: proof}, c.clock()); err != nil {
		return nil, err
	}
	message, err = readRuntimeMessage(handshake, socket)
	if err != nil || message.Type != "peer.runtime.ready" {
		return nil, ErrTransport
	}
	var ready runtimeReady
	if wire.Decode("PeerRuntimeReady", message.Payload, &ready) != nil || ready.BindingDigest != digest {
		return nil, ErrProof
	}
	proofContext.AudienceNodeID = c.signer.Identity().NodeID
	proofContext.SubjectDigest, _ = semanticDigest(map[string]any{"phase": "ready", "binding": b})
	if VerifyProof(ready.Proof, c.host, proofContext, c.clock()) != nil {
		return nil, ErrProof
	}
	if _, err := c.runtimeMembership(store, membershipID); err != nil {
		return nil, err
	}
	live, cancel := context.WithCancel(ctx)
	connection := &RuntimeConnection{client: c, store: store, membershipID: membershipID, binding: b, digest: digest,
		socket: socket, ctx: live, cancel: cancel, readDone: make(chan struct{}), acks: make(chan int64, 1)}
	connection.stop = context.AfterFunc(ctx, connection.Close)
	keep = true
	go connection.read()
	return connection, nil
}

func (c *RuntimeConnection) Context() context.Context         { return c.ctx }
func (c *RuntimeConnection) Binding() wire.PeerRuntimeBinding { return c.binding }

func (c *RuntimeConnection) Close() {
	c.closeOnce.Do(func() {
		c.cancel()
		_ = c.socket.CloseNow()
	})
}

func (c *RuntimeConnection) Wait() { <-c.readDone }

func (c *RuntimeConnection) read() {
	defer close(c.readDone)
	defer c.Close()
	defer c.stop()
	acknowledged := int64(0)
	for c.ctx.Err() == nil {
		message, err := readRuntimeMessage(c.ctx, c.socket)
		if err != nil || message.Type != "peer.runtime.acknowledged" {
			return
		}
		var ack wire.PeerRuntimeHeartbeat
		if wire.Decode("PeerRuntimeHeartbeat", message.Payload, &ack) != nil || ack.BindingDigest != c.digest ||
			ack.Sequence != acknowledged+1 || ack.Sequence != c.sequence.Load() {
			return
		}
		acknowledged = ack.Sequence
		select {
		case c.acks <- acknowledged:
		case <-c.ctx.Done():
			return
		}
	}
}

func (c *RuntimeConnection) Heartbeat(ctx context.Context) error {
	c.heartbeat.Lock()
	defer c.heartbeat.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	stop := context.AfterFunc(c.ctx, cancel)
	defer stop()
	defer cancel()
	if _, err := c.client.runtimeMembership(c.store, c.membershipID); err != nil {
		c.Close()
		return err
	}
	sequence := c.sequence.Add(1)
	if err := writeRuntimeMessage(ctx, c.socket, "peer.runtime.heartbeat", wire.PeerRuntimeHeartbeat{
		SchemaVersion: 1, BindingDigest: c.digest, Sequence: sequence}, c.client.clock()); err != nil {
		c.Close()
		return err
	}
	select {
	case received := <-c.acks:
		if received == sequence && c.ctx.Err() == nil {
			if _, err := c.client.runtimeMembership(c.store, c.membershipID); err == nil {
				return nil
			}
		}
	case <-ctx.Done():
	case <-c.ctx.Done():
	}
	c.Close()
	return ErrTransport
}

func readRuntimeMessage(ctx context.Context, socket *websocket.Conn) (runtimeMessage, error) {
	kind, raw, err := socket.Read(ctx)
	var message runtimeMessage
	if err != nil || kind != websocket.MessageText || wire.Decode("PeerRuntimeMessage", raw, &message) != nil {
		return message, ErrTransport
	}
	return message, nil
}

func writeRuntimeMessage(ctx context.Context, socket *websocket.Conn, kind string, payload any, now time.Time) error {
	nonce, err := NewNonce()
	if err != nil {
		return err
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	message := runtimeMessage{ProtocolVersion: "peer.v1", MessageID: "msg_" + nonce, Timestamp: now.UTC().Format(peerTimeFormat), Type: kind, Payload: body}
	if !closed("PeerRuntimeMessage", message) {
		return ErrProof
	}
	raw, err := json.Marshal(message)
	if err != nil {
		return err
	}
	if err := socket.Write(ctx, websocket.MessageText, raw); err != nil {
		return ErrTransport
	}
	return nil
}
