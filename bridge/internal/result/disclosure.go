package result

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"reflect"
	"strings"
	"time"
	"unicode/utf8"

	"convenewire.dev/bridge/internal/pairing"

	runtimecontracts "convenewire.dev/contracts/generated/go/runtime"
	work "convenewire.dev/contracts/generated/go/work"
)

type PreparedDisclosure struct {
	Intent     work.EvidenceDisclosureIntent `json:"intent"`
	Content    string                        `json:"content"`
	SourcePath string                        `json:"sourcePath"` // Local only, never transmitted.
}
type DisclosureReceipt struct {
	Grant    work.EvidenceDisclosureGrant `json:"grant"`
	Result   work.ResultProjection        `json:"result"`
	Replayed bool                         `json:"replayed"`
}

func DisclosureDigest(content []byte) string {
	sum := sha256.Sum256(content)
	return hex.EncodeToString(sum[:])
}
func ParseDisclosureIntent(source []byte) (work.EvidenceDisclosureIntent, error) {
	var intent work.EvidenceDisclosureIntent
	normalized, err := runtimecontracts.NormalizeDisclosureCommand("disclosureIntent", source)
	if err != nil {
		return intent, err
	}
	err = json.Unmarshal(normalized, &intent)
	return intent, err
}
func ReadLocalDisclosureFile(path string, maximum int64) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() > maximum {
		return nil, errors.New("local disclosure input must be a bounded regular file")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	current, err := file.Stat()
	if err != nil || !os.SameFile(info, current) {
		return nil, errors.New("local disclosure input changed")
	}
	data, err := io.ReadAll(io.LimitReader(file, maximum+1))
	if err != nil || int64(len(data)) > maximum {
		return nil, errors.New("local disclosure input exceeds bound")
	}
	return data, nil
}
func (p PreparedDisclosure) Validate() error {
	source, err := json.Marshal(p.Intent)
	if err != nil {
		return err
	}
	if _, err := ParseDisclosureIntent(source); err != nil {
		return err
	}
	if !utf8.ValidString(p.Content) || p.Content == "" || strings.TrimSpace(p.Content) != p.Content ||
		len(p.Content) > 16384 || int64(len(p.Content)) != p.Intent.ContentBytes || DisclosureDigest([]byte(p.Content)) != p.Intent.ContentSha256 {
		return errors.New("prepared disclosure content changed")
	}
	raw, err := ReadLocalDisclosureFile(p.SourcePath, 4<<20)
	if err != nil {
		return err
	}
	if DisclosureDigest(raw) != p.Intent.Source.ContentSha256 || p.Intent.Source.End > int64(len(raw)) {
		return errors.New("prepared disclosure source snapshot changed")
	}
	return nil
}
func (c *Client) ReadDisclosure(ctx context.Context, grantID string) (work.EvidenceDisclosureGrant, error) {
	var grant work.EvidenceDisclosureGrant
	if !validID(grantID, "disclosure") {
		return grant, errors.New("invalid disclosure identity")
	}
	var raw json.RawMessage
	if err := c.disclosureRequest(ctx, http.MethodGet, "/api/bridge/evidence-disclosures/"+grantID, nil, &raw); err != nil {
		return grant, err
	}
	normalized, err := runtimecontracts.NormalizeDisclosureCommand("disclosureGrant", raw)
	if err != nil {
		return grant, err
	}
	err = json.Unmarshal(normalized, &grant)
	return grant, err
}
func (c *Client) PublishDisclosure(ctx context.Context, grantID string, prepared PreparedDisclosure) (DisclosureReceipt, error) {
	var receipt DisclosureReceipt
	if err := prepared.Validate(); err != nil {
		return receipt, err
	}
	grant, err := c.ReadDisclosure(ctx, grantID)
	if err != nil {
		return receipt, err
	}
	// Compare every field, including source range and expiry. A central grant for
	// another local proposal must never authorize sending the selected bytes.
	expectedJSON, _ := json.Marshal(prepared.Intent)
	actualJSON, _ := json.Marshal(grant.Intent)
	expected, _ := runtimecontracts.NormalizeDisclosureCommand("disclosureIntent", expectedJSON)
	actual, _ := runtimecontracts.NormalizeDisclosureCommand("disclosureIntent", actualJSON)
	var expectedValue, actualValue any
	_ = json.Unmarshal(expected, &expectedValue)
	_ = json.Unmarshal(actual, &actualValue)
	if !reflect.DeepEqual(expectedValue, actualValue) || grant.GrantID != grantID ||
		grant.Intent.DeviceID != c.credential.DeviceID || grant.OwnerMemberID != c.credential.OwnerMemberID || grant.TeamID != c.credential.TeamID {
		return receipt, errors.New("disclosure grant does not match the local owner and exact proposal")
	}
	if grant.ResultID != nil {
		// Resolve ambiguous commit through an authenticated metadata read; do not
		// retransmit private content after revocation or expiry.
		if err := c.disclosureReceipt(ctx, http.MethodGet, "/api/bridge/evidence-disclosures/"+grantID+"/result", nil, prepared, grantID, &receipt); err != nil {
			return receipt, err
		}
		return receipt, nil
	}
	if grant.State != "active" || grant.Revision != 1 || !grant.Intent.ExpiresAt.After(time.Now()) {
		return receipt, errors.New("disclosure grant is inactive or expired")
	}
	command := work.EvidenceDisclosurePublishCommand{GrantID: grantID, ExpectedRevision: 1, Content: prepared.Content}
	// No automatic content retry. An uncertain POST is resolved with a fresh
	// current-grant read on the owner's next explicit invocation.
	if err := c.disclosureReceipt(ctx, http.MethodPost, "/api/bridge/evidence-disclosures/publish", command, prepared, grantID, &receipt); err != nil {
		return receipt, err
	}
	return receipt, nil
}

