# acmd Project Rules

## Lead Tool Gate (Mandatory — applies to vollos-lead skill)

เมื่อรัน vollos-lead skill: **ห้ามใช้ Edit/Write tool กับไฟล์ต่อไปนี้โดยเด็ดขาด** ยกเว้นไฟล์ที่อยู่ใน allowlist

### Allowlist (Lead เขียนได้)
- `_board.md`
- `_workspace/*/task.md`

### ไฟล์อื่นทุกไฟล์ = ห้าม Edit/Write
ถ้า Lead กำลังจะใช้ Edit หรือ Write tool กับไฟล์ที่ไม่อยู่ใน allowlist:
1. **หยุดทันที** — อย่ารัน tool
2. สร้าง task.md สำหรับ agent ที่เหมาะสม (Backend/Frontend/DevOps)
3. Spawn agent ผ่าน Agent tool

**เหตุผล:** ถ้า Lead แก้ code/config เอง จะข้าม Verification Chain (QA + Auditor) — ไม่มีใครตรวจงาน Lead

กฎนี้ไม่มีข้อยกเว้น แม้แก้แค่ 1 บรรทัด

### Territory Note (acmd specific)
- `apps/api/` — Backend territory (vollos-backend agent เท่านั้น)
- `apps/web/` — Frontend territory (vollos-frontend agent เท่านั้น)
- `apps/landing/` — Frontend territory (vollos-frontend agent เท่านั้น)
- `packages/auth/` — Backend territory (auth client ที่ verify JWT จาก vollos-core JWKS)
- `packages/crypto/` — Backend territory (medical data encryption — per Rule A4)
- `packages/db/` — Backend territory (Drizzle ORM + schema)
- `packages/ai/` — Backend territory (AI/LLM logic)
- `packages/shared/` — Shared territory (Backend + Frontend แก้ได้ทั้งคู่)

## Agent Self-Review (Mandatory — applies to vollos-backend, vollos-frontend)

ทุก output.md ที่ Backend/Frontend ส่งกลับ **ต้องมี** `self_review` field ที่เป็น evidence-based:
- ทุก field ต้องมี `result: true/false` + `evidence: "file:line — description"`
- ถ้า evidence เป็น generic ไม่มี file:line → Lead ต้อง reject
- ถ้า result: false ใน field ใด → agent ต้องแก้ก่อนส่ง

## QA Risk Analysis (Mandatory — applies to vollos-qa)

ทุก review-qa.md ต้องมี `risk_analysis` field ที่ specific ต่อ task:
- ต้องอ้าง file:line ที่เกี่ยวข้อง
- ห้ามใช้ generic template ซ้ำทุกงาน
- ถ้าไม่มี risk_analysis → Lead ต้อง reject

## Placeholder Audit (Mandatory — applies to vollos-frontend, vollos-backend, vollos-qa, vollos-lead)

### กฎ: ห้ามรายงาน "เสร็จ" ถ้ายังมี placeholder ในไฟล์ที่แก้

**ทุกครั้งก่อน output.md** — agent ต้องรัน command นี้กับทุกไฟล์ที่แก้:
```bash
grep -n "alert(\|coming soon\|TODO\|TBD\|mock\|not implemented\|Phase [0-9]" <file>
```

**ถ้าเจอ:**
1. ระบุใน output.md หัวข้อ `placeholders_remaining` — list ทุกบรรทัดที่เจอพร้อม file:line
2. **ห้ามบอกว่าฟีเจอร์นั้น "ทำงานได้"** — ต้องระบุชัดว่า "ยังไม่ implement"
3. ถ้า task นั้น **ต้องการ** ให้ฟีเจอร์ทำงานจริง → ต้อง implement ก่อนส่ง ห้าม submit งานค้าง

**ถ้าไม่เจอ:**
- ระบุใน output.md: `placeholders_remaining: none — grep clean`

### กฎสำหรับ E2E Test (vollos-frontend, vollos-qa)

