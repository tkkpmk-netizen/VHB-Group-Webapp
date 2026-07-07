# ADR 0008: Google Identity and Account Linking

Date: 2026-07-06  
Status: Accepted

## Decision

Use Google Identity Services on the web client and send the returned ID token to
the backend. Verify it with Google's official Python client against the
configured Web client ID. Require a verified email and persist the stable
provider `sub` in `IdentityAccount`.

Provider subject, not email, is the login key. If a Google login email already
belongs to a password account, login returns a conflict and the user must first
authenticate normally and explicitly link Google. This avoids account takeover
through automatic email matching.

OAuth-created users have no password hash. Their last identity cannot be
unlinked until another sign-in method exists.

## Consequences

- One VHB user can authenticate through password and Google.
- Google client IDs must match in backend and frontend environments.
- Additional providers can reuse `IdentityAccount`.
- Password setup/recovery for OAuth-only users remains a later account-security
  feature.
