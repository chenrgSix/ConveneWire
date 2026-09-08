package runtime

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strings"

	contracts "convenewire.dev/contracts/generated/go"
)

const developmentOpen = "<convenewire-development>"
const developmentClose = "</convenewire-development>"

func conversationWork(run contracts.RunRequestedPayload) bool {
	return run.ConversationWork != nil && *run.ConversationWork
}

// Only an entire assistant reply can be a proposal. A quoted marker embedded
// in an answer or tool output is never promoted into work.
func parseDevelopmentProposal(reply string) (*contracts.DevelopmentProposal, error) {
	text := strings.TrimSpace(reply)
	if !strings.HasPrefix(text, developmentOpen) {
		return nil, nil
	}
	if !strings.HasSuffix(text, developmentClose) {
		return nil, errors.New("incomplete development proposal")
	}
	decoder := json.NewDecoder(bytes.NewBufferString(strings.TrimSuffix(strings.TrimPrefix(text, developmentOpen), developmentClose)))
	decoder.DisallowUnknownFields()
	var proposal contracts.DevelopmentProposal
	if err := decoder.Decode(&proposal); err != nil {
		return nil, errors.New("invalid development proposal")
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF || strings.TrimSpace(proposal.Title) == "" ||
		len([]rune(proposal.Title)) > 160 || len(proposal.Criteria) < 1 || len(proposal.Criteria) > 8 {
		return nil, errors.New("invalid development proposal bounds")
	}
	for _, criterion := range proposal.Criteria {
		if strings.TrimSpace(criterion) == "" || len([]rune(criterion)) > 2000 {
			return nil, errors.New("invalid development criterion")
		}
	}
	return &proposal, nil
}