ทุก Playwright test ที่เทสหน้าใดหน้าหนึ่ง **ต้องมี comment ระบุ** ว่าปุ่มไหนในหน้านั้นยังเป็น placeholder และ skip เหตุผลอะไร:
```ts
// PLACEHOLDER: "Next Stage →" — alert only, no API — skip until implemented
// PLACEHOLDER: "Add Discussion Record" — alert only, no API — skip until implemented
```
ห้าม silent skip โดยไม่มี comment

### กฎสำหรับ Lead

ก่อนรายงานเจ้านายว่า phase/feature เสร็จ — Lead ต้อง:
1. รัน placeholder grep บนทุกไฟล์ที่ถูกแก้ใน phase นั้น
2. ถ้าเจอ placeholder → รายงานว่า "เสร็จบางส่วน" พร้อม list สิ่งที่ยังค้าง
3. **ห้ามใช้คำว่า "เสร็จแล้ว" ถ้ายังมี alert() หรือ coming soon ในไฟล์ที่ deliver**

## Best Practices — มาตรฐานทีม (บังคับทุก agent ทุก task)

### Package Names (acmd specific)
- ทุก internal package ในโปรเจกต์นี้ใช้ prefix `@acmd/*`
  ตัวอย่าง: `@acmd/ui`, `@acmd/api-client`, `@acmd/types`
- ห้ามใช้ `@vollos/*` prefix ใน repo นี้

