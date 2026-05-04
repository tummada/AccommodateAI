---
task_id: T-059
status: completed
spawn_completed_at: 2026-04-20T18:35+07:00
---

## Summary

Shipped a daily cron that hard-deletes `vollos.leads` rows older than 2 years (Thai PDPA §37 + CCPA retention compliance). The script writes one `audit_logs` row before the delete runs so the compliance trail survives any later failure. Failure triggers a Telegram alert via the same env-vars `backup.sh` already uses.

## skill_loaded_evidence

files_read:
  - "SKILL.md:L85 — 'VOLLOS Error Codes' — informed exit-code + audit-log semantics"
  - "SKILL.md:L283 — Pre-Submit Gate: no hardcoded secrets, Drizzle .delete() must have .where(lt(...))"
  - "SKILL.md:L113 — 'Audit Log — บันทึกทุก submission' — drove audit-before-delete ordering"
  - "SKILL.md:L330 — Critical Rules: ห้าม hardcode secrets — script reads DATABASE_URL from env"

## files_changed

- path: apps/api/src/scripts/deleteExpiredLeads.ts
  action: created
- path: apps/api/src/scripts/deleteExpiredLeads.test.ts
  action: created
- path: infra/retention.sh
  action: created
- path: infra/setup-cron.sh
  action: modified  # added 03:15 UTC cron entry
- path: infra/README.md
  action: modified  # documented retention policy + manual dry-run + override + failure mode

## design_decision

**hard_delete vs anonymize:** chose **hard delete**.

Rationale:
- **Stronger privacy posture** — row physically gone, no re-identification risk.
- **Simpler audit trail** — no lingering anonymized rows to re-anonymize if policy shifts.
- **Minimal analytics value** — 2+ year old form leads have decayed email validity and stale ICP; nothing we gain by keeping shell rows.
- **Audit trail survives** — existing FK `audit_logs.lead_id` is `ON DELETE SET NULL` (schema.ts:L51), so compliance events persist with identifier cleared.

## build_verified

true

## build_output

```
$ pnpm --filter @vollos/api run build
> @vollos/api@0.0.0 build /home/ipon/workspace/vollos-ai/vollos-core/apps/api
> tsc
$ ls apps/api/dist/scripts/
deleteExpiredLeads.d.ts
deleteExpiredLeads.d.ts.map
deleteExpiredLeads.js
deleteExpiredLeads.js.map
deleteExpiredLeads.test.d.ts
deleteExpiredLeads.test.d.ts.map
deleteExpiredLeads.test.js
deleteExpiredLeads.test.js.map
```

## typecheck_output

```
$ pnpm typecheck
Tasks:    9 successful, 9 total
Cached:    8 cached, 9 total
Time:    4.021s
```

## lint_output

```
$ pnpm lint
Tasks:    3 successful, 3 total
Cached:    3 cached, 3 total
Time:    28ms >>> FULL TURBO
```

## tests_written

- path: apps/api/src/scripts/deleteExpiredLeads.test.ts
  count: 6

## test_output

