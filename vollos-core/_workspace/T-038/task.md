---
id: T-038
title: Scan _workspace/T-002..T-034 for secrets + commit as audit trail
assigned_to: vollos-devops
priority: medium
status: in_progress
spawn_started_at: 2026-04-20T08:55+07:00
security_checkpoint: true
owned_files:
  - _workspace/T-002/
  - _workspace/T-003/
  - _workspace/T-004/
  - _workspace/T-005/
  - _workspace/T-006/
  - _workspace/T-007/
  - _workspace/T-008/
  - _workspace/T-009/
  - _workspace/T-010/
  - _workspace/T-011/
  - _workspace/T-012/
  - _workspace/T-013/
  - _workspace/T-014/
  - _workspace/T-015/
  - _workspace/T-016/
  - _workspace/T-017/
  - _workspace/T-018/
  - _workspace/T-019/
  - _workspace/T-020/
  - _workspace/T-021/
  - _workspace/T-022/
  - _workspace/T-023/
  - _workspace/T-024/
  - _workspace/T-025/
  - _workspace/T-026/
  - _workspace/T-027/
  - _workspace/T-028/
  - _workspace/T-029/
  - _workspace/T-030/
  - _workspace/T-031/
  - _workspace/T-032/
  - _workspace/T-033/
  - _workspace/T-034/
  - _workspace/T-035/
  - _workspace/T-036/
  - _workspace/T-037/
  - _workspace/T-038/
  - _board.md
dependencies: []
---

## Context

Owner chose Option A — commit all 33 unused workspace task folders as audit trail (AI workflow history). `_workspace/T-001/` is already committed as precedent. Some folders contain output.md from secret-handling tasks (T-006, T-010, T-016, T-017, T-022, T-029, T-036) — DevOps must scan for leaked secrets before committing.

## Goal

1. Scan every `.md` file in `_workspace/T-002/` through `_workspace/T-038/` for potential secret patterns
2. Report findings to Lead
3. If 0 findings → commit all 33 folders + `_board.md` as single audit-trail commit to branch `chore/workspace-audit-trail`
4. If findings → STOP, redact in-place (replace value with `***REDACTED***`), re-scan, document in output.md; only commit after re-scan is clean
5. Push branch + open MR to main

## Scope

### Step 1 — Scan (read-only)

Use ripgrep to scan for common secret patterns. Do NOT print matching values to terminal unless absolutely needed (print only the file path + line number + pattern name, never the captured value).

Patterns to scan (per-file, only `.md` files under `_workspace/`):

```
# GitLab/GitHub personal access tokens
glpat-[0-9a-zA-Z_-]{20,}
ghp_[0-9a-zA-Z]{36}
gho_[0-9a-zA-Z]{36}

# AWS
AKIA[0-9A-Z]{16}
aws_secret_access_key\s*=

# Generic
-----BEGIN (RSA|OPENSSH|PRIVATE|EC) (PRIVATE )?KEY-----
password\s*[=:]\s*['"]?[a-zA-Z0-9!@#$%^&*()_+=-]{12,}
api[_-]?key\s*[=:]\s*['"]?[a-zA-Z0-9]{20,}
bearer\s+[a-zA-Z0-9_\-\.]{20,}

# Known VOLLOS patterns
VOLLOS_CLI\s*=\s*glpat-
CLOUDFLARE_API_TOKEN\s*=\s*[a-zA-Z0-9]{40,}
TELEGRAM_BOT_TOKEN\s*=\s*[0-9]+:[a-zA-Z0-9_-]{35}
NODEMAILER_OAUTH2_REFRESH_TOKEN\s*=\s*1//

# Raw bcrypt-style hashes
\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}

# Bitwarden/vault URLs with session tokens
bw_session=
```

**Allowed safe patterns** (do NOT flag — these are expected):
- `sha256:` fingerprints (hex digest only, no preimage)
- `REDACTED`, `***`, `<redacted>`, `<masked>` placeholders
- `$VAR_NAME` shell variable references (not the value)
- Email addresses (not secrets)
- Generic example tokens in documentation (`glpat-AAAA...`, `ghp_AAAA...`)

### Step 2 — Report findings

