# Peer ingress TLS fixture

These public test credentials are used only by disposable loopback fixtures.
The certificate covers `localhost`, `127.0.0.1` and `::1`, has server-auth usage
and is not a CA. Tests copy the files into an owned private temporary directory;
the production loader never selects these repository files by default.

Expiry tests use the certificate's actual validity boundaries. Live TLS tests
must still validate the supplied fixture certificate without disabling TLS
verification. Replace this fixture when its certificate expires.
