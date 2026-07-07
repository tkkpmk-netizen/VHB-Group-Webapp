# ADR 0015: Domains, Environments, and Deployment Rollback

Status: Accepted  
Date: 2026-07-07

## Context

DP5 introduced build artifacts and `SiteDeployment` records. DP6 needs public
routing controls so a site can support production/preview environments, custom
domains, and rollback without rebuilding old artifacts.

## Decision

Extend the deployment model instead of replacing DP5:

- `SiteDeployment.environment` identifies `production` or `preview`.
- `SiteDeployment.active` marks the deployment served for a site/environment.
- Successful build jobs auto-activate the new deployment for its environment.
- `POST /site-deployments/{deployment_id}/promote` switches the active
  deployment and is also the rollback mechanism.
- `SiteDomain` maps a hostname to a site and environment, with `verified` and
  `primary` state.
- Public slug rendering and public domain rendering both resolve to the active
  ready deployment for the requested environment.

## Rationale

Rollback should be a metadata operation, not a rebuild. Keeping all successful
deployment artifacts in object storage allows the system to promote any ready
version instantly while preserving build history and audit events.

Domains are modeled as first-class platform records because DNS/routing state is
platform metadata, not dynamic business data.

## Consequences

- DP7 and later collaboration features can edit source independently from the
  active production deployment.
- Domain verification is represented in the database; automated DNS verification
  can be added later without changing public render semantics.
- Production and preview can diverge safely because they have independent active
  deployment pointers.
- Cache invalidation in a later edge/CDN layer should key on deployment id and
  environment.
