// Code generated from JSON Schema and the Peer validator template; DO NOT EDIT.
package peercontracts

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"github.com/santhosh-tekuri/jsonschema/v6"
	"math"
	"strconv"
	"strings"
	"sync"
)

//go:embed control-schema.json
var source []byte
var once sync.Once
var schemas map[string]*jsonschema.Schema
var compileError error

// Decode validates raw JSON and the closed schema, without Device fallback.
func Decode(kind string, data []byte, result any) error {
	once.Do(func() {
		compiler := jsonschema.NewCompiler()
		compiler.AssertFormat()
		var document map[string]any
		if compileError = json.Unmarshal(source, &document); compileError != nil {
			return
		}
		const uri = "https://agentroom.dev/schemas/peer/control.schema.json"
		if compileError = compiler.AddResource(uri, document); compileError != nil {
			return
		}
		schemas = make(map[string]*jsonschema.Schema)
		for name := range document["$defs"].(map[string]any) {
			schemas[name], compileError = compiler.Compile(uri + "#/$defs/" + name)
			if compileError != nil {
				return
			}
		}
	})
	if compileError != nil {
		return errors.New("Peer schema is unavailable")
	}
	schema, ok := schemas[kind]
	if !ok {
		return errors.New("invalid Peer kind")
	}
	value, err := ParseJSON(data)
	if err != nil {
		return err
	}
	// Confidence is descriptive binary64 data at one closed event path. Validate
	// every other original number spelling before rounding authorization pins.
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var numbers any
	if decoder.Decode(&numbers) != nil {
		return ErrJSON
	}
	if !validPeerNumbers(kind, numbers, "") {
		return ErrJSON
	}
	if schema.Validate(value) != nil {
		return errors.New("invalid Peer message")
	}
	normalized, err := json.Marshal(value)
	if err != nil {
		return ErrJSON
	}
	return json.Unmarshal(normalized, result)
}

func validPeerNumbers(kind string, value any, path string) bool {
	switch v := value.(type) {
	case map[string]any:
		for key, child := range v {
			escaped := strings.ReplaceAll(strings.ReplaceAll(key, "~", "~0"), "/", "~1")
			if !validPeerNumbers(kind, child, path+"/"+escaped) {
				return false
			}
		}
	case []any:
		for index, child := range v {
			if !validPeerNumbers(kind, child, path+"/"+strconv.Itoa(index)) {
				return false
			}
		}
	case json.Number:
		confidence := kind == "PeerRunEventRequest" && path == "/event/assessment/confidence" || (kind == "PeerRunEvent" || kind == "PeerRunReplyEvent") && path == "/assessment/confidence"
		return confidence || exactInteger(string(v))
	}
	return true
}

func exactInteger(raw string) bool {
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsInf(value, 0) || math.Trunc(value) != value || math.Abs(value) > 9007199254740991 {
		return false
	}
	parts := strings.Split(strings.ToLower(strings.TrimPrefix(raw, "-")), "e")
	mantissa := strings.Split(parts[0], ".")
	fraction := ""
	if len(mantissa) == 2 {
		fraction = mantissa[1]
	}
	digits := strings.TrimLeft(mantissa[0]+fraction, "0")
	if digits == "" {
		return true
	}
	exponent := 0
	if len(parts) == 2 {
		exponent, err = strconv.Atoi(parts[1])
		if err != nil {
			return false
		}
	}
	// Avoid integer overflow and unbounded allocation from hostile exponents.
	if exponent < -MaximumJSONBytes || exponent > MaximumJSONBytes {
		return false
	}
	shift := exponent - len(fraction)
	if shift < 0 {
		cut := len(digits) + shift
		if cut < 1 {
			return false
		}
		if strings.Trim(digits[cut:], "0") != "" {
			return false
		}
		digits = digits[:cut]
	} else {
		if len(digits)+shift > 16 {
			return false
		}
		digits += strings.Repeat("0", shift)
	}
	return digits == strconv.FormatFloat(math.Abs(value), 'f', 0, 64)
}
