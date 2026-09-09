package main

import (
	"bufio"
	peer "convenewire.dev/contracts/generated/go/peer"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
)

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 4096), 4*peer.MaximumJSONBytes)
	out := json.NewEncoder(os.Stdout)
	for scanner.Scan() {
		var input struct{ Kind, Raw string }
		if json.Unmarshal(scanner.Bytes(), &input) != nil {
			os.Exit(1)
		}
		var value any
		err := peer.Decode(input.Kind, []byte(input.Raw), &value)
		result := map[string]any{"valid": err == nil}
		if err == nil {
			canonical, _ := peer.CanonicalJSON([]byte(input.Raw))
			result["canonical"] = string(canonical)
			if input.Kind == "PeerProof" {
				var proof peer.PeerProof
				err = peer.Decode(input.Kind, []byte(input.Raw), &proof)
				if err != nil {
					panic(err)
				}
				transcript, err := peer.ProofTranscript(peer.PeerProofPayload(proof.Payload))
				if err != nil {
					panic(err)
				}
				key, _ := base64.RawURLEncoding.DecodeString(proof.Payload.SignerPublicKey)
				signature, _ := base64.RawURLEncoding.DecodeString(proof.Signature)
				result["transcript"] = string(transcript)
				result["signatureValid"] = ed25519.Verify(key, transcript, signature)
			}
		}
		out.Encode(result)
	}
	if scanner.Err() != nil {
		fmt.Fprintln(os.Stderr, "invalid fixture input")
		os.Exit(1)
	}
}
