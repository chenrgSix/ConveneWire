module convenewire.dev/relay

go 1.26.7

require (
	convenewire.dev/contracts v0.0.0
	github.com/coder/websocket v1.8.15
)

require (
	github.com/santhosh-tekuri/jsonschema/v6 v6.0.3 // indirect
	golang.org/x/text v0.14.0 // indirect
)

replace convenewire.dev/contracts => ../../packages/contracts
