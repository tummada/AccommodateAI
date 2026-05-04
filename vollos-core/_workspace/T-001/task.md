---
task_id: T-001
title: Setup project workspace + apply 58 architecture rules to CLAUDE.md + archive plan01
agent: vollos-devops
spawn_started_at: 2026-04-18T09:30:00+07:00
mode: MODE 0 (project setup — initial workspace bootstrap)

domain_consultation:
  status: not_required
  reason: "Setup/infra task — ไม่แตะ domain logic (ศุลกากร/HR/legal). กฎที่จะใส่ใน CLAUDE.md เป็น architecture rules ทั่วไป ไม่ใช่ business rules"

applicable_rules:
  - rule: "F6 — Conventional Commits บังคับ"
    source: CLAUDE.md (existing Best Practices > Git section)
    apply: "Commit message ต้องเป็น chore: setup..."
  - rule: "L4 — infra/ อยู่ที่ vollos-core/infra/"
    source: docs/plan01.md §10 (จะกลายเป็น CLAUDE.md L4 หลัง task นี้เสร็จ)
    apply: "ห้ามย้าย infra/ ออกจาก root ของ vollos-core"
  - rule: "Lead Tool Gate (existing)"
    source: CLAUDE.md (existing top section)
    apply: "agent ทำงานในไฟล์ owned_files เท่านั้น ห้ามแตะ _board.md หรือ task.md (Lead เขียนเอง)"

owned_files:
  - CLAUDE.md (edit — append section ใหม่)
  - plan01.md → docs/plan01.md (git mv — ย้าย)
  - docs/ (สร้างโฟลเดอร์ใหม่ถ้ายังไม่มี)

---

## Goal

ทำให้ vollos-core repo มี:
1. Architecture rules ครบใน CLAUDE.md (เพิ่ม section A-M = 58 rules + Future Rules section O1-O3)
2. plan01.md ย้ายเข้า docs/ folder (เป็น archive — restructure สำเร็จแล้ว)
3. ทุกอย่างอยู่ใน 1 commit ตามรูปแบบ conventional commits

## Acceptance Criteria

1. CLAUDE.md มี section ใหม่ชื่อ "Architecture Rules (multi-repo) — applies to all agents" ครบ A1-A4, B1-B7, C1-C7, D1-D4, E1-E5, F1-F6, G1-G3, H1-H5, I1-I5, J1-J3, K1-K5, L1-L5, M1-M4 (รวม 58 rules)
2. CLAUDE.md มี section ใหม่ชื่อ "Future Rules — เปิดใช้เมื่อ launch product จริง" ครบ O1-O3 พร้อม comment "เมื่อไหร่เปิดใช้"
3. section ใหม่ append ที่ท้ายไฟล์ — ห้ามลบของเดิม (Lead Tool Gate / Agent Self-Review / QA Risk Analysis / Placeholder Audit / Best Practices ต้องคงอยู่)
4. `plan01.md` ย้ายเป็น `docs/plan01.md` ด้วย `git mv` (ห้าม cp + rm — ต้องคง git history)
5. สร้างโฟลเดอร์ `docs/` ถ้ายังไม่มี
6. ทุก change รวมใน 1 commit message: `chore: setup vollos-core team workspace + 58 architecture rules from plan01`
7. git status clean หลัง commit (no untracked, no uncommitted) — ยกเว้น `_board.md`, `_workspace/T-001/` ที่ Lead เขียน + commit แยก/รวมตาม decision

## Spec — Content ที่ต้องเพิ่มใน CLAUDE.md

**Append สิ่งต่อไปนี้ที่ท้ายไฟล์ CLAUDE.md (หลัง section Pre-Deploy Checklist เดิม):**

```markdown

---

## Architecture Rules (multi-repo) — applies to all agents

> ที่มา: docs/plan01.md (Multi-Repo restructure plan)
> ขอบเขต: vollos-core + product repos ทั้งหมด (acmd, bnfg, ฯลฯ)

### A. Architecture
- **A1.** Multi-repo: vollos-core + product repos (acmd, bnfg, ...) แยกกัน คุยผ่าน HTTP API หรือ Docker network เท่านั้น — ห้าม cross-repo direct import
- **A2.** vollos-core ถือ: postgres กลาง, auth-service, VOLLOS lead capture API, infra/
- **A3.** ห้าม cross-repo direct dependency (import package จาก repo อื่นตรงๆ)
- **A4.** crypto package ห้ามอยู่ vollos-core — copy เข้า product repo ที่ใช้ (หลีกเลี่ยง latency hit ทุก request เข้ารหัสข้อมูลการแพทย์)

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
- **L3.** **คนใหม่ต้อง copy global skills ก่อนใช้งาน:** `cp -r vollos-core/.claude/skills/vollos-* ~/.claude/skills/`
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
```

## Output Required

สร้างไฟล์ `_workspace/T-001/output.md` ตามรูปแบบนี้หลังทำเสร็จ:

```yaml
---
task_id: T-001
agent: vollos-devops
completed_at: <ISO timestamp>
verdict: pass | fail | needs_revision
---

## Files Changed
- CLAUDE.md (edited — appended Architecture Rules + Future Rules sections)
- plan01.md → docs/plan01.md (git mv)
- docs/ (created)

## Self-Review (ทุก field ต้องมี evidence file:line)
- ac1_rules_added:
    result: true | false
    evidence: "CLAUDE.md:line-XXX-YYY contains all 58 rules A1-M4"
- ac2_future_rules_added:
    result: true | false
    evidence: "CLAUDE.md:line-ZZZ-WWW contains O1-O3 with launch trigger note"
- ac3_existing_preserved:
    result: true | false
    evidence: "diff shows no deletions in lines 1-XX (existing rules intact: Lead Tool Gate / Agent Self-Review / QA Risk / Placeholder Audit / Best Practices)"
- ac4_git_mv_used:
    result: true | false
    evidence: "git log --follow docs/plan01.md shows pre-rename history (R status in commit)"
- ac5_docs_folder:
    result: true | false
    evidence: "ls -la docs/ output: contains plan01.md"
- ac6_single_commit:
    result: true | false
    evidence: "git log -1 --oneline: <hash> chore: setup vollos-core team workspace..."
- ac7_clean_status:
    result: true | false
    evidence: "git status output: 'nothing to commit, working tree clean' (ยกเว้นไฟล์ _board.md / _workspace/T-001/ ที่ Lead เขียน)"

## Commit Info
- hash: <short git hash>
- message: chore: setup vollos-core team workspace + 58 architecture rules from plan01
- stats: <output of git log -1 --stat>

placeholders_remaining: <none — grep clean | OR list บรรทัดที่เจอ>
```

## Constraints

- **ห้าม edit ไฟล์อื่นนอกจาก owned_files** — ห้ามแตะ apps/, packages/, infra/, docker-compose.yml, .gitlab-ci.yml ฯลฯ
- **ห้าม push ไป remote** — commit local เท่านั้น (owner จะ push เองหรือสั่ง push ทีหลัง)
- **ห้ามสร้าง branch ใหม่** — ทำงานบน branch ปัจจุบัน (`feat/setup-skills`)
- **ห้ามแก้ commit เก่า** (ห้าม `--amend`, `--no-verify`, `rebase`)
- **ใช้ git mv เท่านั้น** สำหรับย้าย plan01.md (ห้าม cp + rm — git history หาย)
- หลัง commit เสร็จ — รัน `git log -1 --stat` แล้วใส่ output ใน output.md เป็น evidence
- **ห้าม commit `.env`** หรือไฟล์ใน `.gitignore`