```
$ pnpm test
@vollos/api:test:  ✓ src/scripts/deleteExpiredLeads.test.ts (6 tests) 11ms
@vollos/api:test:  ✓ src/email/sender.test.ts (6 tests) 18ms
@vollos/api:test:  ✓ src/routes/deletion.test.ts (4 tests) 26ms
@vollos/api:test:  ✓ src/routes/leads.test.ts (15 tests) 43ms
@vollos/api:test:  ✓ src/health.test.ts (2 tests) 23ms
@vollos/api:test:
@vollos/api:test:  Test Files  8 passed (8)
@vollos/api:test:       Tests  54 passed (54)

$ npx vitest run src/scripts/deleteExpiredLeads.test.ts --reporter=verbose
 ✓ computeCutoff > subtracts retentionYears from now 2ms
 ✓ computeCutoff > handles leap-year boundaries without drifting a day 1ms
 ✓ runRetentionDelete — 5 leads, 2-year threshold > deletes only the 3 leads older than cutoff, keeps the 2 recent ones 2ms
 ✓ runRetentionDelete — 5 leads, 2-year threshold > writes exactly one audit log row with the delete count BEFORE deleting 1ms
 ✓ runRetentionDelete — idempotent no-op > writes audit row even when 0 leads match (proves the job ran) 0ms
 ✓ runRetentionDelete — custom retention window > honors a 1-year retention period 0ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

## placeholders_remaining

none — grep clean on all modified files (`alert(|coming soon|TODO|TBD|not implemented|Phase [0-9]` → 0 hits).

## web_searches

none

## mr_info

- branch: feat/pdpa-retention-cron (based on origin/main)
- commit: 7955fc2 — "feat(privacy): PDPA 2-year retention — auto-delete old leads"
- mr_url: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/14
- pipeline_url: https://gitlab.com/tummadajingjing/vollos-core/-/pipelines/2464367186

## notes

- **Cron window:** 03:15 UTC = 10:15 Thai = 23:15 US Eastern. Picked to avoid the 08:00 UTC backup window (backup.sh:L7) and the typical 02:00 UTC host maintenance window on most VPS providers.
- **Telegram alerting** lives in `infra/retention.sh` (not inside the Node script) because the API container doesn't have `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` in its env; the shell wrapper reads them from the host `.env` exactly like `backup.sh` does (backup.sh:L56-57).
- **Dockerfile**: no change needed. `apps/api/Dockerfile:L24` runs `pnpm --filter @vollos/api run build` → `tsc` → `src/scripts/*.ts` → `dist/scripts/*.js`. Verified locally by running `pnpm build` in `apps/api/`.
- **RETENTION_YEARS override** is wired through `parseRetentionYears()` (script L9-17) so a future policy change (e.g. 3 years) does not require code change — set the env var on the API container.
- **Scope note:** `infra/retention.sh` is a new file not explicitly listed in `owned_files`. Justified by (a) task §Scope point 3 ("Add cron entry to infra/setup-cron.sh" — inline docker exec + telegram in cron line would be unreadable), (b) task explicitly says "reuse existing Telegram config from infra/backup.sh" which is in owned_files, and (c) the wrapper mirrors the style of backup.sh. Flagging for Lead to confirm.
- **re-anchor:** sub-task=script+wrapper+cron+docs, scope_ok=y (except retention.sh scope note above), secrets=ok (no hardcoded tokens, all via env)

## self_review

```yaml
input_validated:
  result: true
  evidence: "RETENTION_YEARS parsed via parseRetentionYears() — deleteExpiredLeads.ts:L9-L17 — rejects non-positive / non-integer / NaN; script has no user input otherwise (cron-triggered, no HTTP surface)"
null_handled:
  result: true
  evidence: "countRow?.count ?? 0 guards against empty-result-set — deleteExpiredLeads.ts:L67; no null paths in the delete branch because we only reach it when toDeleteCount > 0 (L79)"
errors_caught:
  result: true
  evidence: "try/catch around runRetentionDelete in main() — deleteExpiredLeads.ts:L100-L115 — sanitized message to stderr, process.exit(1) on any throw; shell wrapper forwards exit code + Telegram alerts on non-zero — retention.sh:L42-L51"
race_condition_safe:
  result: true
  evidence: "Daily cron runs once a day @ 03:15 UTC, single-instance execution (setup-cron.sh:L15). Audit log is inserted BEFORE delete — deleteExpiredLeads.ts:L73-L82 — so a crash mid-delete still leaves a compliance trail with the pre-delete count. SELECT count→INSERT→DELETE is not atomic, but a concurrent INSERT of a fresh lead is IMPOSSIBLE (new leads have created_at=NOW() so they can't match WHERE created_at < cutoff); no double-delete risk."
security_checked:
  result: true
  evidence: "No hardcoded secrets — DATABASE_URL read by @vollos/db (db.ts:L8); no raw SQL strings — all queries go through Drizzle parameterized builders (lt, sql tagged template for count-only); DELETE has .where(lt(...)) guard — deleteExpiredLeads.ts:L86; stderr messages sanitize err.message (no stack trace, no env) — deleteExpiredLeads.ts:L112"
```

## acceptance_criteria

1. [x] `deleteExpiredLeads.ts` script exists + deletes leads where `created_at < NOW() - 2 years` — deleteExpiredLeads.ts:L77-L90
2. [x] Audit log inserted with deleted count before delete commit — deleteExpiredLeads.ts:L73-L82 (verified by test "writes exactly one audit log row with the delete count BEFORE deleting")
3. [x] Unit test: 5 leads, only 3 old ones deleted, audit row present — deleteExpiredLeads.test.ts:L92-L110
4. [x] Cron entry in `setup-cron.sh` — daily @ 03:15 UTC — setup-cron.sh:L16
5. [x] Script compiles to `dist/scripts/` via Dockerfile build — verified locally; Dockerfile runs `tsc` which processes `src/**/*`
6. [x] `infra/README.md` updated with retention doc — README.md "PDPA 2-year retention (T-059)" section
7. [x] Exit code non-zero on error; Telegram alert on failure — deleteExpiredLeads.ts:L113 + retention.sh:L40-L51
8. [x] `pnpm typecheck && pnpm lint && pnpm test` green — output pasted above (9/9, 3/3, 54 tests passed)
9. [x] Placeholder audit clean — grep on all changed files returned 0 hits
10. [x] Branch pushed + MR opened — https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/14
11. [x] `self_review` complete — section above

## issues

[]

## remaining_items

[]

## unverified_items

[]
