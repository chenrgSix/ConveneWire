package runtime

import (
	"bytes"
	"encoding/json"
	"io"
	"strings"

	contracts "convenewire.dev/contracts/generated/go"
	runtimecontracts "convenewire.dev/contracts/generated/go/runtime"
)

const (
	assessmentOpen  = "<agentroom-assessment>"
	assessmentClose = "</agentroom-assessment>"
)

func parseAssessmentEnvelope(source string) (string, *contracts.Assessment) {
	trimmed := strings.TrimSpace(source)
	if !strings.HasSuffix(trimmed, assessmentClose) {
		return trimmed, nil
	}
	start := strings.LastIndex(trimmed, assessmentOpen)
	if start < 0 {
		return trimmed, nil
	}
	jsonStart := start + len(assessmentOpen)
	jsonEnd := len(trimmed) - len(assessmentClose)
	decoder := json.NewDecoder(bytes.NewBufferString(trimmed[jsonStart:jsonEnd]))
	decoder.DisallowUnknownFields()
	var assessment contracts.Assessment
	if err := decoder.Decode(&assessment); err != nil || !hasAssessment(assessment) {
		return trimmed, nil
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return trimmed, nil
	}
	// Decode alone accepts unknown enum values and ignores schema bounds.
	// Validate the original JSON in a fixed, never-emitted reply envelope so
	// the generated wire schema remains the only assessment constraint source.
	validationEnvelope := `{"protocolVersion":"1.0","messageId":"msg_assessment_check",` +
		`"timestamp":"2026-09-06T00:00:00Z","type":"run.reply","payload":{` +
		`"agentId":"agent_assessment_check","runId":"run_assessment_check",` +
		`"traceId":"trace_assessment_check","sequence":1,"content":"validation",` +
		`"assessment":` + trimmed[jsonStart:jsonEnd] + `}}`
	if runtimecontracts.ValidateBridgeMessage([]byte(validationEnvelope)) != nil {
		return trimmed, nil
	}
	visible := strings.TrimSpace(trimmed[:start])
	if visible == "" {
		return trimmed, nil
	}
	return visible, &assessment
}

func hasAssessment(value contracts.Assessment) bool {
	return value.Confidence != nil || value.DisagreementRemaining != nil ||
		value.GoalSatisfied != nil || len(value.NewEvidenceRefs) > 0 ||
		value.NewInformationAdded != nil || len(value.OpenQuestions) > 0 ||
		value.Recommendation != nil || len(value.ResolvedQuestionIDS) > 0 ||
		value.ReviewerApproved != nil
}
