package runtime

import (
	"strings"
	"testing"
)

func TestAssessmentEnvelopeSeparatesVisibleReply(t *testing.T) {
	reply, assessment := parseAssessmentEnvelope(`Use a first-terminal-wins fence.
<agentroom-assessment>{"goalSatisfied":true,"confidence":0.91,"recommendation":"finish"}</agentroom-assessment>`)
	if reply != "Use a first-terminal-wins fence." || assessment == nil ||
		assessment.GoalSatisfied == nil || !*assessment.GoalSatisfied {
		t.Fatalf("unexpected parsed report: %q %#v", reply, assessment)
	}
}

func TestAssessmentEnvelopeDegradesMalformedOutputToVisibleReply(t *testing.T) {
	source := `Keep discussing.
<agentroom-assessment>{"goalSatisfied":"yes"}</agentroom-assessment>`
	reply, assessment := parseAssessmentEnvelope(source)
	if reply != source || assessment != nil {
		t.Fatalf("malformed assessment must degrade to reply-only: %q %#v", reply, assessment)
	}
}

func TestAssessmentEnvelopeRejectsWireInvalidMetadata(t *testing.T) {
	for _, payload := range []string{
		`{"goalSatisfied":true,"recommendation":"stop"}`,
		`{"confidence":1.01}`, `{"confidence":-0.01}`,
		`{"disagreementRemaining":"unknown"}`,
		`{"resolvedQuestionIds":["q1","q1"]}`,
		`{"newEvidenceRefs":[""]}`,
		`{"openQuestions":[{"id":"q1","question":"Why?"}]}`,
		`{"openQuestions":[{"id":"q1","question":"Why?","importance":"urgent"}]}`,
		`{"resolvedQuestionIds":["` + strings.Repeat("界", 241) + `"]}`,
		`{"newEvidenceRefs":[` + strings.Repeat(`"ref",`, 100) + `"last"]}`,
		`{"goalSatisfied":true,"confidence":null}`,
	} {
		source := "Supported answer.\n" + assessmentOpen + payload + assessmentClose
		reply, assessment := parseAssessmentEnvelope(source)
		if reply != source || assessment != nil {
			t.Fatalf("wire-invalid metadata must retain reply-only degradation: %s", payload)
		}
	}
}

func TestAssessmentEnvelopePreservesWireValidBoundaryValues(t *testing.T) {
	for _, payload := range []string{
		`{"confidence":0,"recommendation":"wait_human"}`,
		`{"confidence":1,"recommendation":"finish","reviewerApproved":false}`,
		`{"goalSatisfied":false,"resolvedQuestionIds":["q1"],"newEvidenceRefs":["ref1"],"openQuestions":[{"id":"q2","question":"Why?","importance":"low"}],"disagreementRemaining":"none","newInformationAdded":true,"recommendation":"continue"}`,
	} {
		reply, assessment := parseAssessmentEnvelope("Supported answer.\n" + assessmentOpen + payload + assessmentClose)
		if reply != "Supported answer." || assessment == nil {
			t.Fatalf("valid metadata was lost: %s", payload)
		}
	}
}
