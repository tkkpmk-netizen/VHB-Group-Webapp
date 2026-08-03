# ADR 0028 — Isolated untrusted-file worker boundary

- Status: Accepted
- Date: 2026-07-30

## Context

Authenticated users can upload customer, supplier, migration, and document
template files. Authentication does not make their contents trustworthy.
Parsing XLSX archives or rendering documents inside FastAPI or the durable
database worker exposes database credentials, object-storage credentials,
network access, and a long-lived filesystem to malformed or hostile inputs.

T2 rendering and T3 migration need one shared boundary before either workload
is implemented.

## Decision

The trusted durable worker stages exactly one input and one versioned manifest
into a temporary read-only bind mount. It launches a one-shot Linux/amd64
container with:

- no network namespace;
- no database, Redis, JWT, SMTP, Drive, or object-storage credentials;
- read-only root filesystem and a bounded `noexec` temporary filesystem;
- all Linux capabilities dropped and `no-new-privileges`;
- non-root UID, PID, CPU, memory, disk-output, and wall-time limits;
- a separate write-only-at-execution output mount.

The file worker has no storage client. The trusted worker performs the object
download and later upload, which is narrower than giving the untrusted process
presigned network access. Cancellation or timeout kills the Docker client,
force-removes the named container, and removes the temporary input and output.

Protocol `1.0` supports `file.scan` and `tabular.inspect`. The manifest binds
job identity, operation, filename, declared type, size, SHA-256, resource
limits, and explicit macro/external-link/formula policy. Unknown fields and
path traversal are rejected. The result binds the same job and input checksum,
security findings, detected type, tool versions, and checksummed artifact
descriptors. The trusted side validates the complete result and every artifact
again before accepting bytes.

The initial scanner checks signature/extension/type agreement, input and
expanded size, archive entry count and compression ratio, archive traversal,
legacy OLE, VBA, Office external links, formulas, malformed archives, and
bounded CSV/XLSX inspection. Unsupported formats fail closed; no fallback
parser is selected.

The image uses a digest-pinned Python base and exact runtime dependencies.
Pull requests build it and run contract/hostile tests. Main/tag CI generates an
SBOM, blocks unfixed critical vulnerabilities, publishes
`ghcr.io/<owner>/vhb-file-worker:sha-<commit>`, and records the immutable
manifest digest. Staging and production accept only `@sha256:` references.

## Options considered

### Parse inside FastAPI or the database worker

Rejected. Resource limits in application code do not remove credentials,
network reachability, parser process state, or filesystem access.

### Give the file worker scoped S3 URLs

Rejected for the initial boundary. Presigned URLs still require outbound
network and create expiry, retry, and egress controls. Trusted staging through
two narrow mounts is easier to audit and test.

### Maintain separate migration and rendering containers

Rejected at the boundary level. They need the same manifest, isolation,
integrity, lifecycle, and release controls. Future parser/renderer toolchains
may use separate image targets but must implement the same protocol.

### Run ClamAV, LibreOffice, and OCR in the first image

Rejected for T0F. This slice establishes the security and release contract.
Tool-specific feasibility and fidelity belong to T2/T3 and require explicit
version, findings, and golden tests rather than an unreviewed fallback.

## Consequences

- Existing direct preview/import parsing is legacy and must migrate through
  this boundary when T3 introduces governed migration intake.
- T2/T3 can add operations only through a protocol-versioned contract.
- Local image tags are development-only; released environments need a digest.
- A timed-out job leaves no reusable container or temporary workspace.
- Malware-engine selection remains a named T2/T3 delivery decision; the current
  static scan never claims to be an antivirus verdict.
