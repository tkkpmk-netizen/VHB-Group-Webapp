# ADR 0010: Google Drive-backed Database Files & Media

Status: Accepted  
Date: 2026-07-07

## Context

Database rows need a `Files & media` field for images and documents. Storing
file bytes in PostgreSQL would bloat the core database, and storing them on the
app server filesystem would make deployment and backup brittle.

## Decision

Use Google Drive as the file-byte store for the Database `files` field.

- The application stores only metadata and row cell references in PostgreSQL.
- Files are uploaded by the backend through a Google service account into a
  configured Google Shared Drive folder.
- The webapp never exposes public Google Drive links. Preview/download content
  is proxied through authorized FastAPI endpoints.
- The initial UI supports multi-file upload, image/PDF/text preview, and delete
  from Table view.
- When a file field, row, or database is deleted, backend cleanup deletes the
  corresponding Google Drive objects before removing local metadata.

## Rationale

Service-account + Shared Drive ownership keeps organization files centralized
and avoids storing per-user OAuth refresh tokens for normal database uploads.
The same API surface can later support per-user Drive OAuth if business
requirements require user-owned Drive files.

## Consequences

- Production requires `GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE` and
  `GOOGLE_DRIVE_FOLDER_ID`.
- The service account must have access to the target Shared Drive folder.
- File previews require authenticated API access; direct browser `<img>` or
  `<iframe>` URLs to the backend are not used because they cannot attach the
  bearer token reliably.
- Large uploads are bounded by `GOOGLE_DRIVE_MAX_FILE_BYTES`; default is
  100 MiB per file.
