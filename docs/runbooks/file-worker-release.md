# File-worker release and rollback runbook

## Build and acceptance

1. Build `docker/file-worker.Dockerfile` for `linux/amd64`.
2. Run manifest, hostile archive, checksum, credential, network, resource,
   timeout, cancellation, and orphan-cleanup tests.
3. Generate an SPDX SBOM.
4. Scan the image with the CI vulnerability policy: unfixed `CRITICAL`
   findings block release.
5. On main or a `file-worker-v*` tag, publish
   `ghcr.io/<owner>/vhb-file-worker:sha-<commit>`.
6. Copy the digest emitted by the publish step, never the mutable tag, into the
   staging deployment variable `FILE_WORKER_IMAGE`.

The current local development image is `vhb-file-worker:dev`. It is not a
release and must never be copied into staging or production configuration.

## Staging rehearsal

- Confirm the configured reference contains `@sha256:`.
- Run one clean CSV, clean XLSX, traversal archive, high-ratio archive, macro,
  external-link, formula, timeout, and cancellation case.
- Verify result protocol/tool versions and every artifact checksum.
- Verify `docker inspect` reports no network, a read-only root, non-root user,
  dropped capabilities, `no-new-privileges`, and configured limits.
- Verify no container or temporary job directory remains.

## Rollback

Keep the prior approved digest with its SBOM and scan evidence. Roll back by
replacing `FILE_WORKER_IMAGE` with that prior digest and restarting only the
trusted durable workers. Re-run clean and hostile smoke cases. Do not retag or
overwrite either image.

## Ownership and cadence

- Platform Engineering owns the image and protocol.
- Security owns scan exceptions; exceptions require an expiry and linked risk
  acceptance.
- Review base-image and Python security updates monthly and on critical CVEs.
- Protocol changes are backward-incompatible only with a new major protocol
  version; tool additions update the reported worker version and golden tests.
