// Code generated from the Peer JSON template; DO NOT EDIT.
package peercontracts

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

const MaximumJSONBytes = 1048576
const MaximumJSONDepth = 64

var ErrJSON = errors.New("invalid Peer JSON")

// ParseJSON rejects duplicate decoded keys, invalid Unicode and non-finite numbers.
func ParseJSON(data []byte) (any, error) {
	if len(data) > MaximumJSONBytes || !utf8.Valid(data) || !json.Valid(data) {
		return nil, ErrJSON
	}
	// encoding/json replaces lone UTF-16 surrogates; reject them before decoding.
	for i := 0; i < len(data); i++ {
		if data[i] != '"' {
			continue
		}
		for i++; i < len(data) && data[i] != '"'; i++ {
			if data[i] != '\\' {
				continue
			}
			i++
			if data[i] != 'u' {
				continue
			}
			n, _ := strconv.ParseUint(string(data[i+1:i+5]), 16, 16)
			i += 4
			if n >= 0xd800 && n <= 0xdbff {
				if i+6 >= len(data) || data[i+1] != '\\' || data[i+2] != 'u' {
					return nil, ErrJSON
				}
				next, err := strconv.ParseUint(string(data[i+3:i+7]), 16, 16)
				if err != nil || next < 0xdc00 || next > 0xdfff {
					return nil, ErrJSON
				}
				i += 6
			} else if n >= 0xdc00 && n <= 0xdfff {
				return nil, ErrJSON
			}
		}
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var read func(int) (any, error)
	read = func(depth int) (any, error) {
		if depth > MaximumJSONDepth {
			return nil, ErrJSON
		}
		token, err := decoder.Token()
		if err != nil {
			return nil, ErrJSON
		}
		switch value := token.(type) {
		case json.Delim:
			if value == '{' {
				object := map[string]any{}
				for decoder.More() {
					keyToken, err := decoder.Token()
					if err != nil {
						return nil, ErrJSON
					}
					key, ok := keyToken.(string)
					if !ok {
						return nil, ErrJSON
					}
					if _, duplicate := object[key]; duplicate {
						return nil, ErrJSON
					}
					item, err := read(depth + 1)
					if err != nil {
						return nil, err
					}
					object[key] = item
				}
				if _, err := decoder.Token(); err != nil {
					return nil, ErrJSON
				}
				return object, nil
			}
			if value == '[' {
				array := []any{}
				for decoder.More() {
					item, err := read(depth + 1)
					if err != nil {
						return nil, err
					}
					array = append(array, item)
				}
				if _, err := decoder.Token(); err != nil {
					return nil, ErrJSON
				}
				return array, nil
			}
			return nil, ErrJSON
		case json.Number:
			number, err := strconv.ParseFloat(string(value), 64)
			if err != nil || math.IsNaN(number) || math.IsInf(number, 0) {
				return nil, ErrJSON
			}
			return number, nil
		default:
			return value, nil
		}
	}
	result, err := read(0)
	if err != nil {
		return nil, err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return nil, ErrJSON
	}
	return result, nil
}

// CanonicalJSON uses RFC 8785 over strictly decoded JSON bytes. It is separate
// from legacy Device Inbox payload hashing and never rewrites existing digests.
func CanonicalJSON(data []byte) ([]byte, error) {
	value, err := ParseJSON(data)
	if err != nil {
		return nil, err
	}
	var output bytes.Buffer
	appendText := func(s string) error {
		if output.Len()+len(s) > MaximumJSONBytes {
			return ErrJSON
		}
		output.WriteString(s)
		return nil
	}
	quote := func(s string) string {
		var b strings.Builder
		b.WriteByte('"')
		for _, r := range s {
			switch r {
			case '"':
				b.WriteString(`\"`)
			case '\\':
				b.WriteString(`\\`)
			case '\b':
				b.WriteString(`\b`)
			case '\t':
				b.WriteString(`\t`)
			case '\n':
				b.WriteString(`\n`)
			case '\f':
				b.WriteString(`\f`)
			case '\r':
				b.WriteString(`\r`)
			default:
				if r < 32 {
					const hex = "0123456789abcdef"
					b.WriteString(`\u00`)
					b.WriteByte(hex[r>>4])
					b.WriteByte(hex[r&15])
				} else {
					b.WriteRune(r)
				}
			}
		}
		b.WriteByte('"')
		return b.String()
	}
	var write func(any) error
	write = func(item any) error {
		switch v := item.(type) {
		case nil:
			return appendText("null")
		case bool:
			return appendText(strconv.FormatBool(v))
		case string:
			return appendText(quote(v))
		case float64:
			if v == 0 {
				return appendText("0")
			}
			format := byte('e')
			if math.Abs(v) >= 1e-6 && math.Abs(v) < 1e21 {
				format = 'f'
			}
			s := strconv.FormatFloat(v, format, -1, 64)
			// ECMAScript emits an explicit positive exponent and no exponent zero pad.
			if format == 'e' {
				i := strings.IndexByte(s, 'e')
				exponent, _ := strconv.Atoi(s[i+1:])
				sign := ""
				if exponent >= 0 {
					sign = "+"
				}
				s = s[:i+1] + sign + strconv.Itoa(exponent)
			}
			return appendText(s)
		case []any:
			if err := appendText("["); err != nil {
				return err
			}
			for i, x := range v {
				if i > 0 {
					if err := appendText(","); err != nil {
						return err
					}
				}
				if err := write(x); err != nil {
					return err
				}
			}
			return appendText("]")
		case map[string]any:
			keys := make([]string, 0, len(v))
			for key := range v {
				keys = append(keys, key)
			}
			sort.Slice(keys, func(i, j int) bool {
				a, b := utf16.Encode([]rune(keys[i])), utf16.Encode([]rune(keys[j]))
				for k := 0; k < len(a) && k < len(b); k++ {
					if a[k] != b[k] {
						return a[k] < b[k]
					}
				}
				return len(a) < len(b)
			})
			if err := appendText("{"); err != nil {
				return err
			}
			for i, key := range keys {
				if i > 0 {
					if err := appendText(","); err != nil {
						return err
					}
				}
				if err := appendText(quote(key) + ":"); err != nil {
					return err
				}
				if err := write(v[key]); err != nil {
					return err
				}
			}
			return appendText("}")
		default:
			return ErrJSON
		}
	}
	if err := write(value); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}
