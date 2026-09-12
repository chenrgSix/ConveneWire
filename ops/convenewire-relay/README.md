# ConveneWire Relay

The Relay connects a public HTTPS address to a Local Node through outbound
WebSockets. It is a separate operator service, not another desktop client.
Node TLS terminates at the Node's Peer ingress. The Relay retains no Team data,
invitation secrets, Node TLS keys or Peer business credentials.

This implements the transport in [ADR-0070](../../docs/adr/0070-relay-tunnel-access.md).
CA enrollment, certificates, Node configuration and business authorization belong
to the Local Node. Running this binary neither grants Room access nor enables a
local Runtime.

The [operator deployment guide](../../docs/relay-deployment.md) covers the
repository-root Docker build, Compose example, DNS, certificate renewal, service
profiles and production admission. Example domains are placeholders and do not
represent an operated ConveneWire service.

## Operator setup

Use a dedicated Node domain with wildcard DNS pointing directly to this service.
Provide a separate control HTTPS hostname and its certificate/key. The TLS port
must reach this process as raw TCP: a generic HTTP reverse proxy or CDN that
terminates Node TLS changes the intended trust boundary. Public TCP 80 must reach
the challenge listener for HTTP-01 validation.

Build from this directory with Go 1.26.7:

```sh
go build -o convenewire-relay ./cmd/convenewire-relay
./convenewire-relay \
  --relay-origin https://relay.example.org \
  --node-domain nodes.example.org \
  --tls-listen :443 --http-listen :80 \
  --tls-cert /etc/convenewire-relay/control-chain.pem \
  --tls-key /etc/convenewire-relay/control-key.pem
```

Expose the configured listener ports through the operator's normal service
manager/container networking. Protect the control private key and arrange its
renewal separately. This daemon never invokes a CA or edits DNS. SIGINT/SIGTERM
close listeners, registrations, pending opens and established streams, and wait
for owned transport workers. Reconnection needs a new signed registration and
new in-memory session token; no stream bytes are replayed.

Each Node hostname is `n` plus the first 40 lowercase hex characters of SHA-256
over its raw Ed25519 public key, followed by `.` and the Node domain. Registered
addresses are stable. An active registration cannot be replaced. The control
service paths are `/v1/relay/control` and `/v1/relay/stream`; neither accepts a
query string, browser Origin, Cookie or inherited business authentication.

Port 80 accepts only `GET /.well-known/acme-challenge/<token>` for a currently
registered exact hostname. Requests with cookies or authentication are rejected.
The Relay constructs a new challenge request with only Host and Connection;
it returns only a bounded successful text body. Upstream cookies, redirects and
other response headers are discarded. Arbitrary forwarding targets and normal
HTTP application paths are unavailable.

## Limits and failure behavior

Defaults are 512 inbound connections, 128 Nodes, 32 pending/active streams per
Node and 256 MiB total bidirectional data per stream. CLI options can lower or
raise these policy limits. A TLS ClientHello is capped at 64 KiB and ten seconds;
fragmentation across TCP and TLS records is supported, and all consumed bytes
are replayed unchanged. Control and data frames are capped at 64 KiB. An
oversized data frame is rejected before its payload is forwarded. Copy buffers
and backpressure bound memory; there is no unlimited in-memory traffic queue.

A registration challenge expires after 30 seconds. A pending stream expires
after ten seconds. Established streams have a two-minute activity deadline.
Control ping runs every twenty seconds with a ten-second response deadline.
Stream deadline/limit failure closes that stream. A control disconnect revokes
its token, closes every attached stream and cancels pending opens. Public clients
observe normal connection failure and must follow their application retry rules.
The Relay never retries a business operation or replays an interrupted request.

Only listener addresses are logged. The `Stats` API exposes connection/Node/stream
counts, with no identities, tokens, request bodies or routing names. Do not add
request/header dumps when diagnosing production failures. HTTP/3 and ECH routing
are outside this increment.

Control HTTPS `GET /healthz` returns only `ready` after listener startup. It
uses the same exact Host, method, path and credential rejection rules as the
control endpoints. The CLI `healthcheck` command verifies control TLS and both
loopback listeners within four seconds, without creating Node registrations.
It does not assess public DNS, CA validation or individual Node availability.

The Relay operator can observe connection addresses, timing and volume. Node
certificate validation follows normal public-domain/CA trust. An operator that
controls the domain or validation route could obtain a different valid
certificate and actively intercept TLS. The design does not claim secrecy
against a malicious domain/validation-route operator. No Node wildcard private
key is shared with clients or installed in this daemon.

## Embedding and local verification

The public Go package exposes `New(Config)`, `Serve(tlsListener, http01Listener)`,
`Close()` and credential-free `Stats()`. Config accepts an injected control
`tls.Config` and tighter time/resource limits. Tests use nonprivileged loopback
listeners, fixture-only CA roots and explicit DNS dialing; production does not
skip TLS verification. Registered messages carry a hostname without a port.
Non-default control-origin ports can also serve the fixture Node HTTPS origin.

From the repository root:

```sh
node scripts/test/run-with-temp-root.mjs --cwd ops/convenewire-relay \
  --timeout-ms 180000 -- sh -c \
  'export GOPATH="$CONVENE_WIRE_TEST_RUN_ROOT/go-path"; go test -race ./... && go vet ./...'
```

The repository wrapper owns temporary files and Go caches. The extra task-local
GOPATH also isolates Go checksum-database writes. Tests exercise actual TLS and
WebSocket traffic, public challenge boundaries, replay and route hijack denials,
fragmented ClientHello, quotas, backpressure, token expiry and shutdown. They
contact no public CA, external model, installed Node or real Owner account.
