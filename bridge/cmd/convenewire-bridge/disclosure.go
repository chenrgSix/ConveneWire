package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/delivery"
	"convenewire.dev/bridge/internal/identity"
	"convenewire.dev/bridge/internal/pairing"
	"convenewire.dev/bridge/internal/privatefs"
	bridgeresult "convenewire.dev/bridge/internal/result"
	bridgeruntime "convenewire.dev/bridge/internal/runtime"
	runtimecontracts "convenewire.dev/contracts/generated/go/runtime"
	work "convenewire.dev/contracts/generated/go/work"
)

func runDisclosure(args []string) error {
	if len(args) == 0 || (args[0] != "prepare" && args[0] != "publish") {
		return errors.New("disclosure requires prepare or publish")
	}
	flags := flag.NewFlagSet("disclosure "+args[0], flag.ContinueOnError)
	configPath := flags.String("config", config.DefaultPath(), "Bridge configuration")
	agentName := flags.String("agent", "", "private Agent name")
	bundlePath := flags.String("bundle", "", "owner-only local prepared bundle")
	runID := flags.String("run-id", "", "completed private Run")
	sourcePath := flags.String("source-file", "", "fixed local source snapshot (never uploaded)")
	releasePath := flags.String("release-file", "", "owner-selected UTF-8 text; defaults to the local candidate")
	sourceRevision := flags.String("source-revision", "", "fixed revision; defaults to snapshot SHA-256")
	evidenceRef := flags.String("evidence-ref", "", "opaque evidence identity (no private path)")
	start := flags.Int64("source-start", 0, "source byte range start, inclusive")
	end := flags.Int64("source-end", 0, "source byte range end, exclusive; 0 means EOF")
	grantID := flags.String("grant-id", "", "approved Central disclosure grant")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	if flags.NArg() != 0 || *bundlePath == "" {
		return errors.New("disclosure requires --bundle and no positional arguments")
	}
	cfg, err := config.Load(*configPath)
	if err != nil {
		return err
	}
	selected, err := configuredAgent(cfg.Agents, *agentName)
	if err != nil {
		return err
	}
	if !selected.OwnerPrivateOutput {
		return errors.New("select an ownerPrivateOutput Agent")
	}
	ids, err := identity.LoadOrCreate(cfg.DataDir, cfg.Agents)
	if err != nil {
		return err
	}
	credential, err := pairing.Load(cfg.DataDir)
	if err != nil {
		return err
	}
	if err := pairing.ValidateCredentialOrigin(cfg.ServerURL, credential); err != nil {
		return err
	}
	inbox, err := delivery.Open(filepath.Join(cfg.DataDir, "inbox"))
	if err != nil {
		return err
	}
	if args[0] == "publish" {
		encoded, err := privatefs.ReadFile(*bundlePath, 128<<10)
		if err != nil {
			return err
		}
		encoded, err = runtimecontracts.CanonicalExecutionJSON(encoded)
		if err != nil {
			return errors.New("invalid or ambiguous prepared disclosure JSON")
		}
		var prepared bridgeresult.PreparedDisclosure
		decoder := json.NewDecoder(strings.NewReader(string(encoded)))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&prepared); err != nil {
			return errors.New("invalid prepared disclosure")
		}
		record, err := inbox.Get(prepared.Intent.RunID)
		if err != nil {
			return err
		}
		if record.Request.OwnerPrivateOutput == nil || !*record.Request.OwnerPrivateOutput || record.State != delivery.StateCompleted ||
			prepared.Intent.AgentID != ids[selected.Name] || record.Request.TargetAgentID != prepared.Intent.AgentID ||
			record.Request.TaskID == nil || *record.Request.TaskID != prepared.Intent.TaskID || record.Request.RoomID != prepared.Intent.RoomID {
			return errors.New("prepared disclosure is outside the completed local private Run")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		receipt, err := bridgeresult.NewClient(cfg, credential).PublishDisclosure(ctx, *grantID, prepared)
		if err != nil {
			return err
		}
		fmt.Printf("disclosure %s: Result %s (replayed=%t)\n", receipt.Grant.GrantID, receipt.Result.ResultID, receipt.Replayed)
		return nil
	}
	record, err := inbox.Get(*runID)
	if err != nil {
		return err
	}
	if record.State != delivery.StateCompleted || record.Request.TargetAgentID != ids[selected.Name] ||
		record.Request.OwnerPrivateOutput == nil || !*record.Request.OwnerPrivateOutput || record.Request.TaskID == nil || record.Request.ContextManifest == nil {
		return errors.New("prepare requires a completed private Run with a frozen Task manifest")
	}
	defaultCandidate := *releasePath == ""
	if defaultCandidate {
		*releasePath, err = bridgeruntime.PrivateCandidatePath(cfg.DataDir, *runID)
		if err != nil {
			return err
		}
	}
	readRelease := bridgeresult.ReadLocalDisclosureFile
	if defaultCandidate {
		readRelease = privatefs.ReadFile
	}
	content, err := readRelease(*releasePath, 16384)
	if err != nil {
		return err
	}
	raw, err := bridgeresult.ReadLocalDisclosureFile(*sourcePath, 4<<20)
	if err != nil {
		return err
	}
	if *end == 0 {
		*end = int64(len(raw))
	}
	digest := bridgeresult.DisclosureDigest(raw)
	if *sourceRevision == "" {
		*sourceRevision = digest
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return err
	}
	intent := work.EvidenceDisclosureIntent{
		Version: 1, OperationID: "op_" + hex.EncodeToString(nonce[:]), AgentID: ids[selected.Name], DeviceID: credential.DeviceID,
		RunID: *runID, TaskID: *record.Request.TaskID, RoomID: record.Request.RoomID,
		DefinitionRevision: record.Request.ContextManifest.DefinitionRevision, CriteriaRevision: record.Request.ContextManifest.CriteriaRevision,
		ContentSha256: bridgeresult.DisclosureDigest(content), ContentBytes: int64(len(content)), Audience: work.RoomMembers,
		ExpiresAt: time.Now().UTC().Truncate(time.Second).Add(time.Hour),
		Source:    work.EvidenceDisclosureIntentSource{EvidenceRef: *evidenceRef, Revision: *sourceRevision, ContentSha256: digest, Start: *start, End: *end},
	}
	absoluteSource, err := filepath.Abs(*sourcePath)
	if err != nil {
		return err
	}
	prepared := bridgeresult.PreparedDisclosure{Intent: intent, Content: string(content), SourcePath: absoluteSource}
	if err := prepared.Validate(); err != nil {
		return err
	}
	bundle, err := json.MarshalIndent(prepared, "", "  ")
	if err != nil {
		return err
	}
	metadata, err := json.MarshalIndent(intent, "", "  ")
	if err != nil {
		return err
	}
	if err := bridgeruntime.WritePrivateFile(*bundlePath, bundle); err != nil {
		return err
	}
	if err := bridgeruntime.WritePrivateFile(*bundlePath+".request.json", metadata); err != nil {
		return err
	}
	fmt.Printf("Prepared locally. Review the exact bundle content and destination, then approve %s.request.json in Task evidence disclosure. Nothing was uploaded.\n", *bundlePath)
	return nil
}
