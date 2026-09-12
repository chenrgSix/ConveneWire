# Relay operator deployment

This guide deploys the separate service defined by
[ADR-0070](adr/0070-relay-tunnel-access.md). Implementation and transport limits
are documented in the [daemon README](../ops/convenewire-relay/README.md).
Examples use reserved domains; no hosted Relay or CA is supplied by the project.
These are operator instructions, not evidence of an actual public deployment.

## Public routing and trust

Provide a public control origin, for example `https://relay.example.org`, and a
dedicated Node domain, for example `nodes.example.org`. The daemon's flags and
the distributed profile must agree exactly. Use canonical lowercase DNS names;
omit the default HTTPS port and trailing slash. Production uses external 443.
Non-default public ports are available for controlled fixtures, where Node HTTPS
origins use the same port as the control origin.

| Public entry | Destination | Purpose |
| --- | --- | --- |
| `relay.example.org` A/AAAA | Relay server | Control HTTPS and outbound Node WSS |
| `*.nodes.example.org` A/AAAA | Same Relay server | Per-Node TLS SNI routing |
| TCP 443 | Raw TCP to container 8443 | Control TLS or unchanged Node TLS |
| TCP 80 | Container 8080 | Exact Node HTTP-01 challenge only |

Only publish AAAA records when IPv6 reaches both listeners. HTTP-01 requires
public port 80; validation can come from multiple CA vantage points. Do not
redirect challenge traffic, add a login gateway or restrict it to a guessed CA
IP list. The Relay rejects other HTTP application requests.
[Let's Encrypt challenge documentation](https://letsencrypt.org/docs/challenge-types/)
describes these validation requirements.

Do not put a TLS-terminating CDN, HTTP reverse proxy or PROXY-protocol prefix in
front of 443. Raw TCP forwarding must preserve the ClientHello. The current
service keeps routing and tokens in memory: one active process owns a domain's
registrations. Round-robin replicas without shared route ownership cannot reach
each other's Nodes. HTTP/3 and encrypted ClientHello routing are unsupported.

Supply a publicly trusted certificate chain and private key for the **control
hostname only**. This daemon does not request or renew it. Each Node obtains and
stores its own certificate key using HTTP-01 through its outbound connection;
do not give the Relay a Node wildcard certificate. Relay traffic forwarding
preserves Node TLS, but the domain/validation-route operator remains trusted:
an operator controlling validation could obtain another valid certificate and
intercept TLS. This release does not claim protection against that operator.

## Image and Compose configuration

Build with a Docker/BuildKit installation that supports Dockerfile-specific
ignore files. Run from the repository root:

```sh
docker build -f ops/convenewire-relay/Dockerfile -t convenewire-relay:local .
```

The Go 1.26.7 build stage uses the repository contracts through its existing
relative module replacement. The final scratch image contains the static
executable, CA roots and license notices, runs as UID/GID `65532`, and has no
shell or package manager. TARGETOS/TARGETARCH support cross compilation through
BuildKit. Pin and record the approved base/image digest in the operator's
release process before publishing a production image.

The sibling `Dockerfile.dockerignore` explicitly allows the Relay module and Go
contracts, and excludes local secrets. It is necessary because the root ignore
file targets the Central image and excludes `ops/`. Docker documents the
[per-Dockerfile ignore precedence](https://docs.docker.com/build/concepts/context/#dockerignore-files).

Create an operator configuration file **outside the checkout**, with real values:

```dotenv
RELAY_ORIGIN=https://relay.example.org
RELAY_NODE_DOMAIN=nodes.example.org
RELAY_CONTROL_TLS_DIRECTORY=/etc/convenewire-relay/control-tls
RELAY_IMAGE=convenewire-relay:local
```

The certificate directory must already contain `control-chain.pem` and
`control-key.pem`. On a Linux host, use operator-owned files readable by group
65532 (for example directory mode `0750`, file mode `0640`); do not make the key
world-readable. Mount a dedicated directory, not an ACME client's unrelated
account state. The Compose bind mount is read-only and refuses to create a
missing source directory. The daemon reads certificate material at startup.

Validate without starting a container:

```sh
docker compose --env-file /etc/convenewire-relay/operator.env \
  -f ops/convenewire-relay/compose.example.yaml config --quiet
```

After the operator has provisioned DNS, certificates, firewall rules and the
approved image, start it explicitly:

```sh
docker compose --env-file /etc/convenewire-relay/operator.env \
  -f ops/convenewire-relay/compose.example.yaml up -d --no-build
```

The example maps host 80/443 to nonprivileged container 8080/8443, drops all
capabilities and disables privilege escalation. It has a read-only root, no
persistent data volume, a 512 MiB memory ceiling, 384 MiB Go soft memory target,
one CPU, 128-process ceiling, 4096 file descriptors and rotating bounded logs.
Those are starting limits for a small deployment, not measured capacity.

## Health, renewal and restart

The image's own binary supplies the Compose healthcheck; no shell or curl is
needed. It verifies control HTTPS `/healthz` with the configured hostname and
normal CA validation, then checks the HTTP-01 listener's fixed rejection path.
It dials loopback addresses only, bypasses proxy environment variables, follows
no redirects and completes within four seconds. Health output contains no
registration, credentials or traffic metadata.

```sh
docker compose --env-file /etc/convenewire-relay/operator.env \
  -f ops/convenewire-relay/compose.example.yaml exec relay \
  /convenewire-relay healthcheck --relay-origin https://relay.example.org
```

A successful probe means the local listeners and control certificate are ready.
It does not verify public DNS, firewall reachability, Node presence, ACME issuance
or Room/Runtime permissions. It can fail under connection saturation; do not
treat the health label alone as permission to restart a busy server. Compose
records `unhealthy` but its restart policy handles process exit, not that label.
See the [Compose service reference](https://docs.docker.com/reference/compose-file/services/).

Renew the control certificate through the operator's existing certificate
system, replace files safely within the mounted directory, and restart the
daemon to load them. Monitor expiry separately and schedule renewal before
expiry; the daemon has no hot reload. SIGTERM closes all listeners, cancels
registrations and pending streams, closes active streams and waits for workers.
Compose allows 15 seconds before force termination. Nodes reconnect with fresh
signed registration/token state. Interrupted business requests are not replayed.

The daemon needs no state backup. Preserve each Node's private identity, ACME
account and certificate state through the existing Node backup procedure.
Deleting that state to retry issuance can consume CA limits and change identity.
For a restored Node, certificate issuance/renewal still requires an active Relay
connection and working HTTP-01 routing.

## Public service profile and Node distribution

Copy [relay-service.example.json](../ops/convenewire-relay/relay-service.example.json)
to an operator-controlled regular file named `relay-service.json`. Replace every
example value before use: set the real service ID/name, matching origin/domain,
the selected CA's HTTPS directory and its exact currently advertised HTTPS
terms-of-service URL. The Node rejects an unreviewed change to that URL; publish
a revised profile so the Owner can explicitly accept the updated terms. No account keys, session tokens, cookies or passwords belong in the file.
The example CA URL is deliberately non-operational.

After installing the repository's locked Node 22 dependencies, validate the
profile locally; this does not contact the service or CA:

```sh
node scripts/local-node/relay-profile.mjs /operator/distribution/relay-service.json
```

The validator enforces the closed contract, regular-file/no-symlink boundary and
16 KiB ceiling, and prints the service ID, origin, domain, size and SHA-256 digest.
Pass the exact file explicitly when building a Node bundle or desktop package:

```sh
node scripts/local-node/bundle.mjs build /operator/distribution/local-hub \
  --relay-profile /operator/distribution/relay-service.json
```

The alternative `--relay-profile-env` flag explicitly opts into
`CONVENE_WIRE_RELAY_PROFILE_FILE`; an environment variable alone does not inject
a service. Native packaging accepts the same profile selection flags; follow
the [packaging commands](development-commands.md) for its required native inputs.
The bundle carries only the public profile and integrity metadata. Local Owner
consent remains necessary before Node network changes, CA enrollment and terms
acceptance. Missing profile means no configured convenient-access service.

Before inviting users, agree CA account/terms handling and capacity. Let's
Encrypt currently permits 50 new certificates per registered domain in seven
days across all accounts; adding a per-Node account does not remove that limit.
The identical identifier set has a separate five-per-seven-day limit. Request
an override before a larger rollout and respect `Retry-After`. ARI-coordinated
renewals have broader exemptions; do not assume a client uses ARI without
implementation evidence. Recheck the current
[CA rate limits](https://letsencrypt.org/docs/rate-limits/) during admission.

## Verification boundaries

The dedicated [Relay CI workflow](../.github/workflows/relay.yml) uses the
repository's pinned action versions and Go 1.26.7, runs all daemon tests with the
race detector and vet in a disposable test root, checks formatting, and validates
Compose configuration. It does not deploy infrastructure, accept CA terms or
publish an image. Existing TypeScript/Go interoperability checks remain separate.

Before admitting a public service, the operator still needs actual image build
and runtime evidence on its target architecture, public IPv4/IPv6 DNS/port
verification, controlled CA issuance and renewal evidence, capacity/load
measurements, certificate replacement and restart evidence, and browser/Peer
acceptance. Local fixtures, static Compose validation and a configured CI file
do not establish those external results.
