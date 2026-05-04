# T-060 Security Audit — PDPA 2-year retention cron

```yaml
task_id: T-060
verdict: "conditional_pass"
working_mode: "static-analysis (default)"

skill_loaded_evidence:
  files_read:
    - "SKILL.md:L36 — 'Audit พบ secret leaked ใน code / output.md / diff / git history → verdict fail + severity CRITICAL'"
    - "SKILL.md:L139 — Verdict Policy: '≥ 1 CRITICAL finding → fail'"
    - "references/security-checklists.md:L78 — Audit Log checklist: 'log IP + timestamp + action?'"

files_reviewed:
  - "apps/api/src/scripts/deleteExpiredLeads.ts: lines 1-145 (full file, via git show origin/feat/pdpa-retention-cron)"
  - "apps/api/src/scripts/deleteExpiredLeads.test.ts: lines 1-160 (full file)"
  - "infra/retention.sh: lines 1-57"
  - "infra/setup-cron.sh: lines 1-21"
  - "infra/README.md: lines 1-160 (T-059 section lines 90-160)"
  - "packages/db/src/schema.ts: lines 20-65 (leads + auditLogs schemas — ON DELETE SET NULL verified L51)"
  - "_workspace/T-059/output.md: lines 110-166 (placeholders_remaining + self_review sections)"

greps_executed:
  - "grep -n 'onDelete|lead_id' packages/db/src/schema.ts → L51: 'leadId: uuid(lead_id).references(() => leads.id, { onDelete: set null })' — audit trail preservation confirmed"
  - "grep -n 'transaction|tx\\.|BEGIN|COMMIT' deleteExpiredLeads.ts → only L64 comment — NO db.transaction() wrapping audit+delete"
  - "grep -n 'unsubscribed_at|consent_revoked|deletedAt' schema.ts → L33,L35,L38 — soft-delete + revocation fields EXIST but cron ignores them"
  - "grep -n 'ipAddress|ip_address' deleteExpiredLeads.ts → no hits — audit row omits IP (cron has no request IP, acceptable)"
  - "grep -rn 'sk-|ghp_|password=|SECRET=' apps/api/src/scripts/ infra/retention.sh → 0 hits — no hardcoded secrets"
  - "grep -n 'TELEGRAM_BOT_TOKEN' infra/retention.sh → L23,L30,L37 — read from .env via grep+cut, piped to curl body not URL, token not logged"

scope_compliance:
  files_changed_vs_owned: "match — 5 files in diff all in expected scope (apps/api/src/scripts/, infra/); no drive-by edits"

security_findings:
  - id: SEC-001
    severity: "medium"
    cvss_estimate: "~5.3 (estimated — CWE-778 insufficient logging, compliance-accuracy)"
    category: "us_privacy (CWE-778, A09:2025)"
    description: "Audit-log insert and DELETE are NOT wrapped in a single transaction. The audit row commits immediately with a pre-count `count=N`; if the DELETE then fails, the audit_logs row falsely attests that N rows were deleted when 0 were removed. Compliance trail says one thing, DB state says another."
    file: "apps/api/src/scripts/deleteExpiredLeads.ts:74-100"
    evidence: "await db.insert(auditLogs).values({ action: 'pdpa_retention_delete', metadata: { count: toDeleteCount, ... } });  // …then: if (toDeleteCount === 0) return; const deleted = await db.delete(leads)…"
    recommendation: "apps/api/src/scripts/deleteExpiredLeads.ts:74-100 — wrap in `await db.transaction(async (tx) => { … })` so audit-insert + delete commit atomically, OR write the audit row with `metadata.actualDeleted = deleted.length` AFTER the delete completes (keep a second 'attempted' row pre-delete if pre-flight trail is required). The current ordering argument in the header comment (L31-34) is only valid inside a transaction."

  - id: SEC-002
    severity: "medium"
    cvss_estimate: "~5.3 (estimated — CWE-770 resource consumption)"
    category: "api_inventory (CWE-770, API4:2023)"
    description: "Unbounded single-statement DELETE. If retention was disabled for months (or script failed silently) and 100k+ leads suddenly qualify, one `DELETE FROM leads WHERE created_at < cutoff` will take a long row-level lock, blocking concurrent INSERTs from the lead-capture API and potentially tripping Postgres statement-timeout. No LIMIT, no batching, no lock-timeout."
    file: "apps/api/src/scripts/deleteExpiredLeads.ts:97-100"
    evidence: "const deleted = await db.delete(leads).where(lt(leads.createdAt, cutoff)).returning({ id: leads.id });"
    recommendation: "apps/api/src/scripts/deleteExpiredLeads.ts:97-100 — batch in chunks of e.g. 1000 with `SET LOCAL statement_timeout` + loop while rows remain; OR at minimum add `SET LOCAL lock_timeout = '30s'` at the top of the transaction so stuck locks fail fast and Telegram alert fires."

  - id: SEC-003
    severity: "medium"
    cvss_estimate: "~4.3 (estimated — CWE-710 improper adherence to coding standards / compliance gap)"
    category: "us_privacy"
    description: "Retention scope is `created_at < now-2y` only. The leads table already exposes `unsubscribedAt`, `consentRevokedAt`, and `deletedAt` (schema.ts:L33,L35,L38) — PDPA Section 37 and CCPA deletion requests require earlier purge when consent is withdrawn, but this cron does not consider those signals. Users who unsubscribe today still sit in the DB for up to 2 years."
    file: "apps/api/src/scripts/deleteExpiredLeads.ts:42-46 (cutoff) + 74-79 (WHERE clause)"
    evidence: "where(lt(leads.createdAt, cutoff))  — no OR branch for consentRevokedAt/unsubscribedAt/deletedAt"
    recommendation: "apps/api/src/scripts/deleteExpiredLeads.ts:74-100 — either (a) extend WHERE to `createdAt < cutoff OR consent_revoked_at < (now - 30 days) OR unsubscribed_at < (now - 30 days)`, or (b) document explicitly in infra/README.md that a separate 'deletion request' workflow handles CCPA 45-day windows and reference that runbook. Current state is a silent compliance gap."

  - id: SEC-004
    severity: "low"
    cvss_estimate: "~2.0 (estimated — CWE-1295 debug messages revealing unnecessary info, documentation-only)"
    category: "us_privacy"
    description: "Comment in retention.sh:L12 claims `03:15 UTC = 23:15 US Eastern (prev day)`. 03:15 UTC is 22:15 EST (winter) or 23:15 EDT (summer). Minor, documentation-only — not a security defect but misleading when the VPS target market is US."
    file: "infra/retention.sh:12"
    evidence: "#   03:15 UTC = 10:15 Thai = 23:15 US Eastern (prev day)"
    recommendation: "infra/retention.sh:12 — change to '22:15 EST / 23:15 EDT (prev day)'."

us_privacy_compliance:
  unsubscribe_mechanism: "present"  # unsubscribedAt column exists in schema (packages/db/src/schema.ts:L38) — not in scope of T-059 diff
  physical_address_in_email: "present"  # not in scope of T-060; this task ships no email templates
  audit_log: "present"  # deleteExpiredLeads.ts:L74-79 inserts action='pdpa_retention_delete' with count+cutoff metadata; packages/db/src/schema.ts:L51 confirms audit_logs.lead_id ON DELETE SET NULL preserves trail after hard delete
  data_minimization: "ok"  # hard-delete after 2y + header rationale at deleteExpiredLeads.ts:L6-13 aligns with PDPA §37 + CCPA storage-limitation principle

skipped_sections:
  - "Frontend XSS — N/A: no apps/landing/ files in diff"
  - "Email Header Injection — N/A: no email-template files in diff"
  - "CORS/CSRF — N/A: no HTTP route handler in diff; script runs via docker exec"
  - "JWT/Auth — N/A: cron runs with DB credentials from container env, no request auth path"

conditional_conditions:
  - "Fix SEC-001 (atomicity) before next prod deploy — or explicitly accept documented risk in _board.md with owner signoff"
  - "Fix SEC-002 (batch cap) OR add lock_timeout safeguard — before first real purge window (today's rows ~ Apr 2024)"
  - "Resolve SEC-003 (consent-revoked scope) — decide policy: extend cron OR ship CCPA deletion-request workflow in separate task before GA"
  - "SEC-004 is optional documentation polish"

completion_signal: "task_id=T-060 verdict=conditional_pass findings=4 path=_workspace/T-060/review-auditor.md"
```

