---
id: T-039
title: Unsubscribe + CCPA delete link — add 30-day expiry (HIGH-1)
assigned_to: vollos-backend
priority: high
status: in_progress
spawn_started_at: 2026-04-20T09:30+07:00
security_checkpoint: true
owned_files:
  - apps/api/src/routes/leads.ts
  - apps/api/src/routes/unsubscribe.ts
  - apps/api/src/routes/delete.ts
  - apps/api/src/config/unsubscribe.ts
  - apps/api/src/email/templates/autoReply.ts
  - apps/api/test/**
dependencies: []
---

## Context

Security audit `security-check-output/20260420_091511/security_report_human.md` flagged HIGH-1:
- Current unsubscribe token = `HMAC-SHA256(UNSUBSCRIBE_SECRET, leadId)` — **no expiry**
- Same token reused for CCPA delete link
- Token never expires → indefinite validity → if email leaks or gets compromised years later, attacker can still unsubscribe/delete records

Current code:
- `apps/api/src/routes/leads.ts:52-54` — token generator
- `apps/api/src/routes/unsubscribe.ts:112-117` — HMAC verify
- Delete link format: `https://vollos.ai/api/v1/delete?id=<uuid>&token=<hex>` (see `leads.ts:165, 221, 334, 388`)

## Goal

Add 30-day expiry to unsubscribe and CCPA-delete tokens using a signed-timestamp scheme.

## Design (recommended — agent may propose alternative with justification)

New token format: `<timestamp>.<hmac>` where:
- `timestamp` = Unix seconds at issue time, base36 encoded (e.g. `1xxxxxxx`)
- `hmac` = `HMAC-SHA256(UNSUBSCRIBE_SECRET, "<leadId>:<timestamp>")`, hex encoded, lowercased

Verification:
1. Split on `.` — must have exactly 2 parts
2. Parse timestamp; reject if NaN or > now or < now - 30 days
3. Recompute HMAC over `"<leadId>:<timestamp>"` and `timingSafeEqual` vs provided
4. If any step fails → return the existing `HTML_INVALID` (400) response

URL format stays the same (`?id=<uuid>&token=<...>`) — only the token content changes.

## Scope

1. Update `generateUnsubscribeToken(leadId)` to include timestamp; rename to `generateSignedToken(leadId)` for clarity (keep as private helper)
2. Update verification in `unsubscribe.ts` + `delete.ts` (or the CCPA delete route — find it first) to parse + validate timestamp + HMAC
3. Update token format regex (`TOKEN_RE = /^[0-9a-f]{64}$/` → new regex matching timestamp.hmac form)
4. Update tests that assume old format — especially any fixture HMAC in existing tests
5. **Validate-mode breaking change is acceptable** — owner confirmed no production lead email has been sent that matters yet. But: in the commit message + MR description, explicitly list this as a breaking change (old emails' links will stop working). Do NOT add backward-compat for old unsigned tokens.
6. Add unit tests:
   - valid token — pass
   - expired token (31 days old) — reject
   - future timestamp — reject
   - tampered hmac — reject
   - malformed token (no dot) — reject
   - valid token but wrong leadId — reject

## Workflow

1. Start from clean `origin/main` (fetch + branch): `git fetch origin && git checkout -b fix/unsubscribe-link-expiry origin/main`
2. Implement + tests
3. `pnpm typecheck && pnpm lint && pnpm test` — all green
4. Commit with conventional message: `fix(security): add 30-day expiry to unsubscribe + delete tokens`
5. Push branch + open MR (use `glab` or GitLab API with `VOLLOS_CLI` from `/home/ipon/workspace/vollos/.env`)

## Placeholder Audit

Before output.md — run:
```
grep -n "alert(\|coming soon\|TODO\|TBD\|mock\|not implemented\|Phase [0-9]" <all changed files>
```
Report `placeholders_remaining` field.

## Acceptance Criteria

1. [ ] New token format implemented + exported from shared helper
2. [ ] `unsubscribe.ts` verifies timestamp + HMAC + returns HTML_INVALID on expiry
3. [ ] CCPA delete route verifies timestamp + HMAC likewise
4. [ ] All 6 unit test cases above present and passing
5. [ ] `pnpm typecheck && pnpm lint && pnpm test` all green
6. [ ] Branch pushed + MR opened; MR URL returned
7. [ ] Commit message uses conventional format with `fix(security):` prefix
8. [ ] MR description notes breaking change + verification steps
9. [ ] No secrets in code/commit/MR
10. [ ] `self_review` field complete — every field has `result` + `evidence: file:line`

## Self-Review (Mandatory per CLAUDE.md)

ทุก field ต้องมี `result: true/false` + `evidence: file:line — description`

## Deliverable

`/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-039/output.md`
