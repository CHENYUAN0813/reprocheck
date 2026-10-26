# Hosted scanning with one Python rule set

The Worker serves the frontend and forwards `/api/scan` to FastAPI. It no longer
contains a JavaScript scanner. The local app and CLI use the same Python modules.
Docker execution remains local-only and hosted execution routes still return 501.

## Deploy the scan service first

Build from the repository root:

```sh
docker build -f backend/Dockerfile -t reprocheck-scan:local .
```

The Dockerfile-specific ignore file excludes local history, private checkouts,
credentials, `.git`, virtual environments and frontend dependencies from the build
context. The service includes Node solely for the existing execution-option validator;
repository fetching and report generation run in Python. It does not mount or use
the Docker socket and does not execute downloaded repository code.

On a container host, configure:

| Setting | Purpose |
| --- | --- |
| Port `8000` | FastAPI listener, behind the host's HTTPS ingress |
| `SCAN_SERVICE_TOKEN` | A random secret of at least 32 characters, held in the host secret store |
| `GITHUB_TOKEN` | Optional GitHub API credential, stored only on the scan service |
| Health path `/health` | Public readiness endpoint, contains no configuration |

All scan requests in hosted mode require `Authorization: Bearer <SCAN_SERVICE_TOKEN>`.
Do not place either secret in frontend variables or Git. Without hosted-mode
configuration, FastAPI retains its local Host/Origin gate. Configure the hosting
platform's request timeout to allow the scanner's 180-second deadline.

## Configure the Worker after the service is healthy

Set these in the Worker's server-side environment/secrets:

- `SCAN_SERVICE_URL`: the deployed service's HTTPS origin (no credentials, query or fragment).
- `SCAN_SERVICE_TOKEN`: the same secret as on the scan service.

Remove the old Worker `GITHUB_TOKEN` after the switch; the Worker no longer uses it.
The Worker authenticates to the service and forwards JSON. User cookies, browser
authorization headers and GitHub credentials are not forwarded. Redirects are
rejected. Missing service configuration returns 503; service authentication/network
failures return a sanitized 502. There is no fallback JavaScript scanner.

Deploy the service before publishing this Worker build. An existing hosted site
needs both new settings; publishing the new Worker without them disables hosted
scans until configuration is supplied. Local app/CLI use does not need either setting.
The managed local launcher clears `SCAN_SERVICE_TOKEN` in its child environment;
local app and CLI connections always use the local Host/Origin gate.

## Checks and deployment status

`npm run test:scan` covers the frozen report contracts, Worker forwarding for all
eight presets, pinned commits, missing configuration, error masking and Python
hosted authentication. `npm run test:scan:docker` covers the local execution chain.

These tests do not provision a cloud host or change a live site's secrets. Live
cutover requires a deployed HTTPS service and the two Worker settings above; it
must not be reported as complete based only on a successful local build.

Local acceptance on 2026-10-26 built this image and ran it with a temporary
service token: unauthenticated requests returned 401, and Worker forwarding to
the container produced the same complete BTHOWeN report as the CLI. The test
transport mapped the configured HTTPS origin to a loopback container port;
public DNS, ingress TLS and a live cloud deployment were not exercised.
