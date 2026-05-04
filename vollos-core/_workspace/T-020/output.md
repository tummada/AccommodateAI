---
task_id: T-020
status: completed
agent: vollos-backend
delivered_at: 2026-04-18T23:05:00+07:00
branch: fix/ccpa-delete-clear-ip-ua
commit: e09dae3
merge_request: https://gitlab.com/vollos-ai/vollos-core/-/merge_requests/17
---

## Secret Handling Acknowledgment

secret_handling_acknowledgment:
  read_forbid_list: true
  will_not_log_real_pii_values: true
  will_use_rfc5737_test_ip_only: true
  will_use_synthetic_user_agent_only: true
  will_not_display_env_or_secrets: true

Note: No real IP, real user-agent, real email, or any env secret appears in the
diff, the tests, this output, or any error path. All PII-shaped fixtures use
RFC 5737 TEST-NET-1 (192.0.2.1), example.com (RFC 2606), and a synthetic
`test-user-agent/1.0` string.

## Skill Loaded Evidence

skill_loaded_evidence:
  files_read:
    - "SKILL.md:L30-34 — SECRET HANDLING non-negotiable — no log/display of env/secret values, sanitize error responses"
    - "SKILL.md:L217 — Always check owned_files before writing — scope limited to deletion handler + corresponding test"
    - "SKILL.md:L285 — Drizzle query safety — update must have .where(eq(...)); enforced at deletion.ts:L138"
    - "SKILL.md:L255-274 — Self-Review Protocol 5 questions — evidence-based self_review below"

## Files Changed

files_changed:
  - path: apps/api/src/routes/deletion.ts
    action: modified
    change_summary: |
      Added `ipAddress: null` and `userAgent: null` to the UPDATE payload at
      deletion.ts:L132-L139 so that soft-delete clears every CCPA identifier
      alongside email/name/company. Added a 3-line comment at deletion.ts:L127-L129
      citing CCPA §1798.105 as rationale. Where clause (`.where(eq(leads.id, id))`)
      unchanged — still mutates exactly one row.
  - path: apps/api/src/routes/deletion.test.ts
    action: created
    change_summary: |
      New unit test suite (4 tests) covering: (1) happy-path delete verifies full
      UPDATE payload including ipAddress=null + userAgent=null, (2) forged HMAC
      token → 400, update NOT invoked, (3) already-deleted lead → 200, update
      NOT invoked, (4) guardrail asserting test fixtures stay synthetic
      (RFC 5737 + synthetic UA).

## Build + Test Output

build_verified: true
build_output: |
  > @vollos/api@0.0.0 build /home/ipon/workspace/vollos-ai/vollos-core/apps/api
  > tsc
  (exit 0 — no TypeScript errors)

tests_written:
  - path: apps/api/src/routes/deletion.test.ts
    count: 4
test_output: |
  > @vollos/api@0.0.0 test
  > vitest run

   RUN  v4.1.4 /home/ipon/workspace/vollos-ai/vollos-core/apps/api

   Test Files  5 passed (5)
        Tests  38 passed (38)
     Duration  359ms

  (4 new deletion tests + 34 pre-existing — no regression)

## Placeholders Remaining

placeholders_remaining: |
  none — grep clean on both changed files.
  Matches found for the token "mock" are legitimate Vitest mock API usage
  (vi.fn().mockReturnValue / mockResolvedValue / vi.mock(...)) — same
  pattern already used in leads.test.ts. No `alert()`, `TODO`, `coming soon`,
  `TBD`, `not implemented`, or `Phase N` present.

## Dependency Audit

dependency_audit:
  level_requested: moderate
  findings:
    - package: esbuild (transitive via drizzle-kit)
      severity: moderate
      cve_ref: GHSA-67mh-4wv8-2f99
      status: pre-existing on main — unrelated to this MR
      scope: dev dependency only (drizzle-kit migration tooling, not runtime)
      recommendation: |
        Bump drizzle-kit in a separate chore MR. Not blocking for T-020 since
        esbuild ≤0.24.2 is only reachable via `drizzle-kit generate/migrate`,
        which runs locally, never inside the API container.

## Self-Review (evidence-based)