### Git
- ห้าม push ตรง main — ต้องเปิด MR ทุกครั้ง
- Commit message ต้องใช้รูปแบบ: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`
  ตัวอย่าง: `feat: add /health endpoint` / `fix: correct CORS header`
  ห้าม: `update`, `fix bug`, `changes`, หรือข้อความภาษาไทย

### Secret
- ห้ามใส่ secret จริงใน code หรือ commit — ใช้ GitLab CI/CD Variables เสมอ
- .env.example ต้องอัพเดทเมื่อมี env ใหม่ ห้ามมี value จริง

### API
- ทุก service ต้องมี `GET /health → { status: "ok" }` ก่อน deploy
- API ใหม่ทุกตัวต้องอยู่ใต้ `/api/v1/`

### Pre-Deploy Checklist (agent ต้องตรวจทุกครั้งก่อน deploy task)
- [ ] typecheck ผ่าน 0 errors
- [ ] test ผ่าน (no regression)
- [ ] .env.example อัพเดทถ้ามี env ใหม่
- [ ] ไม่มี placeholder / alert() / coming soon หลงเหลือ
- [ ] /health endpoint ตอบสนอง
- [ ] commit message เป็น conventional commits

---

## Session Anchor Log Discipline (Mandatory — applies to vollos-lead)

- Every new Session Anchor entry in `_board.md` MUST be ≤ 200 characters in the body column.
- If detail exceeds 200 chars → write detail to `_workspace/_session_notes/SESSION-NNN.md` and reference it: `-> details: _workspace/_session_notes/SESSION-NNN.md`
- Append new entries at the END of the table (do NOT insert mid-table) to minimize Edit tool diff context bloat.
- Reason: Edit tool prints surrounding row context every write; long neighboring rows balloon Lead's working context. Cap + append-only minimizes the cost.

---

## _board.md Auto-Archive (Mandatory — applies to vollos-lead)

> **Why:** อ่าน `_board.md` ครั้งหนึ่งกินตอนนี้ ~10K-60K tokens (โตขึ้นเรื่อยๆ). Rolling 7-day window จำกัดขนาดไว้

- **Threshold:** entries (Session Anchor + Active Tasks + spawn history) older than **7 days** จากวันที่ทำงาน → ต้องย้ายไป archive
- **Archive path:** `_workspace/_archive/_board_YYYY_WNN.md` (ISO week format, e.g. `_board_2026_W18.md`)
- **Trigger #1 — Pre-Session check (mandatory):** ทุกครั้งที่ Lead invoke `/vollos-lead` skill, **ตรวจ `_board.md` line count ก่อน handle คำสั่งใดๆ.** ถ้า > 400 บรรทัด → spawn DevOps archive task ก่อน proceed
- **Trigger #2 — Hard rule (mandatory):** ก่อนเพิ่ม Session Anchor / Active Task entry ใหม่, ถ้ามี entry เก่ากว่า 7 วัน → archive ก่อน หรือบอก owner ขอข้าม (rare exception)
- **Archive content:** old session anchors + completed tasks + Day-N kickoff/resume guides + done tables + spawn verbose history. Keep in main: active sprint state + decisions log + pending follow-ups + recent spawns
- **Update header pointer:** ทุกครั้ง archive ต้อง update `_board.md` header "Last archived: YYYY-MM-DD → path"
- **Lead ห้าม edit archive file** — มันคือ frozen snapshot. ถ้าต้อง restore entry → copy back to `_board.md` แล้วลบจาก archive

---

## Architecture Rules (multi-repo) — applies to all agents

> ที่มา: docs/plan01.md (Multi-Repo restructure plan)
> ขอบเขต: vollos-core + product repos ทั้งหมด (acmd, bnfg, ฯลฯ)

### A. Architecture
- **A1.** Multi-repo: vollos-core + product repos (acmd, bnfg, ...) แยกกัน คุยผ่าน HTTP API หรือ Docker network เท่านั้น — ห้าม cross-repo direct import
- **A2.** vollos-core ถือ: postgres กลาง, auth-service, VOLLOS lead capture API, infra/
- **A3.** ห้าม cross-repo direct dependency (import package จาก repo อื่นตรงๆ)
- **A4.** acmd มี `packages/crypto/` ของตัวเอง — ห้าม import crypto จาก vollos-core
  เหตุผล: medical data / PII ต้องเข้ารหัสก่อนเข้า DB. ถ้าทำเป็น API call ไป vollos-core จะเกิด latency hit ทุก request + เพิ่ม attack surface บน vollos-core

### B. Authentication
- **B1.** ใช้ **RS256 + JWKS เท่านั้น** ห้ามใช้ HS256 ในทุก repo
- **B2.** vollos-core เก็บ private key คนเดียว — repo อื่นห้ามรู้ private key
- **B3.** product repo fetch public key จาก `vollos-core/.well-known/jwks.json` ด้วย `importJWK`
- **B4.** **ห้ามแชร์ JWT_SECRET ข้าม repo** — ห้ามมี `VOLLOS_JWT_SECRET` ใน product repo (.env, code, CI variables)
- **B5.** JWKS cache 1 ชั่วโมง + force refresh ถ้า JWT มี `kid` ไม่ match cache (ห้าม fetch ทุก request)
- **B6.** Identity vs Profile: vollos-core เก็บ `auth.users` (identity จริง), product เก็บ `{product}.user_profiles` (เพิ่มเติม)
- **B7.** ไม่มี profile record = response 403 "กรุณาซื้อ package ก่อน"

### C. Database
- **C1.** PostgreSQL **schema แยกต่อ product** — ห้ามใช้ table prefix (`acmd.cases` ✅ / `acmd_cases` ❌)
- **C2.** Drizzle ใช้ `pgSchema('x').table('y', {...})` เท่านั้น ห้ามใช้ `pgTable('x_y', {...})`
- **C3.** `drizzle.config.ts` ของทุก service ต้องระบุ `migrationsSchema` + `migrationsTable` ใน schema ของตัวเอง
- **C4.** **ห้ามใช้ default `public.__drizzle_migrations`** — DB user ไม่มีสิทธิ์ public schema → migration พังทันที
- **C5.** DB user แยกต่อ schema (เช่น `acmd_user` เห็นเฉพาะ `acmd.*` ไม่เห็น `vollos.*` หรือ `auth.*`)
- **C6.** `init-db.sql` รันด้วย **superuser ครั้งแรกเท่านั้น** — `CREATE SCHEMA IF NOT EXISTS` + `CREATE USER IF NOT EXISTS` + `GRANT ALL ON SCHEMA` + `ALTER DEFAULT PRIVILEGES`
- **C7.** GRANT ALL ON SCHEMA ให้ user ก่อน — เพื่อให้สร้าง migration tracking table ได้

### D. Docker
- **D1.** vollos-core เป็นเจ้าของ network `vollos-network` — สร้างด้วย `driver: bridge`
- **D2.** product repo ใช้ `external: true` — join network ที่ vollos-core สร้างไว้
- **D3.** vollos-core ต้องเปิดก่อน product ทุกครั้ง (local dev + production)
- **D4.** postgres ต้องอยู่ทั้ง `internal` network และ `vollos-network` (2 networks)

### E. Port Numbering
- **E1.** Pattern `{product}{service}` 4 หลัก (เช่น 3101 = acmd-api)
- **E2.** Product prefix: `30`=vollos-core, `31`=acmd, `32`=bnfg (BenefitGuard), `33`+ = product ถัดไปตามลำดับ
- **E3.** Service suffix: `01`=api, `02`=web, `03`=landing, `04`=auth
- **E4.** ทุก port ใหม่ต้องจดใน `vollos-core/README.md` ก่อนใช้
- **E5.** เปลี่ยน port ต้อง update **5 ที่:** docker-compose.yml + Caddy/reverse proxy config + .env(.example) + CI/CD smoke test + README

### F. CI/CD
- **F1.** product CI ต้อง spin-up vollos-core เป็น service ใน `.gitlab-ci.yml`
- **F2.** ใช้ **specific SHA** (`VOLLOS_CORE_SHA` ใน GitLab CI/CD Variables) — ห้ามใช้ tag `:latest`
- **F3.** vollos-core ต้อง push image ไป GitLab Container Registry ก่อน product CI ใช้ได้
- **F4.** Branch protection on `main` — ห้าม push ตรง ต้องผ่าน MR (set ใน GitLab repo settings, ไม่ใช่แค่กฎเขียน)
- **F5.** Pipeline ต้องผ่านครบก่อน merge — typecheck + lint + unit test + build (set "Pipelines must succeed" = ON ใน GitLab)
- **F6.** Conventional Commits บังคับ — `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`

### G. MR Review Workflow
- **G1.** 3-Layer Oversight ทุก MR: (1) GitLab pipeline auto + (2) AI review (Lead+Auditor+Domain Expert) + (3) Human approve (owner)
- **G2.** MR Review Process 6 ขั้น: เปิด MR → pipeline รัน → Lead review code + checklist → Auditor ตรวจ security (ถ้าแตะ auth/data/API) → owner approve → merge → deploy
- **G3.** Lead review MR ทุกอัน — ตรวจ 4 ข้อ: conventional commits / test coverage / no placeholder/alert() / .env.example updated

### H. Domain Expert Gate
- **H1.** ทุก product repo ต้องมี domain expert ใน `.claude/skills/` (ขาด → Lead ห้ามเริ่มงานใดๆ)
- **H2.** Lead workflow บังคับ 5 ขั้น: spawn domain expert → expert ผลิต `domain-brief.md` → Lead อ่าน → Lead เขียน task.md พร้อม reference → Lead spawn ทีม
- **H3.** task.md ต้องมี `domain_consultation:` field (expert + brief path + key_points)
- **H4.** `key_points` ต้องอ้าง file:line จาก `domain-brief.md` (ห้าม generic)
- **H5.** ขาด `domain-brief.md` → Lead **ห้าม spawn ทีม** (task invalid)

### I. Production Safety
- **I1.** Backup ก่อน migration ทุกครั้ง — `pg_dump` เก็บนอก container (พร้อม timestamp ใน filename)
- **I2.** Restore command เตรียมพร้อมก่อนเริ่ม migration
- **I3.** Maintenance window — แจ้ง user ล่วงหน้าทุกครั้ง
- **I4.** Smoke test หลัง start service ก่อนเปิด traffic
- **I5.** ถ้าล้มเหลว → restore DB + start monorepo เดิม (rollback plan ต้องเตรียมไว้)

### J. Secret Management (เพิ่มเติมจาก Best Practices ด้านบน)
- **J1.** Secret ที่ pipeline ใช้ → ต้องอยู่ใน GitLab CI/CD Variables (masked + protected)
- **J2.** ห้ามอยู่แค่ `.env` บน VPS เท่านั้น (เผื่อ VPS หาย — secret ต้องกู้จาก GitLab ได้)
- **J3.** `.env.example` ทุก repo ต้อง complete (มี key ครบ ไม่มี value จริง)

### K. Code Quality (เพิ่มเติม)
- **K1.** Health endpoint `GET /health → {status: "ok"}` ทุก service ก่อน deploy
- **K2.** API ใหม่ทุกตัวอยู่ใต้ `/api/v1/`
- **K3.** ห้ามมี placeholder / `alert()` / "coming soon" หลงเหลือใน production code
- **K4.** Commit message ตาม Conventional Commits (ดู F6)
- **K5.** Package rename ต้องทำพร้อมกัน: package.json + grep+replace import paths + sync tsconfig paths + รัน typecheck ทันที

### L. Skills + Tooling
- **L1.** Global skills (vollos-lead, vollos-backend, vollos-frontend, vollos-qa, vollos-auditor, vollos-devops, vollos-e2e-tester) อยู่ที่ `~/.claude/skills/`
- **L2.** Domain skills (เฉพาะ product) อยู่ที่ `{repo}/.claude/skills/`
- **L3.** คนใหม่ / เครื่องใหม่ — bootstrap VOLLOS team skills:
  ```bash
  git clone git@gitlab.com:tummadajingjing/vollos-skill-team.git \
    ~/workspace/vollos-ai/vollos-skill-team
  for skill in vollos-lead vollos-backend vollos-frontend \
               vollos-qa vollos-auditor vollos-devops vollos-e2e-tester; do
    ln -s ~/workspace/vollos-ai/vollos-skill-team/$skill \
          ~/.claude/skills/$skill
  done
  ```
  Source of truth: https://gitlab.com/tummadajingjing/vollos-skill-team (private)
  Global workers: vollos-{lead, backend, frontend, qa, auditor, devops, e2e-tester}
- **L4.** `infra/` (Caddyfile, docker-compose.prod.yml, backup.sh) อยู่ที่ `vollos-core/infra/` เสมอ
- **L5.** `_workspace/` + `_board.md` แต่ละ repo มีของตัวเอง (ไม่แชร์ข้าม repo)

### M. Team / GitLab
- **M1.** แต่ละ repo มีทีม GitLab แยก (member ต่างกันได้)
- **M2.** คนคนเดียวอยู่หลาย repo ได้ (เช่น DevOps อยู่ทุก repo)
- **M3.** แต่ละ repo ตั้ง role แยก (Maintainer / Developer / Reporter)
- **M4.** ทีมขั้นต่ำต่อ repo: **Lead, Backend, Frontend, QA, DevOps**

---

## Future Rules — เปิดใช้เมื่อ launch product จริง (ยังไม่บังคับตอนนี้)

- **O1.** Staging environment + pipeline `feature → test → staging (auto) → production (manual approve)`
- **O2.** Monitoring: UptimeRobot (uptime alert) + Sentry (error tracking) — ฟรี tier ทั้งคู่
- **O3.** Semantic Versioning (`v1.0.0`, `v1.1.0`) + auto-CHANGELOG จาก conventional commits

> **เมื่อไหร่เปิดใช้:** เมื่อ product ตัวแรก (BenefitGuard / AccommodateAI / ฯลฯ) มีลูกค้าจริงและพร้อม launch — Lead จะแจ้ง owner ให้เปิดใช้ทีละข้อ

---

## Lead Workflow & Revision Patterns

ใช้กฎจาก vollos-lead skill: rubric / tier matrix / 4 principles + pipeline-small/medium/big — ดู `~/.claude/skills/vollos-lead/SKILL.md` + `references/pipeline-*.md`. ถ้ามี acmd-specific override ในอนาคต เพิ่มใต้หัวข้อนี้ได้.

---
