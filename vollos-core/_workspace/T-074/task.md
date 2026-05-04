---
id: T-074
title: Security audit — T-073 _workspace/ git policy (.gitignore + CLAUDE.md)
assigned_to: vollos-auditor
priority: low
spawn_started_at: 2026-04-20T17:15+07:00
dependencies: [T-073]
owned_files: []
---

## Context

T-073 เพิ่ม policy: commit `_workspace/` เป็น audit trail + mandatory 9-pattern secret scan ก่อน push — branch `docs/workspace-git-policy` MR !23

Diff +41 lines (`.gitignore` +9, `CLAUDE.md` +32) — docs-only change

## Scope

รีวิว **policy correctness + scan pattern completeness** (ไม่ใช่ code security — เป็น governance policy audit)

## Review checklist

### Policy wording
1. **_workspace/ commit decision** — ชัดไหมว่า commit task.md/output.md/review-*.md + ignore .log/.tmp/.DS_Store?
2. **Rationale** — อธิบายครบไหมว่าทำไม audit trail สำคัญสำหรับ AI workflow?
3. **Placement in CLAUDE.md** — section อยู่ระหว่าง Best Practices และ Architecture Rules ถูกต้องไหม? (ไม่ block existing flow)

### Secret scan completeness (9 patterns)
4. **GitLab PAT** — regex `glpat-[0-9a-zA-Z_-]{20,}` จับ current format ถูกไหม?
5. **GitHub token** — `ghp_[0-9a-zA-Z]{36}` เป็น format มาตรฐาน (classic token), `gho_`/`ghu_`/`ghs_`/`ghr_` ไม่รวม — ยอมรับหรือควร expand?
6. **AWS access key** — `AKIA[0-9A-Z]{16}` OK. Missing: `ASIA` (temporary credentials) — acceptable trade-off?
7. **Private keys** — `BEGIN (RSA|OPENSSH|PRIVATE|EC) (PRIVATE )?KEY` ครอบคลุม PEM format — DSA key (legacy) ไม่รวม, ยอมรับ?
8. **Nodemailer refresh token** — `NODEMAILER_OAUTH2_REFRESH_TOKEN=1//` — specific ต่อ app, OK
9. **Telegram token** — `TELEGRAM_BOT_TOKEN=[0-9]+:[a-zA-Z0-9_-]{35}` — Telegram bot token format ถูก
10. **Cloudflare** — `CLOUDFLARE_API_TOKEN=[a-zA-Z0-9]{40,}` — standard format
11. **bcrypt hash** — `\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}` — bcrypt 60-char format
12. **Password literal** — `password\s*[=:]\s*['"]?[a-zA-Z0-9!@#$%^&*()_+=-]{12,}` — 12+ char heuristic
13. **Missing patterns?** — Google OAuth client secret, Anthropic API key (sk-ant-*), OpenAI (sk-*), Slack token, SSH private key in non-BEGIN format

### Enforcement design
14. **Lead-only enforcement risk** — policy บังคับ Lead spawn DevOps scan pre-push, แต่ไม่มี CI gate. ถ้า Lead ลืมล่ะ? Recommend CI pre-commit hook?
15. **Redact recipe** — `sed -i 's/<secret>/***REDACTED***/g'` — git history ยังเก็บ → ต้องระบุชัดว่าถ้าเจอจริง ต้อง `git filter-repo` + rotate key

### Compliance
16. **.gitignore entries** — ครอบคลุมพอ? `_workspace/**/*.log`, `*.tmp`, `.DS_Store`, `security-check-output/` OK; missing: `.vscode/`, `.idea/`, `*.swp` (editor state — may contain buffered secrets)

## Output

เขียน `/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-074/review-auditor.md`:

- `verdict: pass | fail | conditional_pass`
- `findings`: CRITICAL/HIGH/MEDIUM/LOW/INFO + file:line + recommendation
- `compliance_verdict: not_applicable`
- `ok_to_merge: true|false` + reasoning
- `checklist_verification`: 16 items + evidence
- `missing_patterns_recommendation`: list ของ secret pattern ที่ควรเพิ่ม (Anthropic, OpenAI, Google OAuth, Slack, ssh private non-BEGIN)

## ข้อห้าม

- ห้ามแก้ไฟล์ (review-only)
- CRITICAL/HIGH → fail
- MEDIUM → conditional_pass + pre-merge condition

## Done criteria

- review-auditor.md + verdict ชัด
- 16 items + evidence
- missing_patterns list (post-merge improvement backlog)
