---
id: T-020
title: CCPA Delete compliance — clear IP + user_agent on delete (T-019 finding)
assigned_to: vollos-backend
priority: high
status: in_progress
spawn_started_at: 2026-04-18T22:57:51+07:00
security_checkpoint: true
domain_consultation:
  expert: none_available_in_vollos_core
  note: "No legal expert in this repo's .claude/skills/. Proceed with documented CCPA requirements from memory. Audit will catch issues."
  key_points:
    - "CCPA §1798.105 Right to Delete — IP address is PII, must be cleared"
    - "user_agent = browser fingerprint = PII in aggregate, must be cleared"
    - "Retain email in suppression list only for CAN-SPAM unsubscribe enforcement (separate concern)"
---

## Context

T-019 DB verification found: soft-delete on `vollos.leads` clears email/name/company but **leaves `ip_address` + `user_agent` populated**. Per CCPA §1798.105, IP = personal information and must be cleared on "right to delete" request.

**Current state (T-019 evidence):**
- Owner tested delete button on manual-form lead (`chalermpon.an598@chula`)
- After delete: email anonymized to `deleted_<uuid>@...`, name="Deleted", company cleared, `deleted_at` set
- Audit trail has `lead_deleted_ccpa` action
- **Gap:** `ip_address` and `user_agent` fields still contain original values

## Scope — Minimal change

1. Find delete handler (likely `apps/api/src/routes/leads/delete.ts` or similar)
2. Add to existing anonymization logic:
   - `ip_address = NULL` (or empty string)
   - `user_agent = NULL`
3. Add/update unit test for delete flow:
   - Create test lead with ip + ua
   - Call delete endpoint
   - Assert: ip_address IS NULL AND user_agent IS NULL after delete
4. Add audit log note field or keep existing structure (audit already records with masked metadata — verify it doesn't leak IP/UA)

## Out of scope

- Email retention logic (already correct per CAN-SPAM — don't change)
- Hard delete (current soft-delete is correct approach)
- Delete endpoint authentication/authorization (already works per T-019)
- Schema migration (fields exist, just need UPDATE to NULL them)

## Acceptance Criteria

1. Delete handler updated to clear `ip_address` + `user_agent`
2. Unit test verifies both fields NULL after delete
3. No regression — existing delete behavior (email anonymize, name, company, deleted_at) preserved
4. Audit log entry still created with masked metadata (no IP/UA in audit meta)
5. `pnpm test` passes in apps/api
6. Feature branch `fix/ccpa-delete-clear-ip-ua`
7. Conventional commit: `fix(api): CCPA — clear IP + user_agent on lead delete`
8. MR to main
9. Pipeline green
10. Self-review evidence-based (file:line)

## Owned Files

- `apps/api/src/routes/leads/delete.ts` (or wherever delete handler lives — find first)
- Corresponding test file `apps/api/src/routes/leads/delete.test.ts` (or similar)

## Forbidden

- Do NOT change email anonymization logic (leave as-is)
- Do NOT change deleted_at timestamp logic
- Do NOT change audit log structure
- Do NOT touch schema (fields already exist)
- No SSH to VPS

## Rules

- Read `CLAUDE.md` §§ C (DB), K (Code Quality)
- **Read SKILL.md SECRET HANDLING section** (added via fix01) — no log IP/UA values in test/output
- Read `_workspace/T-019/output.md` for current delete behavior context
- Memory `feedback_secret_handling_protocol.md`
- Test must use mocked IP (e.g., "192.0.2.1" — RFC 5737 TEST-NET-1) not real IPs

## Output

`_workspace/T-020/output.md` with standard YAML (files_changed, self_review, etc.)

Begin.
