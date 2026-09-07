// Code generated from JSON Schema and the disclosure template; DO NOT EDIT.
package runtimecontracts

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"github.com/santhosh-tekuri/jsonschema/v6"
)

//go:embed disclosure-schema.json
var disclosureSchemaSource []byte
var ErrInvalidDisclosure = errors.New("invalid evidence disclosure contract")
var disclosureSchemas = compileDisclosureSchemas()

func compileDisclosureSchemas() map[string]*jsonschema.Schema {
	value, err := decodeSingleJSONValue(disclosureSchemaSource)
	if err != nil {
		panic(err)
	}
	compiler := jsonschema.NewCompiler()
	compiler.AssertFormat()
	const id = "https://agentroom.dev/schemas/runtime/disclosure.json"
	if err := compiler.AddResource(id, value); err != nil {
		panic(err)
	}
	schemas := map[string]*jsonschema.Schema{}
	for _, kind := range []string{"disclosureIntent", "disclosureGrant", "disclosurePublishCommand", "disclosureRevokeCommand", "disclosureReceipt"} {
		schema, err := compiler.Compile(id + "#/$defs/" + kind)
		if err != nil {
			panic(err)
		}
		schemas[kind] = schema
	}
	return schemas
}

// NormalizeDisclosureCommand rejects duplicate/unknown keys and invalid Unicode before typed decoding.
func NormalizeDisclosureCommand(kind string, source []byte) ([]byte, error) {
	schema := disclosureSchemas[kind]
	if schema == nil || len(source) > 131072 {
		return nil, ErrInvalidDisclosure
	}
	value, err := executionJSONValue(source)
	if err != nil || schema.Validate(value) != nil {
		return nil, ErrInvalidDisclosure
	}
	record := value.(map[string]any)
	if kind == "disclosureGrant" {
		record = record["intent"].(map[string]any)
	}
	if kind == "disclosureIntent" || kind == "disclosureGrant" {
		scope := record["source"].(map[string]any)
		start, _ := scope["start"].(json.Number).Int64()
		end, _ := scope["end"].(json.Number).Int64()
		if end <= start {
			return nil, ErrInvalidDisclosure
		}
	}
	var out bytes.Buffer
	if err := appendExecutionJSON(&out, value); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}
