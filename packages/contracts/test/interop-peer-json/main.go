package main

import (
	"bufio"
	peer "convenewire.dev/contracts/generated/go/peer"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
)

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 4096), 4*peer.MaximumJSONBytes)
	encoder := json.NewEncoder(os.Stdout)
	for scanner.Scan() {
		var input struct {
			Input string `json:"input"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &input); err != nil {
			fmt.Fprintln(os.Stderr, "invalid fixture input")
			os.Exit(1)
		}
		canonical, err := peer.CanonicalJSON([]byte(input.Input))
		if err != nil {
			encoder.Encode(map[string]any{"invalid": true})
			continue
		}
		sum := sha256.Sum256(canonical)
		encoder.Encode(map[string]any{"canonical": string(canonical), "sha256": hex.EncodeToString(sum[:])})
	}
	if scanner.Err() != nil {
		fmt.Fprintln(os.Stderr, "fixture input failed")
		os.Exit(1)
	}
}