func (c *Client) disclosureReceipt(ctx context.Context, method, path string, input any, prepared PreparedDisclosure, grantID string, receipt *DisclosureReceipt) error {
	var raw json.RawMessage
	if err := c.disclosureRequest(ctx, method, path, input, &raw); err != nil {
		return err
	}
	normalized, err := runtimecontracts.NormalizeDisclosureCommand("disclosureReceipt", raw)
	if err != nil {
		return errors.New("invalid disclosure receipt; resolve current grant before retrying")
	}
	if err := json.Unmarshal(normalized, receipt); err != nil {
		return err
	}
	grant := receipt.Grant
	if grant.GrantID != grantID || grant.ResultID == nil || *grant.ResultID != receipt.Result.ResultID ||
		grant.OwnerMemberID != c.credential.OwnerMemberID || grant.TeamID != c.credential.TeamID ||
		grant.Intent.OperationID != prepared.Intent.OperationID || receipt.Result.Proposal.OperationID != prepared.Intent.OperationID ||
		receipt.Result.TaskID != prepared.Intent.TaskID || receipt.Result.RoomID != prepared.Intent.RoomID ||
		receipt.Result.Proposal.Summary != prepared.Content || receipt.Result.ProposedBy.AgentID == nil ||
		*receipt.Result.ProposedBy.AgentID != prepared.Intent.AgentID || receipt.Result.ProposedBy.RunID == nil ||
		*receipt.Result.ProposedBy.RunID != prepared.Intent.RunID {
		return errors.New("disclosure receipt scope mismatch; resolve current grant before retrying")
	}
	return nil
}

func (c *Client) disclosureRequest(ctx context.Context, method, path string, input, output any) error {
	if err := pairing.ValidateCredentialOrigin(c.config.ServerURL, c.credential); err != nil {
		return err
	}
	// Disclosure consent is bound to this Central. Even a same-host redirect must
	// not silently move approved bytes to a different endpoint or origin.
	transport := *c.httpClient
	transport.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	scoped := *c
	scoped.httpClient = &transport
	return scoped.request(ctx, method, path, input, output)
}