## Report (under 250 words)

Branch `origin/feat/pdpa-retention-cron` implements a clean, well-tested 2-year hard-delete cron. Good news: no CRITICAL or HIGH findings; no secrets, no SQL injection (Drizzle parameterized), Telegram token read safely from `.env` and passed via `-d` body (not URL), schema confirms `audit_logs.lead_id ON DELETE SET NULL` so compliance trail survives. Tests cover cutoff math, 0-match no-op, and custom windows. Unit tests verify audit row has count BEFORE delete.

Four non-blocking findings:
- **SEC-001 (MEDIUM)** — audit-insert and DELETE are NOT in one transaction; a post-audit DELETE failure leaves a misleading audit row. Wrap in `db.transaction()`.
- **SEC-002 (MEDIUM)** — no batch size / lock_timeout on the DELETE. If purge runs late on a huge cohort, it could block lead-capture INSERTs.
- **SEC-003 (MEDIUM)** — cron only considers `created_at`. Schema has `unsubscribedAt`, `consentRevokedAt`, `deletedAt` — CCPA 45-day deletion requests and PDPA consent-withdrawal need a separate path or extended WHERE clause.
- **SEC-004 (LOW)** — US Eastern time comment off by 1 hr.

T-059 `output.md` has `self_review` (L134-166) and `placeholders_remaining: none` (L110-112) — process-compliant.

Verdict: **conditional_pass** per Verdict Policy (≥2 MEDIUM without mitigation; no CRITICAL; no HIGH). Fix SEC-001/002/003 in a follow-up MR before GA traffic; SEC-004 is cosmetic.

completion_signal: task_id=T-060 verdict=conditional_pass findings=4 path=_workspace/T-060/review-auditor.md
