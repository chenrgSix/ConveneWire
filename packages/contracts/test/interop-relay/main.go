package main

import (
	"bufio"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"

	peer "convenewire.dev/contracts/generated/go/peer"
)

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 4096), 4*peer.MaximumJSONBytes)
	out := json.NewEncoder(os.Stdout)
	for scanner.Scan() {
		var input struct{ Action, Kind, Raw, RelayOrigin, NodeDomain, Nonce, NodeID, PublicKey, Signature, Seed string }
		if json.Unmarshal(scanner.Bytes(), &input) != nil {
			os.Exit(1)
		}
		result := map[string]any{"valid": false}
		switch input.Action {
		case "decode":
			var value any
			result["valid"] = peer.Decode(input.Kind, []byte(input.Raw), &value) == nil
		case "proof":
			transcript, err := peer.RelayRegistrationTranscript(input.RelayOrigin, input.NodeDomain, input.Nonce, input.NodeID, input.PublicKey)
			hostname, addressErr := peer.RelayHostname(input.PublicKey, input.NodeDomain)
			result["valid"] = err == nil && addressErr == nil
			if err == nil && addressErr == nil {
				key, _ := base64.RawURLEncoding.Strict().DecodeString(input.PublicKey)
				signature, _ := base64.RawURLEncoding.Strict().DecodeString(input.Signature)
				result["transcript"] = string(transcript)
				result["hostname"] = hostname
				result["signatureValid"] = ed25519.Verify(key, transcript, signature)
				seed, seedErr := hex.DecodeString(input.Seed)
				if seedErr != nil || len(seed) != ed25519.SeedSize {
					os.Exit(1)
				}
				result["signature"] = base64.RawURLEncoding.EncodeToString(ed25519.Sign(ed25519.NewKeyFromSeed(seed), transcript))
			}
		default:
			os.Exit(1)
		}
		if out.Encode(result) != nil {
			os.Exit(1)
		}
	}
	if scanner.Err() != nil {
		os.Exit(1)
	}
}
