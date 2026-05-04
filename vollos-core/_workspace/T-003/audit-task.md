---
task_id: T-003-AUDIT
audit_target: T-003 (Hot-fix MR !10 for 3 HIGH findings from T-002 audit)
reviewer: vollos-auditor
mr: "!10"
branch: fix/rs013-deploy-prep-hardening
commit_head: 07fc133
security_checkpoint: true
---

## Context — Why This Re-audit

T-002 Auditor verdict = `conditional_pass, GO` with 3 conditional_conditions that MUST be fixed before Phase 2B (VPS apply):

- **F-1 (HIGH):** docker-compose.yml ports exposure bypassing Caddy
- **F-2 (HIGH):** CWE-798 hardcoded `devpassword123` in scripts/init-db.sql
- **F-3 (HIGH):** missing Content-Security-Policy header

T-003 MR !10 is the hot-fix. **Your job: verify all 3 HIGH are properly resolved + check no new issues introduced.**

## Required reading (in order)

1. `/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-002/review-auditor.md` — your prior audit (conditional_conditions at L267-270)
2. `/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-003/task.md` — T-003 scope
3. `/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-003/output.md` — DevOps self-claim (verify independently; last round you caught F-4 timing inaccuracy)
4. `/home/ipon/workspace/vollos-ai/vollos-core/CLAUDE.md` §§ C, D, J

## Files Changed in MR !10

```
.env.example            (+7)
docker-compose.prod.yml (+52, new)
docker-compose.yml      (+9)
infra/Caddyfile         (+22)
scripts/init-db.sh      (+78, new, 0755)
scripts/init-db.sql     (-42, deleted)
```

## Audit Focus

### Checkpoint A — F-1 Resolution (Port Exposure Fix)
- Verify `docker-compose.prod.yml` strips `ports:` from vollos-api + auth-service via `!reset []` or equivalent
- Verify postgres ports handling (was 127.0.0.1:5432 — still fine or stripped?)
- Test merged config:
  ```
  docker compose -f docker-compose.yml -f docker-compose.prod.yml config | grep -c "published:"
  ```
  Expected: 0 (no published ports in prod)
- Verify Caddy can still reach services via vollos-network (service names `vollos-core-auth:3004`, `vollos-core-api:3001`)
- Flag if vollos-api is NOT on vollos-network (DevOps output.md noted this — confirm or reject)

### Checkpoint B — F-2 Resolution (Password Env-Var-Driven)
- Verify `scripts/init-db.sh` exists, executable (0755), syntax valid (`sh -n`)
- Verify script reads `AUTH_USER_PASSWORD`, `VOLLOS_USER_PASSWORD`, `ACMD_USER_PASSWORD` from env
- Verify **fail-closed** behavior if any env var empty (script must exit non-zero, not proceed with empty password)
- Verify psql variable substitution is safe (`--set :'VAR'` with quoting — check for SQL injection risk via malformed password)
- Verify `docker-compose.yml` passes the 3 env vars to postgres service
- Verify `.env.example` has 3 new empty placeholders + comment pointing to GitLab CI/CD Variables
- **Grep check:** `git ls-tree -r fix/rs013-deploy-prep-hardening --name-only | xargs grep -l "devpassword"` → must be 0 matches
- **History acknowledgment:** Confirm DevOps documented `residual_risk` that devpassword is still in git history (commits 589e17a, 9b82d41) — not a fail because history rewrite is destructive

### Checkpoint C — F-3 Resolution (CSP Header)
- Verify `Content-Security-Policy` header present in `infra/Caddyfile` `(security_headers)` snippet
- Verify CSP directives cover all 3rd-party origins the landing actually uses:
  ```
  grep -rnE "(src=|href=|@import|fetch\(|fonts\.googleapis|accounts\.google|challenges\.cloudflare|gstatic)" apps/landing/
  ```
- Check `'unsafe-inline'` usage — DevOps flagged `script-src 'unsafe-inline'` as follow-up. Is this acceptable temporarily (vs blocking this MR)?
- Verify `caddy validate` passes

### Checkpoint D — F-4 Acknowledgment
- Verify `output.md` has `f4_acknowledgment` field with both timestamps (keygen time vs .gitignore commit time) and the lesson recorded
- **Timing accuracy of NEW self-review claims:** pick 2-3 random claims in T-003 self_review and verify timestamps yourself (e.g., file mtime vs git commit time). Per last round, DevOps lost trust on timing claims.

### Checkpoint E — New Issues Check
- Did the fix introduce any NEW HIGH/CRITICAL issue?
- CSP `'unsafe-inline'`: HIGH or acceptable follow-up?
- init-db.sh: any command injection / shell injection risk?
- docker-compose.prod.yml YAML `!reset []` tag: supported in Compose v2.24+? Any edge case?

### Checkpoint F — Architecture + Process
- Conventional commits (3 commits) — verify
- MR !10 state: opened, not yet merged
- Pipeline green
- No push to main
- No out-of-scope file touched

## Verdict Format

Write `_workspace/T-003/review-auditor.md`:

```yaml
task_id: T-003
reviewer: vollos-auditor
mr: "!10"
previous_audit: T-002
previous_conditional_conditions_status:
  F-1: resolved | partially_resolved | unresolved
  F-2: resolved | partially_resolved | unresolved
  F-3: resolved | partially_resolved | unresolved
verdict: pass | fail | conditional_pass
commit_gate: GO | NO-GO
new_findings:
  - id / severity / file / description / recommendation
checks_performed:
  - A: ...
  - B: ...
  - C: ...
  - D: ...
  - E: ...
  - F: ...
phase_2b_readiness: ready | blocked (with reasons)
rationale: "plain Thai for owner"
```

## Rules
- **Verify independently** — re-run all grep/commands yourself, do NOT copy DevOps evidence
- **Never display PEM / passwords / env values** — use `***` or key-only
- **Read-only** — write only to `_workspace/T-003/review-auditor.md`
- **Plain Thai rationale** for owner

Begin now.
