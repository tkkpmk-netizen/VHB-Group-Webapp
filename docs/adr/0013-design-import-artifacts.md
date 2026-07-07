# ADR 0013: Design Imports Normalize to Web Designer Source

Status: Accepted  
Date: 2026-07-07

## Context

DP4 must let users design locally in tools such as Penpot, Figma, or static
HTML exporters, then continue editing inside the VHB Web Designer. The server
must not embed a full design tool runtime, because that would increase
deployment weight and blur the boundary between editor source and published
site artifacts.

## Decision

Add a dedicated import boundary:

- `POST /site-pages/{page_id}/import-design` replaces the selected page's
  designer source.
- Supported MVP payloads are generic HTML/CSS, Figma HTML/export, Penpot
  HTML/export, and GrapesJS project JSON.
- Every accepted import is normalized to `SitePage.content.type = "grapesjs"`.
- Import metadata is stored in `SitePage.content.meta`, including source type,
  source name, and import timestamp.
- HTML/CSS imports are sanitized on the server before persistence.
- GrapesJS project JSON imports are treated as editor source and are not
  rendered directly as a production visitor artifact.

## Rationale

The import endpoint gives DP4 a narrow contract that both local design tools and
future asset pipelines can target. The Web Designer remains the canonical admin
editor, while DP5 can build deployable artifacts from one consistent source
shape.

## Consequences

- Figma/Penpot are integration sources, not runtime dependencies.
- Imported HTML/CSS may lose executable behavior by design; real interaction
  should be rebuilt through DP5 components and data-binding markers.
- Server sanitization reduces risk from pasted/exported artifacts, but DP5 still
  needs a strict production renderer/build step before public deployment.
- Future import workers can upload assets to object storage and reference them
  from the same `grapesjs` source envelope.
