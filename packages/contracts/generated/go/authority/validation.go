// Code generated from JSON Schema and the Authority validator template; DO NOT EDIT.
package authoritycontracts

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"io"
	"sync"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

//go:embed foundation-schema.json
var source []byte
var once sync.Once
var schemas map[string]*jsonschema.Schema
var compileError error

// Decode validates the closed, versioned JSON Schema before decoding typed data.
func Decode(kind string, data []byte, result any) error {
	once.Do(func() {
		compiler := jsonschema.NewCompiler()
		var document any
		if compileError = json.Unmarshal(source, &document); compileError != nil {
			return
		}
		const uri = "https://agentroom.dev/schemas/authority/foundation.schema.json"
		if compileError = compiler.AddResource(uri, document); compileError != nil {
			return
		}
		schemas = make(map[string]*jsonschema.Schema)
		for _, name := range []string{"AuthorityRef", "AuthorityPin", "AuthorityProofRequest", "AuthorityProofPayload", "AuthorityProof", "AuthorityAgentMapping", "AuthorityConnector", "AuthorityConnectionsConfig", "AuthoritySpace", "AuthoritySpaceDirectory"} {
			schemas[name], compileError = compiler.Compile(uri + "#/$defs/" + name)
			if compileError != nil {
				return
			}
		}
	})
	if compileError != nil {
		return errors.New("Authority schema is unavailable")
	}
	schema, ok := schemas[kind]
	if !ok || len(data) > 65536 {
		return errors.New("invalid Authority message")
	}
	var value any
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if decoder.Decode(&value) != nil {
		return errors.New("invalid Authority JSON")
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF || schema.Validate(value) != nil {
		return errors.New("invalid Authority message")
	}
	return json.Unmarshal(data, result)
}
