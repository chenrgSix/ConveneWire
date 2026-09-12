// Code generated from the Relay proof template; DO NOT EDIT.
package peercontracts

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
)

func validRelayValue(kind string, value any) bool {
	raw, err := json.Marshal(value)
	if err != nil {
		return false
	}
	var decoded any
	return Decode(kind, raw, &decoded) == nil
}

// RelayHostname derives the fixed address from raw Ed25519 public-key bytes.
func RelayHostname(publicKey, nodeDomain string) (string, error) {
	if !validRelayValue("PeerNodeIdentity", map[string]string{"nodeId": "node_relaykey", "publicKey": publicKey}) || !validRelayValue("RelayNodeDomain", nodeDomain) {
		return "", errors.New("invalid Relay identity or domain")
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(publicKey)
	if err != nil || len(raw) != 32 {
		return "", errors.New("invalid Relay public key")
	}
	digest := sha256.Sum256(raw)
	return "n" + hex.EncodeToString(digest[:])[:40] + "." + nodeDomain, nil
}

// RelayRegistrationTranscript never normalizes an origin/key while signing.
func RelayRegistrationTranscript(relayOrigin, nodeDomain, nonce, nodeID, publicKey string) ([]byte, error) {
	if !validRelayValue("RelayHTTPSOrigin", relayOrigin) || !validRelayValue("RelayNodeDomain", nodeDomain) ||
		!validRelayValue("PeerNodeIdentity", map[string]string{"nodeId": nodeID, "publicKey": publicKey}) ||
		!validRelayValue("PeerNodeIdentity", map[string]string{"nodeId": nodeID, "publicKey": nonce}) {
		return nil, errors.New("invalid Relay registration transcript")
	}
	return []byte("convenewire.relay.register.v1\n" + relayOrigin + "\n" + nodeDomain + "\n" + nonce + "\n" + nodeID + "\n" + publicKey + "\n"), nil
}
