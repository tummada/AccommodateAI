# Security Audit — T-064 (review of T-063 post-deploy smoke test)

task_id: T-064
verdict: pass
working_mode: infra
compliance_verdict: not_applicable   # CI YAML only — ไม่แตะ user data / PII / email / auth tokens
ok_to_merge: true
  reasoning: >
    Diff เป็น +13/-1 ใน `.gitlab-ci.yml` deploy job เท่านั้น — URL hardcoded ทั้งคู่,
    ไม่มี variable interpolation ใน curl argument, retry logic ถูกต้อง,
    `when: manual` ยังอยู่ (AC #5 ผ่าน), fallback `|| echo "000"` ไม่ชน `"200"` comparison
    (fail-safe), ไม่มี secret leak ใน commit/MR/diff, dependency chain (`needs: [build]`,
    `only: main`, `environment: production`) เหมือนเดิม ไม่มี CRITICAL/HIGH findings.
    LOW/INFO findings (curl --max-time, body assertion) เป็น defense-in-depth
    ที่จัดการต่อใน A-2/A-3 ได้ ไม่ block merge.

## skill_loaded_evidence

files_read:
  - "SKILL.md:L37 — 'Audit พบ secret leaked ใน code / output.md / diff / git history → verdict fail + severity CRITICAL'"
  - "SKILL.md:L88-L91 — 'อ่านทุกไฟล์ใน files_changed ... grep ตาม checklists ... ตรวจ output.md ของ agent ว่ามี self_review field'"
  - "SKILL.md:L95-L102 — Evidence Protocol — ห้ามสรุปว่าไม่มีปัญหา โดยไม่มี file:line; cvss_estimate ต้องมี basis"
  - "SKILL.md:L137-L146 — Verdict Policy table"
  - "SKILL.md:L210-L214 — Working Modes selection — `infra` เมื่อ files_changed มี docker-compose/Dockerfile/CI-YAML"

## files_reviewed

- ".gitlab-ci.yml (origin/feat/ci-smoke-test@5168377): lines 1-67 — full file"
- ".gitlab-ci.yml (origin/main@c4d2a76): lines 40-55 — deploy job baseline for diff"
- "_workspace/T-063/output.md: lines 1-133 — devops output + self_review"
- "_workspace/T-064/task.md: lines 1-55 — audit scope"

## greps_executed

- "git diff origin/main origin/feat/ci-smoke-test -- .gitlab-ci.yml → 14 hunks, +13 -1: L44 apk add curl + L51-62 smoke block"
- "grep -niE 'password|secret|token|VPS_SSH_KEY|CI_REGISTRY' on origin/feat/ci-smoke-test:.gitlab-ci.yml → 6 matches, ทั้งหมดเป็น variable name (ไม่ใช่ value): L29 CI_REGISTRY_PASSWORD (pre-existing), L31/32/34/35 CI_REGISTRY_IMAGE (pre-existing), L46 VPS_SSH_KEY (pre-existing) — ไม่มี plaintext value; ไม่มี line ที่ T-063 เพิ่มแตะ secret"
- "grep -niE 'curl|http|url' on origin/feat/ci-smoke-test:.gitlab-ci.yml → 3 matches: L44 apk add curl, L54 curl vollos.ai/api/v1/health, L55 curl auth.vollos.ai/health — URLs hardcoded, ไม่มี $VAR expansion ใน URL"
- "git show 5168377 --format body --no-patch → commit message ไม่มี secret value, อ้าง URL public + design notes เท่านั้น"

## scope_compliance

files_changed_vs_owned: "match — diff แตะแค่ .gitlab-ci.yml (deploy job) ตรง scope T-063; owned_files ใน T-064 = [] (read-only review) ตาม vollos-auditor Routing Protocol"

## self_review_check

- output.md ของ T-063 มี `self_review` field ครบ 11 รายการ (output.md:L34-L68)
- ทุก field มี `result: true` + evidence แบบ file:line (เช่น ".gitlab-ci.yml:50-62", ".gitlab-ci.yml:66", "MR !17 state=opened")
- placeholders_remaining: none + grep command output แสดง (output.md:L70-L77)
- ผ่านเกณฑ์ SKILL.md:L91 (มี self_review + evidence file:line)

## security_findings

### CRITICAL

[] — ไม่พบ CRITICAL

### HIGH

[] — ไม่พบ HIGH

### MEDIUM

[] — ไม่พบ MEDIUM

### LOW

- id: SEC-001
  severity: low
  cvss_estimate: "~2.5 (estimated — CWE-834 Excessive Iteration / DoS via hang, impact=pipeline-only, attacker=network-path)"
  category: "availability (CWE-834)"
  description: >
    curl ที่ L54-L55 ไม่ตั้ง `--max-time` / `--connect-timeout` — ถ้า DNS resolve ค้าง
    หรือ TCP handshake ช้า curl จะรอตาม default (120s connect + ไม่จำกัด read in some builds)
    ทำให้ smoke test block hang เกิน budget 3×10s ที่ spec ตั้งไว้ GitLab job timeout
    (ระดับ project หรือ instance default 60 นาที) จะ kill ในที่สุด แต่ทำให้ false-fail
    ช้าและเปลือง CI minutes (ไม่ใช่ security เต็มตัว — availability/cost concern)
  file: ".gitlab-ci.yml:54-55"
  evidence: >
    `api=$(curl -sS -o /dev/null -w "%{http_code}" https://vollos.ai/api/v1/health || echo "000")`
    + `auth=$(curl -sS -o /dev/null -w "%{http_code}" https://auth.vollos.ai/health || echo "000")`
    — ไม่มี `--max-time` / `--connect-timeout` / `-m` flag
  recommendation: >
    `.gitlab-ci.yml:54-55` — เพิ่ม `--max-time 10 --connect-timeout 5` ใน curl ทั้งสอง:
    `curl -sS --max-time 10 --connect-timeout 5 -o /dev/null -w "%{http_code}" https://vollos.ai/api/v1/health || echo "000"`
    เหตุผล: แต่ละ attempt มี budget 10s ตาม spec → `--max-time 10` กัน hang; fallback
    `|| echo "000"` จะได้ทำงานเมื่อ timeout และ retry loop ทำงานถูกต้อง ไม่ block pipeline
    แก้ได้ใน A-2 (rollback + alert task) ไม่ต้อง block merge

### INFO

- id: SEC-INFO-001
  severity: informational
  cvss_estimate: "n/a — advisory"
  category: "defense_in_depth (CWE-1104 advisory)"
  description: >
    Smoke test ยอมรับ response 200 โดยไม่ตรวจ body content — ถ้า reverse-proxy
    (Caddy) หรือ CDN สร้าง maintenance page ที่ return 200 พร้อม HTML "service down"
    smoke ก็ยัง pass ความเสี่ยงจริงต่ำ เพราะ backend ทั้งสอง return JSON `{"status":"ok"}`
    และ Caddy config ของโปรเจกต์ไม่มี static maintenance page ที่ return 200
    แต่ถ้า future `/health` route proxy broken แล้ว gateway return 200 HTML
    smoke จะ false-positive
  file: ".gitlab-ci.yml:56"
  evidence: >
    `if [ "$api" = "200" ] && [ "$auth" = "200" ]; then` — เช็ค status code อย่างเดียว
    ไม่ validate body
  recommendation: >
    `.gitlab-ci.yml:54-56` — optional upgrade ใน A-3: capture body ด้วย `-o response.json`
    แล้ว `jq -e '.status == "ok"' response.json` หรือ `grep -q '"status":"ok"'`.
    ไม่จำเป็นตอนนี้ — smoke test ที่ status-code-only เป็น industry standard
    สำหรับ health check; ยกระดับเมื่อพบ false-positive จริงในอนาคต

- id: SEC-INFO-002
  severity: informational
  cvss_estimate: "n/a — advisory"
  category: "supply_chain (A03:2025 advisory)"
  description: >
    `apk add --no-cache curl` ที่ L44 ดึง curl ล่าสุดจาก Alpine 3.19 repo ทุก pipeline run
    ไม่มี version pin (เช่น `curl=8.5.0-r0`) — ถ้า upstream repo ถูก compromise หรือมี
    breaking change, deploy stage อาจล้มเหลวหรือ behavior เปลี่ยน ความเสี่ยงต่ำเพราะ
    (1) base image `alpine:3.19` เองก็ไม่ pinned ด้วย digest → supply chain risk อยู่ที่
    base อยู่แล้ว (pre-existing) (2) curl เป็น standard tool จาก Alpine official repo
  file: ".gitlab-ci.yml:44"
  evidence: '`- apk add --no-cache openssh-client curl` — ทั้ง openssh-client (pre-existing) และ curl (new) ไม่มี version pin'
  recommendation: >
    `.gitlab-ci.yml:42,44` — advisory ใน sprint ถัดไป: pin ทั้ง base image
    (`image: alpine:3.19@sha256:<digest>`) และ apk packages (`apk add --no-cache curl=8.5.0-r0`)
    — เป็นเรื่อง supply-chain ทั้ง job ไม่เฉพาะ curl ไม่ block merge ครั้งนี้

- id: SEC-INFO-003
  severity: informational
  cvss_estimate: "n/a — clarification"
  category: "shell_semantics (CWE-20 advisory)"
  description: >
    ตรวจ command-injection vector ของ smoke block: `for i in 1 2 3` loop ใช้ static
    range — ไม่รับ input จากภายนอก; URL ทั้งสองเป็น literal ไม่มี `$VAR`; comparison
    ใช้ `[ "$api" = "200" ]` ซึ่ง quote ถูกต้อง; fallback `|| echo "000"` เขียน literal
    `"000"` ไม่ใช่ `$(...)`. สรุป: **ไม่มี command injection vector** ใน smoke block
  file: ".gitlab-ci.yml:53-62"
  evidence: >
    L53 `for i in 1 2 3; do` (static) + L54-55 URLs hardcoded + L56 quoted compare +
    L60 `[ $i -lt 3 ] && sleep 10` (static numeric, int-compare safe)
  recommendation: "ไม่มี action ต้องทำ — ตรวจแล้ว clean per checklist item #1 ใน task.md"

## checklist_verification (per task.md 8 ข้อ)

1. **Command/shell injection:** PASS — URLs hardcoded (L54-55), loop variables static
   (`1 2 3`, `i -lt 3`), comparison quoted (`"$api" = "200"`), fallback ใช้ literal
   string `"000"`. ไม่มี `eval`, `$((...))` กับ untrusted input, หรือ variable
   expansion ใน URL

2. **Retry logic correctness:** PASS — `for i in 1 2 3` (3 iterations); `[ $i -lt 3 ]
   && sleep 10` (L60) — sleep หลัง attempt 1 และ 2 เท่านั้น, **ไม่**sleep หลัง attempt
   3 (ถูกต้องตาม spec, ไม่ waste 10s ตอนท้าย); `exit 0` เมื่อ both 200 (L57); `exit 1`
   หลัง loop จบโดยไม่มี pass (L62) — GitLab treat non-zero = job fail

3. **Fail-silent risk:** PASS — `|| echo "000"` (L54-55) → `"000"` ไม่ match `"200"`
   (L56) ดังนั้น curl crash → `$api=="000"` → if condition false → retry ต่อ → หลัง 3
   รอบ → `exit 1`. **ไม่มี fail-silent**

4. **Secret leak:** PASS — commit body, MR description, diff, output.md ทั้งหมด
   ไม่มี plaintext value ของ `VPS_SSH_KEY`, `VPS_SSH_HOST_KEY`, `CI_REGISTRY_PASSWORD`,
   หรือ CI variable ใด ๆ; เฉพาะชื่อตัวแปร (pre-existing L29, L46). smoke test
   ไม่ echo env vars

5. **Manual gate bypass:** PASS — `.gitlab-ci.yml:66 — when: manual` ยังอยู่; diff
   ไม่แตะ L63-67 (`only:`, `needs:`, `when:`, `environment:`). AC #5 ตรง

6. **Attack surface ใหม่:** LOW risk — เพิ่ม `curl` tool ใน Alpine deploy image
   ทำให้ pipeline เรียก outbound HTTPS ไปสอง URL `vollos.ai` และ `auth.vollos.ai`
   ทั้งคู่เป็น public endpoint ที่เจ้าของโปรเจกต์ควบคุม ความเสี่ยง:
   - SSRF: ต่ำมาก — URL hardcoded, pipeline environment ไม่ได้ route ผ่าน network
     เซนซิทีฟภายใน; GitLab runner shared executor ไม่มี metadata endpoint ที่ curl
     reach ได้ (169.254.169.254 อาจเข้าถึงได้บน self-hosted runner — ไม่ใช่ context นี้)
   - DNS exfiltration: ต่ำ — URL fixed, ไม่ได้ query domain ที่ attacker ควบคุม
   - outbound-only: curl ไม่ listen port; alpine image ไม่เพิ่ม service
   สรุป: additional risk **minimal** — acceptable

7. **False positive/negative:**
   - FP: body ว่าง (SEC-INFO-001) — theoretical only, ปัจจุบัน backend return JSON
   - FP: gateway maintenance page 200 — ไม่มี config แบบนั้น
   - FN: curl hang (SEC-001 LOW) — จะ detect แต่ช้ากว่า 30s (GitLab job timeout)
   - เกณฑ์ `200 == 200` ชัด, ไม่มี string-contains matching ที่ bypass ได้
   - สรุป: false-positive/negative profile **acceptable** สำหรับ smoke-only

8. **Dependency chain safety:** PASS — diff ไม่แตะ `needs: [build]` (L65), `only: -
   main` (L63-64), `when: manual` (L66), `environment: production` (L67). build →
   deploy chain เหมือนเดิม, pipeline topology ไม่เปลี่ยน

## us_privacy_compliance

unsubscribe_mechanism: "n/a — task ไม่แตะ email"
physical_address_in_email: "n/a — task ไม่แตะ email"
audit_log: "n/a — task ไม่แตะ data write path"
data_minimization: "ok — task ไม่เก็บ/ประมวลผล PII ใด ๆ, smoke test hit public health endpoint เท่านั้น"

## skipped_sections

- "Application Layer checklist (SQL/XSS/BOLA/CSRF/rate-limit) — N/A: diff ไม่แตะ API handler"
- "Auth Layer checklist (JWT verify/cookie/HMAC) — N/A: diff ไม่แตะ auth code"
- "Email Layer — N/A: ไม่แตะ SMTP/email config"
- "US Privacy (CAN-SPAM/CCPA) — N/A: ไม่แตะ user-facing email / data collection"

## conditional_conditions

[] — verdict = pass, ไม่มี condition

## files_read

- "/home/ipon/.claude/skills/vollos-auditor/SKILL.md"
- "/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-064/task.md"
- "/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-063/output.md"
- "origin/feat/ci-smoke-test:.gitlab-ci.yml (via `git show`) — full 67 lines"
- "origin/main:.gitlab-ci.yml (deploy job L40-55) — baseline for diff"

## commands_used

- `git fetch origin feat/ci-smoke-test`
- `git diff origin/main origin/feat/ci-smoke-test -- .gitlab-ci.yml`
- `git show origin/feat/ci-smoke-test:.gitlab-ci.yml`
- `git show origin/main:.gitlab-ci.yml`
- `git log origin/main..origin/feat/ci-smoke-test --oneline`
- `git show 5168377e303b396ad18c647e7a4a0ccb09918db0 --format ... --no-patch` (body check)
- Grep regex `password|secret|token|VPS_SSH_KEY|CI_REGISTRY` on branch version
- Grep regex `curl|http|url` on branch version

completion_signal: "task_id=T-064 verdict=pass findings=4 (0 critical, 0 high, 0 medium, 1 low, 3 info) path=_workspace/T-064/review-auditor.md"
