# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.26.7-bookworm AS build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY packages/contracts/go.mod packages/contracts/go.sum ./packages/contracts/
COPY ops/convenewire-relay/go.mod ops/convenewire-relay/go.sum ./ops/convenewire-relay/
WORKDIR /src/ops/convenewire-relay
RUN go mod download
COPY packages/contracts/generated/go /src/packages/contracts/generated/go
COPY ops/convenewire-relay /src/ops/convenewire-relay
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/convenewire-relay ./cmd/convenewire-relay

FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /out/convenewire-relay /convenewire-relay
COPY LICENSE NOTICE /licenses/
USER 65532:65532
EXPOSE 8080 8443
STOPSIGNAL SIGTERM
ENTRYPOINT ["/convenewire-relay"]
