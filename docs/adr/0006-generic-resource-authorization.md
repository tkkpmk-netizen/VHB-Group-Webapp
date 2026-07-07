# ADR 0006: Generic Resource Authorization

Date: 2026-07-06  
Status: Accepted

## Context

Database permissions were stored in `DatabaseGrant`, while Documents and future
Dashboards/Sites had no reusable resource-level policy. Adding one grant table
per domain would duplicate enforcement and make cross-domain security behavior
drift.

## Decision

Use one workspace-scoped `ResourceGrant`:

- `resource_type`
- `resource_id`
- `user_id`
- `role` (`viewer`, `editor`, `manager`)

The unique key is workspace + resource type + resource id + user. The central
policy maps roles to `read`, `write`, and `manage` actions.

Owner and admin memberships always have all actions. For other members, an
explicit resource grant replaces the workspace default for that resource. This
allows both elevation and restriction. Without a grant, the workspace role is
used.

Resource existence and workspace ownership are validated through the resource
registry before grant mutations. Because a polymorphic resource id cannot have
a database foreign key to multiple tables, each resource deletion explicitly
deletes its grants in the same transaction.

## Consequences

- Database and Document sharing use the same API and UI.
- Dashboard and Site domains can join the policy by registering their resource
  type and scoped model.
- Every new resource delete path must call generic grant cleanup.
- Authorization is enforced server-side; UI visibility is only a convenience.

## Revisit

Add team/group principals, inherited Space/Folder grants, explicit deny, and
batched policy evaluation only when product requirements need them.
