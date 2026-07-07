# ADR 0012: Web Designer Uses GrapesJS Project Source

Status: Accepted  
Date: 2026-07-07

## Context

DP1 created Site/Page/DataBinding resources. DP2 added a restricted public
runtime. DP3 needs a visual editor without turning admin requests into build or
deployment work.

## Decision

Use GrapesJS in the admin frontend as the DP3 Web Designer and persist editor
source in `SitePage.content`.

- `SitePage.content.type = "grapesjs"`.
- `SitePage.content.project` stores `editor.getProjectData()`.
- Optional `html` and `css` fields seed new or legacy pages before the first
  GrapesJS save.
- The designer runs only in a Client Component and is dynamically imported to
  avoid server-side browser API usage.
- Data Binding blocks are saved as source markers such as `data-vhb-binding`.

## Rationale

GrapesJS provides a mature page-builder canvas, block manager, and style manager
without embedding Figma/Penpot or storing generated HTML as primary data. Keeping
project source separate from build artifacts preserves the DP5 deployment model.

## Consequences

- Public runtime may return page source JSON, but production visitors should
  eventually receive DP5 build artifacts or a dedicated renderer.
- DP4 import pipelines should output the same source envelope rather than
  bypassing the editor model.
- DP5 build jobs will transform GrapesJS project data plus public data binding
  markers into deployable HTML/assets.