self_review:
  input_validated:
    result: true
    evidence: |
      deletion.ts:L90 — UUID_RE + TOKEN_RE format check rejects malformed
      id/token before any DB access. deletion.ts:L114-L119 — HMAC verified
      with timingSafeEqual. No user input reaches the UPDATE path without
      passing both checks.
  null_handled:
    result: true
    evidence: |
      deletion.ts:L109 — `if (!lead)` handles empty select result. deletion.ts:L122
      — `if (lead.deletedAt !== null)` handles re-delete attempts without
      re-running UPDATE (verified by deletion.test.ts:L158-L173).
  errors_caught:
    result: true
    evidence: |
      deletion.ts:L103-L106 (select), L139-L142 (update), L151-L154 (audit)
      each wrap the DB call in try/catch and return a non-leaking HTML 500 /
      continue path. No `err.stack` is exposed; only `err.message` is logged
      server-side via `console.error`.
  race_condition_safe:
    result: true
    evidence: |
      deletion.ts:L122 — `if (lead.deletedAt !== null)` short-circuits before
      UPDATE, so a second concurrent request performs no mutation. The UPDATE
      itself is idempotent: `email` is replaced with a deterministic
      `deleted_${id}@anonymous` keyed on PK, and the unique constraint on
      email is not violated because each deleted row has a distinct id.
  security_checked:
    result: true
    evidence: |
      (1) Parameterized query via Drizzle `eq(leads.id, id)` — no SQL
      concatenation. deletion.ts:L138.
      (2) No hardcoded secret — HMAC key comes from
      `UNSUBSCRIBE_SECRET` imported from ../config/unsubscribe.js (env-backed).
      deletion.ts:L9, L114.
      (3) Test file uses RFC 5737 192.0.2.1 + synthetic UA — no real PII.
      deletion.test.ts:L83-L85.
      (4) UPDATE now clears every CCPA identifier listed in the issue
      (email/name/company/ipAddress/userAgent) per deletion.ts:L131-L138.

## Acceptance Criteria Checklist

- [x] AC1 — Delete handler updated to clear `ipAddress` + `userAgent` (deletion.ts:L135-L136)
- [x] AC2 — Unit test verifies both fields null after delete (deletion.test.ts:L112-L113)
- [x] AC3 — No regression — existing email/name/company/deleted_at anonymization preserved and asserted (deletion.test.ts:L116-L122)
- [x] AC4 — Audit log entry still created with masked metadata, no IP/UA in audit metadata (deletion.ts:L146-L150; verified: insert called once in happy-path test)
- [x] AC5 — `pnpm test` passes in apps/api (38/38 green — 4 new + 34 existing)
- [x] AC6 — Feature branch `fix/ccpa-delete-clear-ip-ua` (git branch --show-current confirms)
- [x] AC7 — Conventional commit: `fix(api): CCPA — clear IP + user_agent on lead delete` (commit e09dae3)
- [x] AC8 — MR to main — https://gitlab.com/vollos-ai/vollos-core/-/merge_requests/17
- [ ] AC9 — Pipeline green — pending CI run (will be visible on the MR page)
- [x] AC10 — Self-review evidence-based with file:line (above)

## Out-of-Scope Respected

- Email retention logic: untouched (still anonymizes to `deleted_<uuid>@anonymous`)
- `deleted_at` timestamp logic: untouched
- Audit log structure: untouched (same `{email_masked}` metadata key)
- Schema: untouched (fields already existed per T-019 schema_findings)
- No SSH to VPS (not needed — unit-test only)

## Re-anchor Checkpoint

re_anchor:
  sub_task: "CCPA delete completeness fix"
  scope_ok: yes (only owned_files touched)
  security_rules_middleware_order: n/a (route handler change, not middleware)
  no_agent_tool_spawned: true
  no_hardcoded_secrets: true
  drizzle_where_clause_present: true (deletion.ts:L138 — `.where(eq(leads.id, id))`)
  no_pii_in_logs_or_output: true

## Notes

- The fix is a 2-line UPDATE payload addition plus a 3-line CCPA citation
  comment. No behavior change for valid tokens beyond the two extra
  nulls; no behavior change for invalid/expired tokens.
- Tests assert the UPDATE payload by capturing `set(...)` arguments, which
  is more robust than checking the SQL string and mirrors the existing
  `makeUpdateChain` pattern in leads.test.ts.
- Dependency audit surfaces a pre-existing moderate CVE in `esbuild`
  (transitive via `drizzle-kit`). Dev-only, unrelated to T-020 — flagged
  for a separate chore MR.

## Next Action

next_action: |
  Lead actions:
  1. Approve MR #17 after CI goes green.
  2. On merge to main, T-019 issue T-019-I1 can be marked resolved in _board.md.
  3. After deploy, QA can re-run the T-019 DB verification (same 4 queries) on a
     freshly deleted lead to confirm ip_address + user_agent are NULL.
  4. No infra change required; schema unchanged, so no migration to run.