Write summary to output.md BEFORE any commit:
- Total files scanned: N
- Total potential matches: M
- Breakdown per task folder (only folders with ≥ 1 match)
- Per-match: file path + line number + pattern name (NO captured value)

### Step 3 — Redact if findings

If any real secret found:
- Use `sed -i` or precise Edit to replace the value with `***REDACTED (vollos-devops T-038)***`
- Preserve the surrounding context (key name, line structure)
- Re-run full scan → must return 0 matches
- Document each redaction in output.md

### Step 4 — Commit

Branch: create new branch `chore/workspace-audit-trail`
```
cd /home/ipon/workspace/vollos-ai/vollos-core
git checkout -b chore/workspace-audit-trail
git add _workspace/T-002 _workspace/T-003 ... _workspace/T-038 _board.md
git status  # sanity check
git commit -m "chore: sync workspace audit trail — T-002..T-038 + board sync

Audit trail of 33 AI workflow task folders (T-002..T-034 historical +
T-035..T-038 current session). _board.md synced with 21 historical rows
+ T-035/T-036 completion rows + Session Anchor #005.

Per owner decision 2026-04-20 — commit as traceability record for solo
long-term maintenance.

No secrets leaked — scanned via T-038 DevOps pre-commit secret sweep
(GitLab PAT / AWS / RSA / bearer / bcrypt / Telegram / R2 / refresh
tokens). [REDACTION DETAILS IF ANY]"
```

### Step 5 — Push + open MR

```
git push -u origin chore/workspace-audit-trail
```

Open MR via `glab` or GitLab API:
- source: `chore/workspace-audit-trail`
- target: `main`
- title: `chore: sync workspace audit trail — T-002..T-038 + board`
- description: include scan summary (files scanned, matches found, redactions made)
- squash: false (single commit already)

## Exclusions (do NOT stage/commit)

- `security-check-output/` — tooling output, different policy (Lead will handle separately)
- `.env` / `.env.*` (already in .gitignore, but double-check)
- Any file not explicitly listed in `owned_files`

## Secret Handling (MANDATORY)

- ห้าม cat / head / tail / less ไฟล์ที่อาจมี secret — ใช้ grep เท่านั้น (and even grep must mask captured value via `-o` + pattern, not `-c` which is fine)
- Use ripgrep with `--files-with-matches` first, then per-file `--line-number` without `--color` and without printing the match body unless needed
- When printing scan results in output.md: file path + line number + pattern name ONLY — never the matched content itself
- If redacting: use `sed -i 's/PATTERN/***REDACTED***/g'` — do NOT `cat` the file before/after to verify; use `grep -c PATTERN` (count only)
- GitLab PAT: source `/home/ipon/workspace/vollos/.env` to get `VOLLOS_CLI`, do not echo

## Acceptance Criteria

1. [ ] All 37 workspace folders (T-002..T-038) scanned with documented pattern list
2. [ ] Per-task match count reported (0 matches ideal; > 0 requires redaction)
3. [ ] Redactions documented (if any) with file:line + pattern name (no captured values)
4. [ ] Re-scan after redaction confirms 0 matches
5. [ ] Branch `chore/workspace-audit-trail` created and pushed to origin
6. [ ] Single commit created with conventional-commit message
7. [ ] MR opened to main + URL returned
8. [ ] `security-check-output/` NOT staged (verify via `git status`)
9. [ ] `_board.md` included in the commit
10. [ ] No secret values appear in output.md, commit message, or MR description

## Self-Review (Mandatory)

ทุก field ต้องมี `result: true/false` + `evidence: "file:line or command → snippet (redacted)"`

## Deliverable

`/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-038/output.md`

## Notes

- Owner is solo long-term — prioritize careful scan over speed. If unsure whether a pattern is a real secret, err on the side of caution and report to Lead before committing.
- Remote URL is `git@gitlab.com:tummadajingjing/vollos-core.git` (post-migration).
- Pipeline will run on branch push (test + build stages) — expect it to pass since this is docs-only change.
- Remember: `_workspace/T-037/` may not exist as a folder (Lead did T-037 in-place editing _board.md, no task folder). Skip gracefully if absent.
