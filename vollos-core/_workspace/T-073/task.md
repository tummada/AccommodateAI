---
id: T-073
title: Define _workspace/ git policy — commit as audit trail + mandatory secret scan
assigned_to: vollos-devops
priority: low
spawn_started_at: 2026-04-20T17:00+07:00
dependencies: []
owned_files:
  - .gitignore
  - CLAUDE.md
---

## Context

Owner 2026-04-20 pending question: `_workspace/` — commit เป็น audit trail หรือ ignore?

**Owner decision (session #006 2026-04-20):** **(ก) Commit เป็น audit trail** — ด้วย 2 safety layers (ignore unsafe patterns + Lead mandatory secret scan before push)

**Precedent:** T-062 (MR !16) commit 23 folders ย้อนหลัง + 8-pattern secret scan → 0 matches

## Scope (2 ไฟล์เท่านั้น)

### File 1: `.gitignore` — add 2 patterns

**Current state** (from Lead pre-check):
```
node_modules/
dist/
.env
.env.local
*.sql.gz
*.sql.gz.gpg
infra/backup.log
infra/monitor.log
infra/backups/
keys/
.turbo/
**/.turbo/
*.pem
*.key
private.*
keys/*.pem
keys/*.key
infra/certs/
/tmp/auth-rsa-keys-*
logs/caddy/*.log
logs/caddy/*.log.*
```

**Add (after existing entries, in new section):**
```
# T-073: _workspace/ audit trail policy — commit task.md/output.md/review-*.md
# but ignore anything that could leak secrets or generate noise
_workspace/**/*.log
_workspace/**/*.tmp
_workspace/**/.DS_Store

# T-073: security-check-output/ — local security scan artifacts only
security-check-output/
```

(existing global `.env` + `*.pem` + `*.key` already cover _workspace subpath too — no redundancy needed)

### File 2: `CLAUDE.md` — add new section **after "Best Practices" section, before "Architecture Rules"**

Exact content to add:
```markdown
## _workspace/ Git Policy (D14 decision)

### กฎ: commit `_workspace/` เป็น audit trail (ไม่ .gitignore)

**เหตุผล:** AI workflow ต้อง context เดิมจาก task ก่อนๆ (task.md, output.md, review-*.md) เป็นสมุดบันทึกของทีม — ถ้าเครื่องเสีย/ย้ายเครื่องยังกู้คืนได้

**ที่ commit:** ทุกไฟล์ใน `_workspace/T-XXX/` (task.md, output.md, review-auditor.md, review-qa.md, etc.)
**ที่ ignore:** `.gitignore` block ของ T-073 ครอบคลุม .log .tmp .DS_Store + `security-check-output/`

### Mandatory Secret Scan ก่อน push _workspace

**ทุก MR ที่เพิ่มหรือแก้ไฟล์ใน `_workspace/`** — Lead ต้อง spawn DevOps รัน 9-pattern secret scan (precedent: T-062) **ก่อน** push:

```bash
cd /path/to/repo
grep -rE "glpat-[0-9a-zA-Z_-]{20,}" _workspace/          # GitLab PAT
grep -rE "ghp_[0-9a-zA-Z]{36}" _workspace/               # GitHub token
grep -rE "AKIA[0-9A-Z]{16}" _workspace/                  # AWS access key
grep -rE "-----BEGIN (RSA|OPENSSH|PRIVATE|EC) (PRIVATE )?KEY-----" _workspace/
grep -rE "NODEMAILER_OAUTH2_REFRESH_TOKEN=1//" _workspace/
grep -rE "TELEGRAM_BOT_TOKEN=[0-9]+:[a-zA-Z0-9_-]{35}" _workspace/
grep -rE "CLOUDFLARE_API_TOKEN=[a-zA-Z0-9]{40,}" _workspace/
grep -rE "\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}" _workspace/        # bcrypt
grep -rE "password\s*[=:]\s*['\"]?[a-zA-Z0-9!@#$%^&*()_+=-]{12,}" _workspace/
```

ถ้าเจอ match → redact ด้วย `sed -i 's/<secret>/***REDACTED***/g'` + re-scan → push ได้เมื่อ 0 matches

**Lead enforcement:** ทุก task.md ที่ touch `_workspace/` ต้องมี `secret_handling: "9-pattern scan run pre-push, 0 matches"` ใน output.md
```

## Acceptance Criteria

1. `.gitignore` เพิ่ม T-073 block ตามสเปค (4 patterns) — ไม่ลบ/แก้ entries เดิม
2. `CLAUDE.md` เพิ่ม section "_workspace/ Git Policy (D14 decision)" — ตำแหน่งถูกต้อง (หลัง Best Practices ก่อน Architecture Rules)
3. Branch `docs/workspace-git-policy` from `origin/main` (HEAD=`c556c6c`)
4. Conventional commit: `docs(policy): commit _workspace as audit trail + mandatory secret scan`
5. MR opened — **NOT merged**
6. Pipeline test + build green on MR (เพราะเป็น docs-only change — test ควรผ่านไม่มีผลกระทบ)
7. **auto-deploy จะยิงหลัง merge** (now default) — แม้เป็น docs-only change ก็ยังรัน deploy → smoke pass → OK

## Branch + MR discipline

- ห้าม push main ตรง
- ห้าม merge MR เอง (owner merges)
- ห้ามแตะไฟล์อื่นนอก 2 ไฟล์ที่ระบุ
- ห้ามเปลี่ยน existing .gitignore entries (แค่ append)
- ห้ามเปลี่ยน existing CLAUDE.md sections (แค่เพิ่ม section ใหม่)

## Output

เขียน `/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-073/output.md`:
- `self_review`: 7 AC + evidence file:line
- `placeholders_remaining`: grep clean
- `files_changed`: 2 files + diff stat
- `mr_url`, `commit_sha`, `pipeline_url`
- `verification`: 
  - new .gitignore entries don't break existing (test with `git check-ignore` if possible)
  - CLAUDE.md section inserted at correct location (quote surrounding context)
- `blocker`: null/details

## Definition of Done

- [ ] MR opened, not merged
- [ ] Pipeline green
- [ ] Diff scope = 2 files only
- [ ] ไม่มี placeholder / alert / TODO ในไฟล์ที่แก้
- [ ] Owner merge → auto-deploy success (docs change) → policy active

## After this task

1. Lead spot-check diff
2. Spawn vollos-auditor (T-074) — focus: policy wording correctness, scan patterns completeness, ตำแหน่ง section ใน CLAUDE.md
3. Owner merges → auto-deploy
4. **Then:** separate task to commit current untracked _workspace folders (T-063..T-073) with secret scan applied per new policy
