package config

import (
	"regexp"
	"strings"
)

var reportedModelPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$`)

// ConfiguredModel reports an explicit launch selector, never an inferred runtime
// default or a model observed in a previous Run. No files or environment are read.
func (a AgentConfig) ConfiguredModel() *string {
	kind := a.RuntimeKind
	if kind == "" {
		kind = a.Adapter
	}
	if kind != "codex" && kind != "pi" {
		return nil
	}
	model := ""
	for i := 1; i < len(a.Command); i++ {
		arg := a.Command[i]
		if arg == "--" {
			break
		}
		if kind == "codex" {
			if arg == "--profile" || arg == "-p" || strings.HasPrefix(arg, "--profile=") {
				return nil
			}
			var override string
			if arg == "-c" || arg == "--config" {
				if i+1 >= len(a.Command) {
					return nil
				}
				i++
				override = a.Command[i]
			} else if strings.HasPrefix(arg, "--config=") {
				override = strings.TrimPrefix(arg, "--config=")
			}
			key, value, found := strings.Cut(override, "=")
			if found && strings.TrimSpace(key) == "model" {
				if model != "" {
					return nil // Conflicting/repeated selectors are not display evidence.
				}
				model = strings.TrimSpace(value)
				if len(model) >= 2 && (model[0] == '"' && model[len(model)-1] == '"' || model[0] == '\'' && model[len(model)-1] == '\'') {
					model = model[1 : len(model)-1]
				}
			}
		} else if arg == "--model" {
			if i+1 >= len(a.Command) || model != "" {
				return nil
			}
			i++
			model = a.Command[i]
		} else if arg == "--models" {
			return nil // A cycling/fuzzy model set is not one configured model.
		}
	}
	if !reportedModelPattern.MatchString(model) || strings.HasPrefix(model, "sk-") || strings.HasPrefix(model, "sk_") {
		return nil
	}
	return &model
}
