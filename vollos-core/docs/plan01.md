# แผนการปรับโครงสร้าง — Multi-Repo

## 1. โครงสร้างเดิม (Monorepo)

```
vollos/  (repo เดียว)
├── apps/
│   ├── acmd-api        ← AccommodateAI backend (Hono + Node)
│   ├── acmd-web        ← AccommodateAI dashboard (React 19)
│   ├── acmd-landing    ← AccommodateAI landing page (static HTML)
│   ├── api             ← VOLLOS lead capture API
│   └── landing         ← VOLLOS marketing page
├── packages/
│   ├── auth            ← JWT + Google OAuth (ใช้โดย acmd-api)
│   ├── crypto          ← เข้ารหัสข้อมูลการแพทย์ (ใช้โดย acmd-api)
│   ├── acmd-db         ← Database schema + migrations (ตาราง acmd_*)
│   ├── acmd-ai         ← AI utilities (placeholder)
│   ├── acmd-shared     ← Shared types/utils สำหรับ ACMD
│   └── db              ← VOLLOS lead capture DB
├── docker-compose.yml  ← postgres + api + acmd-api + acmd-web + acmd-landing
└── .gitlab-ci.yml      ← test → build → deploy (manual, main only)
```

**ปัญหา:** N product ทำงานขนานกันไม่ได้ — อยู่ repo เดียวกัน push พัง ทุกคนพังตาม

---

## 2. โครงสร้างใหม่ (Multi-Repo)

```
repo: vollos-core       ← ของกลาง: auth API, VOLLOS lead capture, infra กลาง
repo: acmd              ← AccommodateAI ครบชุด (API + Web + Landing)
repo: bnfg              ← (อนาคต) BenefitGuard ครบชุด
repo: ...               ← product อื่นๆ ตามแม่แบบเดียวกัน
```

---

## 3. vollos-core repo

### สิ่งที่ย้ายมา
| ของเดิม | ของใหม่ | หมายเหตุ |
|--------|--------|---------|
| `apps/api` | `apps/vollos-api` | VOLLOS lead capture API |
| `apps/landing` | `apps/landing` | หน้าแรก vollos.ai |
| `packages/db` | `packages/db` | VOLLOS DB layer |
| `packages/auth` | `packages/auth` + expose HTTP routes | กลายเป็น Auth Service ยิง API ได้ |

### Docker services (vollos-core)
```
postgres:17-alpine    ← ฐานข้อมูลกลาง (1 instance สำหรับทุก product)
vollos-api            ← port 3001
auth-service          ← port 3004 (login/logout/refresh + GET /.well-known/jwks.json)
landing               ← port 80/443
```

### DB Users
```
vollos_user    → เห็นเฉพาะ vollos schema เท่านั้น
auth_user      → เห็นเฉพาะ auth schema เท่านั้น
acmd_user      → เห็นเฉพาะ acmd schema เท่านั้น
```

---

## 4. acmd repo

### สิ่งที่ย้ายมา
| ของเดิม | ของใหม่ | หมายเหตุ |
|--------|--------|---------|
| `apps/acmd-api` | `apps/api` | rename ตัด prefix |
| `apps/acmd-web` | `apps/web` | rename ตัด prefix |
| `apps/acmd-landing` | `apps/landing` | rename ตัด prefix |
| `packages/acmd-db` | `packages/db` | rename ตัด prefix |
| `packages/acmd-ai` | `packages/ai` | rename ตัด prefix |
| `packages/acmd-shared` | `packages/shared` | rename ตัด prefix |
| `packages/crypto` | `packages/crypto` | copy มาจาก vollos-core |

### Docker services (acmd)
```
acmd-api      ← port 3101 (ต่อ postgres ของ vollos-core)
acmd-web      ← port 3102
acmd-landing  ← port 3103
```

### DB User
```
acmd_user     → เห็นเฉพาะ acmd schema เท่านั้น
               → ไม่เห็น vollos schema หรือ auth schema เลย
```

### Auth
- Login/Logout/Refresh → ยิง HTTP ไปหา `vollos-core` auth-service
- ตรวจสอบ JWT → ดึง public key จาก `GET vollos-core/.well-known/jwks.json` แล้วตรวจเองในเครื่อง
- vollos-core เก็บ private key ไว้คนเดียว — acmd ไม่รู้ private key เลย
- ไม่ต้องแชร์ secret ข้าม repo — แค่รู้ URL ของ JWKS endpoint
- ถ้า vollos-core เปลี่ยน key → acmd ได้ public key ใหม่อัตโนมัติ

---

## 5. Local Dev Setup

```
# เปิด vollos-core ก่อน (postgres + auth-service)
cd vollos-core && docker compose up

# เปิด acmd แยก (ต่อ postgres ของ vollos-core ผ่าน Docker network)
cd acmd && docker compose up
```

Docker network: vollos-core expose network ชื่อ `vollos-network`
acmd docker-compose join network เดียวกัน → คุยกันผ่าน `postgres:5432` ได้เลย

---

## 6. ขั้นตอนการย้าย ACMD (Migration Steps)

### Phase A — เตรียม vollos-core
1. สร้าง repo ใหม่ `vollos-core` บน GitLab
2. ย้าย `apps/api`, `apps/landing`, `packages/db`, `packages/auth` ไป
3. ตั้ง Docker + CI/CD ของ vollos-core
4. เพิ่ม auth HTTP routes (login/logout/refresh/me) ใน auth-service + ตั้ง drizzle.config.ts ของ auth-service ให้ใช้ `migrationsSchema: 'auth', migrationsTable: 'auth_migrations'` (ดูส่วน 14 fix 5)
5. สร้าง DB user `vollos_user` + `auth_user` + ตั้ง permissions (รัน init-db.sql ด้วย superuser)
6. เพิ่ม CI/CD step: build + push vollos-core Docker image ไป GitLab Container Registry
   (acmd CI ต้องดึง image นี้มาใช้เป็น service — ถ้าไม่มี image acmd pipeline พัง)
7. ทดสอบ vollos-core ทำงานได้ standalone

### Phase B — สร้าง acmd repo
1. สร้าง repo ใหม่ `acmd` บน GitLab
2. ย้าย apps + packages ของ ACMD ทั้งหมด
3. rename ตัด prefix `acmd-` ออก (acmd-api → api ฯลฯ)
4. ตั้ง Docker ใหม่ — ต่อ postgres ของ vollos-core
5. ตรวจว่า `acmd_user` มีอยู่แล้ว (init-db.sql รันครั้งเดียวใน Phase A แล้ว — ไม่ต้องรันซ้ำ)
6. เปลี่ยน auth calls ใน acmd-api ให้ยิงหา vollos-core auth-service แทน
7. ตั้ง CI/CD ของ acmd (copy template จาก vollos-core)
8. รัน migration ทั้งหมดบน DB กลาง
9. ทดสอบ full flow: login → dashboard → case workflow

### Phase C — ทำความสะอาด monorepo เดิม
1. ลบ apps/acmd-* และ packages/acmd-* ออกจาก vollos repo เดิม
2. อัพเดท docker-compose.yml ลบ ACMD services ออก
3. อัพเดท CI/CD ลบ ACMD-related steps
4. tag monorepo เดิมเป็น `archive/pre-split` ก่อนลบ

---

## 7. แม่แบบสำหรับ Product ใหม่ (เช่น BenefitGuard)

ทุก product ใหม่ทำตาม checklist นี้:

```
□ สร้าง repo ใหม่บน GitLab ชื่อ {product-name}
□ โครงสร้าง folder ตามแม่แบบ:
  apps/
    api/          ← Hono + Node backend
    web/          ← React frontend
    landing/      ← static HTML (optional)
  packages/
    db/           ← Drizzle schema + migrations (PostgreSQL schema: {product})
    shared/       ← types/utils เฉพาะ product นี้
    ai/           ← AI utilities (ถ้าต้องการ)
□ สร้าง DB user: {product}_user — permissions เฉพาะ {product} schema เท่านั้น
□ Docker: connect ไปหา postgres ของ vollos-core
□ Auth: ยิง HTTP ไปหา vollos-core auth-service
□ JWT verification: fetch JWKS จาก vollos-core/.well-known/jwks.json (RS256) — ห้ามใช้ VOLLOS_JWT_SECRET
□ CI/CD: copy .gitlab-ci.yml template จาก acmd repo แล้วแก้ชื่อ
□ ทดสอบ standalone ก่อน integrate กับ vollos-core
```

**กฎตั้งชื่อ (บังคับ):**
- ตาราง DB: ใช้ PostgreSQL schema แยก เช่น `benefitguard.cases`, `acmd.users` (ไม่ใช้ prefix ใน public schema)
- Docker network: join `vollos-network`
- Port: ไม่ชนกัน (จด port map ใน vollos-core README)

---

## 8. จุดที่ต้องตัดสินใจก่อนเริ่ม

| # | คำถาม | ตัวเลือก |
|---|-------|---------|
| 1 | `packages/crypto` (เข้ารหัสข้อมูลการแพทย์) ควรอยู่ที่ไหน? | ✅ ตัดสินใจแล้ว: Option A — copy เข้า acmd repo (latency hit ทุก request ถ้าเป็น API) |
| 2 | เริ่ม Phase A หรือ Phase B ก่อน? | แนะนำ: Phase A ก่อน (vollos-core ต้องพร้อมก่อน) |
| 3 | monorepo เดิม (vollos) จะเก็บไว้หรือลบทิ้ง? | แนะนำ: tag archive ไว้ก่อน ไม่ลบทันที |

> **หมายเหตุ Auth:** ใช้ RS256 + JWKS — vollos-core มี private key, ทุก product ดึง public key เองผ่าน `/.well-known/jwks.json` ไม่มีการแชร์ secret ข้าม repo

---

## 9. ทีมงานแต่ละ Repo

แต่ละ repo มีทีมของตัวเองบน GitLab — ตั้ง member แยกกันได้อิสระ

**ตัวอย่าง:**
```
vollos-core  → Lead, Backend, DevOps
acmd         → Lead, Backend, Frontend, QA
bnfg         → Lead, Backend, Frontend, QA (คนละชุด หรือซ้อนกันบางคนก็ได้)
```

**กฎ GitLab:**
- คนคนเดียวอยู่หลาย repo ได้ (เช่น DevOps อยู่ทุก repo)
- แต่ละ repo ตั้ง role แยกกัน (Maintainer / Developer / Reporter)
- ทีม core ไม่จำเป็นต้องเข้าถึง repo ของ product และกลับกัน

**แม่แบบทีมขั้นต่ำต่อ repo:**

| Role | หน้าที่ |
|------|---------|
| Lead | วางแผน ตัดสิน architecture สั่งงานทีม |
| Backend | API, database, business logic |
| Frontend | UI, web app (ถ้า product มี web) |
| QA | ทดสอบ flow ครบ + integration test |
| DevOps | Docker, CI/CD, deploy (อาจใช้คนเดียวกันข้าม repo) |

---

## 10. Skills + Tooling Files — ย้ายไปไหน

### Skills (ทีม AI)

| Skill | ประเภท | อยู่ที่ไหน |
|-------|--------|----------|
| vollos-lead, vollos-backend, vollos-frontend, vollos-qa, vollos-auditor, vollos-devops, vollos-e2e-tester | กลาง — ใช้ได้ทุก repo | `~/.claude/skills/` บนเครื่อง |
| acmd-legal, acmd-hr-expert | เฉพาะ ACMD | `acmd/.claude/skills/` |
| bnfg-legal, bnfg-... (อนาคต) | เฉพาะ product นั้น | `{product}/.claude/skills/` |

**หมายเหตุ:** `acmd-e2e-tester` เดิม → rename เป็น `vollos-e2e-tester` แล้วย้ายไป global (tester รู้วิธีทดสอบ, ความรู้ว่าทดสอบอะไรมาจาก task.md)

### Setup คนใหม่ (บังคับทำก่อนใช้งาน)

เพราะ global skills ไม่ได้อยู่ใน repo — คนใหม่ต้องติดตั้งเองครั้งแรก:
```bash
# รัน 1 ครั้งบนเครื่องใหม่ (ดูรายละเอียดใน vollos-core/README.md)
cp -r vollos-core/.claude/skills/vollos-* ~/.claude/skills/
cp -r vollos-core/.claude/skills/vollos-e2e-tester ~/.claude/skills/
```
หลังจากนั้นทุก repo ใช้ `/lead`, `/backend` ฯลฯ ได้เลย

### Tooling Files

| ไฟล์/โฟลเดอร์ | ย้ายไปที่ |
|---|---|
| `infra/` (Caddyfile, docker-compose.prod.yml, backup.sh ฯลฯ) | `vollos-core/infra/` |
| `_workspace/` + `_board.md` | แต่ละ repo มีของตัวเอง |
| `restructure-vollos/` (แผนนี้) | `vollos-core/docs/restructure/` เก็บเป็น archive |

---

## 11. Port Numbering Convention

**Pattern:** `{product}{service}`
- 2 หลักแรก = product
- 2 หลักหลัง = ประเภท service

### Product Numbers
| Prefix | Product |
|--------|---------|
| 30 | vollos-core |
| 31 | acmd |
| 32 | bnfg (BenefitGuard) |
| 33 | product ถัดไป |
| ... | เพิ่มขึ้นทีละ 1 |

### Service Numbers
| Suffix | ประเภท |
|--------|--------|
| 01 | api (backend) |
| 02 | web (frontend dev server) |
| 03 | landing |
| 04 | auth service |

### Port Map ปัจจุบัน
| Port | ความหมาย |
|------|---------|
| **3001** | vollos-core — api |
| **3004** | vollos-core — auth |
| **3101** | acmd — api |
| **3102** | acmd — web |
| **3103** | acmd — landing |
| **3201** | bnfg — api |
| **3202** | bnfg — web |
| **3203** | bnfg — landing |

**กฎ:** product ใหม่ทุกตัวต้องจด port ที่ใช้ใน vollos-core README ก่อน เพื่อป้องกัน port ชนกัน

---

## 12. Best Practices (มาตรฐานทีม)

### ✅ มีแล้ว
- Docker + CI/CD pipeline
- Migration-based DB (ไม่แก้ตรงๆ)
- QA + Security review ก่อน merge

### 🔲 ต้องเพิ่ม — เรียงตามความสำคัญ

**หมวด Git:**
- [ ] Branch protection on main — ห้าม push ตรง ต้องผ่าน MR เท่านั้น
- [ ] Pipeline ต้องผ่านก่อน merge ได้ (typecheck + lint + test + build)
- [ ] Conventional Commits — รูปแบบ commit message: `feat:`, `fix:`, `chore:`, `docs:` → auto changelog

**หมวด Secret:**
- [ ] เก็บ secret ใน GitLab CI/CD Variables (masked) ไม่ใช่แค่ .env บน VPS
- [ ] `.env.example` ทุก repo ต้องครบ ไม่มี secret จริง

**หมวด Environment:**
- [ ] เพิ่ม Staging environment — ทดสอบก่อน production (ทำเมื่อมี product จริงแล้ว)
- [ ] Pipeline: feature → test → staging (auto) → production (manual approve)

**หมวด API:**
- [ ] Health endpoint ทุก service: `GET /health → { status: "ok" }` — ต้องมีก่อน pipeline health check
- [ ] API versioning `/api/v1/` ตั้งแต่ต้น

**หมวด Monitoring:**
- [ ] Uptime monitor (UptimeRobot — ฟรี) แจ้งเตือนถ้า service ล่ม
- [ ] Error tracking (Sentry — ฟรี tier) รู้ว่า production พังตรงไหน

**หมวด Release:**
- [ ] Semantic Versioning — tag release `v1.0.0`, `v1.1.0`
- [ ] Auto-generate CHANGELOG จาก conventional commits

### ลำดับที่แนะนำ
| ลำดับ | สิ่งที่ทำ | เมื่อไหร่ |
|-------|---------|---------|
| 1 | Branch protection + conventional commits | ก่อนเริ่ม restructure |
| 2 | Health endpoint ทุก service | ระหว่าง Phase A/B |
| 3 | GitLab CI/CD Variables | ระหว่าง Phase A/B |
| 4 | Staging environment | เมื่อ launch product แรก |
| 5 | Monitoring (UptimeRobot + Sentry) | เมื่อ launch จริง |

---

## 13. MR Review Workflow — ใครดูแล Best Practice

### การทดสอบอัตโนมัติ (ทุก MR)
Pipeline รันเองทุกครั้งที่ push — ต้องผ่านครบก่อน merge ได้:
```
1. typecheck  → TypeScript ไม่มี error
2. lint       → โค้ดถูกรูปแบบ
3. unit test  → ฟังก์ชันทำงานถูก
4. build      → build สำเร็จ
```
ถ้าแดงข้อใดข้อหนึ่ง → merge ไม่ได้เลย (GitLab บังคับ)

### ชั้นการดูแล
| ชั้น | ใครดูแล | หน้าที่ |
|------|---------|--------|
| อัตโนมัติ | GitLab | branch protection, pipeline must pass |
| AI | Lead + Auditor + Domain Expert | Lead ตรวจ code quality, Auditor ตรวจ security, Domain Expert ตรวจ business logic (ถ้า MR แตะ domain) |
| คน | เจ้านาย | อนุมัติ MR สำคัญ, ตัดสินใจเรื่องใหญ่ |

### MR Review Process (ทุก MR)
```
1. developer เปิด MR
2. pipeline รันอัตโนมัติ (test + build)
3. Lead agent review code + checklist
4. Auditor ตรวจ security (ถ้า MR แตะ auth/data/API)
5. เจ้านาย approve
6. merge → deploy อัตโนมัติ
```

### กฎ: Lead ต้อง review MR ทุกอัน
- ตรวจว่าทำตาม conventional commits ไหม
- ตรวจว่ามี test ครอบคลุมไหม
- ตรวจว่าไม่มี placeholder / alert() หลงเหลือ
- ตรวจว่า .env.example อัพเดทถ้ามี env ใหม่

---

## 14. Domain Expert Gate (บังคับทุก product)

### กฎ: ทุก product repo ต้องมี domain expert
```
repo/.claude/skills/domain-expert/   ← บังคับ ขาดไม่ได้
```
ถ้าไม่มี → Lead ไม่มีข้อมูลพอ → ห้ามเริ่มงานใดๆ

### กฎ: Lead ต้องคุยกับ domain expert ก่อนเสมอ
```
Lead workflow บังคับ:
  1. spawn domain expert
  2. domain expert ผลิต domain-brief.md
  3. Lead อ่าน domain-brief.md
  4. Lead เขียน task.md พร้อม reference
  5. Lead spawn ทีม (backend, qa, ฯลฯ)
```

### หลักฐานบังคับใน task.md
task.md ทุกอันต้องมี field นี้ก่อน spawn ทีมได้:
```yaml
domain_consultation:
  expert: domain-expert
  brief: _workspace/{task-id}/domain-brief.md
  key_points:
    - "quote จาก domain-brief.md พร้อม :line"
    - "quote จาก domain-brief.md พร้อม :line"
```

### Enforcement
| สถานการณ์ | Lead ทำอะไร |
|-----------|------------|
| ไม่มี domain-brief.md | ห้าม spawn ทีม — ต้อง spawn domain expert ก่อน |
| domain_consultation ว่าง/generic | task.md invalid — ต้องกลับไปคุย domain expert ใหม่ |
| key_points ไม่มี file:line | reject — Lead โกหกว่าคุยแล้ว ต้องทำใหม่ |

### เหตุผล
Lead ที่ไม่มีหลักฐานการคุยกับ domain expert = Lead ใช้ความคิดตัวเองไปสั่งงาน
งานที่ออกมาจะผิด domain → ต้องทำใหม่ทั้งหมด

---

## 15. Architecture Decisions + Bug Fixes (จากการ audit plan)

> audit พบ 12 ช่องโหว่ — 4 Critical, 5 High, 3 Medium
> section นี้บันทึกการตัดสินใจและวิธีแก้ทุกข้อ

---

### การตัดสินใจ 4 ข้อหลัก

| # | คำถาม | คำตอบที่เลือก |
|---|-------|-------------|
| ข้อ 4 | auth user table อยู่ที่ไหน? | Option A — vollos-core เก็บ identity, product เก็บ profile |
| ข้อ 3 | acmd CI ทำไง? | Option A — spin up vollos-core container ใน acmd CI |
| ข้อ 12 | crypto package อยู่ที่ไหน? | Option A — copy เข้า acmd repo |
| ข้อ 9 | sessions เดิมทำไง? | ยอมรับ force logout — ACMD ยังไม่มี user จริง |

---

### 🔴 Critical Fixes

**1. JWT Algorithm — ใช้ RS256 ทั้งหมด (ลบ HS256 ออก)**
- หัวข้อ 7 template ข้อ "JWT verification: local (ใช้ VOLLOS_JWT_SECRET)" → เปลี่ยนเป็น "fetch JWKS จาก vollos-core"
- packages/auth/src/jwt.ts ต้องแก้จาก symmetric (TextEncoder) → importJWK + RS256
- ไม่มี JWT_SECRET แชร์ข้าม repo อีกต่อไป

**1b. Drizzle Schema Migration — ต้องทำใน Phase B (สำคัญมาก)**
การใช้ PostgreSQL schema แยกต้องเปลี่ยน Drizzle codebase ทั้งหมด:

```ts
// เดิม (public schema + prefix)
export const cases = pgTable('acmd_cases', {...})

// ใหม่ (acmd schema)
const acmdSchema = pgSchema('acmd')
export const cases = acmdSchema.table('cases', {...})
```

drizzle.config.ts ต้องเพิ่ม:
```ts
// กำหนด migrations table ให้อยู่ใน acmd schema
migrationsTable: 'acmd_migrations',
migrationsSchema: 'acmd',
```

สิ่งที่ต้องทำใน Phase B:
- แก้ Drizzle schema definitions ทุกไฟล์ใน packages/acmd-db/src/
- อัพเดท drizzle.config.ts
- สร้าง SQL migration ย้าย public.acmd_* → acmd.* (ถ้ามีข้อมูลอยู่แล้ว)
- GRANT CREATE ON SCHEMA acmd TO acmd_user (ให้สร้าง migration tracking table ได้)
- รัน typecheck หลังเปลี่ยนทุกครั้ง

**2. Docker Network — postgres ต้องอยู่ใน vollos-network ด้วย**
```yaml
# vollos-core/docker-compose.yml — เจ้าของ network (สร้าง network)
postgres:
  networks:
    - internal
    - vollos-network   ← เพิ่ม

networks:
  vollos-network:
    driver: bridge     ← vollos-core สร้าง network นี้

# acmd/docker-compose.yml — ผู้เข้าร่วม (join network ที่มีอยู่แล้ว)
networks:
  vollos-network:
    external: true     ← acmd join network ที่ vollos-core สร้างไว้
```
vollos-core เปิดก่อน → สร้าง network → acmd เปิดทีหลัง → join network → คุย postgres ได้

**3. CI Pipeline — spin up vollos-core ใน acmd CI**
```yaml
# acmd/.gitlab-ci.yml
services:
  - name: registry.gitlab.com/vollos/vollos-core:${VOLLOS_CORE_SHA}
    alias: vollos-core
# VOLLOS_CORE_SHA = git SHA ของ vollos-core ที่ต้องการ ตั้งใน GitLab CI Variables
# ป้องกัน breaking change จาก vollos-core:latest ทำให้ acmd CI พังโดยไม่รู้สาเหตุ

variables:
  VOLLOS_AUTH_URL: http://vollos-core:3004
```
unit test → mock ได้ | integration test → ยิง vollos-core จริงผ่าน service

**4. Auth Architecture — Identity vs Profile**
```
vollos-core auth-service:
  auth.users (user_id, google_id, email, name)
  ← เจ้าของ identity จริง ออก JWT ที่มี user_id

acmd:
  acmd.user_profiles (user_id FK, role, company_id, ...)
  ← ข้อมูลเพิ่มเติมของ acmd เท่านั้น (อยู่ใน acmd schema)
  ← ถ้าไม่มี record = ยังไม่ได้ซื้อ acmd → 403
```
Login flow:
1. user → vollos-core → ได้ JWT (user_id + email)
2. acmd verify JWT ด้วย JWKS
3. acmd เช็ค acmd.user_profiles ด้วย user_id
4. ไม่มี record → 403 "กรุณาซื้อ package ก่อน"
5. มี record → เข้าได้

---

### 🟠 High Risk Fixes

**5. Migration Race Condition**
แต่ละ service/product ใช้ migration schema + table แยกกัน:
```
auth-service → migrationsSchema: 'auth',   migrationsTable: 'auth_migrations'
vollos-core  → migrationsSchema: 'vollos', migrationsTable: 'vollos_migrations'
acmd         → migrationsSchema: 'acmd',   migrationsTable: 'acmd_migrations'
```
ต้องระบุใน drizzle.config.ts ของทุก service/repo — ห้ามใช้ default (public.__drizzle_migrations) เพราะ user ไม่มีสิทธิ์ public schema
ไม่มีวัน conflict กัน

**6. Package Rename — ต้องทำพร้อม import path update**
Phase B step 3 ต้องรวม:
- rename package.json name
- grep + replace import paths ทุกไฟล์
- sync tsconfig paths
- รัน typecheck หลัง rename ทันที

**7. Production Cutover Plan**
```
1. maintenance window (แจ้ง user ล่วงหน้า)
2. หยุด monorepo production
3. backup DB ก่อน migrate:
   docker exec postgres pg_dump -U vollos vollos_dev > backup_$(date +%Y%m%d_%H%M%S).sql
   (POSTGRES_USER default คือ vollos ตาม docker-compose.yml — เก็บไฟล์ backup ไว้นอก container ก่อนดำเนินการต่อ)
4. รัน migration บน vollos-core ก่อน
5. รัน migration ของ acmd
6. start vollos-core → smoke test
7. start acmd → smoke test
8. เปิด traffic
ถ้าล้มเหลว → restore DB backup:
   docker exec -i postgres psql -U vollos vollos_dev < backup_YYYYMMDD_HHMMSS.sql
   แล้ว start monorepo เดิม
```

**8. DB User Bootstrap — init script บังคับ**
```sql
-- vollos-core/scripts/init-db.sql (รันด้วย superuser ครั้งแรก)

-- สร้าง schemas แยกกัน (แต่ละ product เห็นเฉพาะ schema ตัวเอง)
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS vollos;
CREATE SCHEMA IF NOT EXISTS acmd;

-- สร้าง users (IF NOT EXISTS ป้องกัน error ถ้ารัน script ซ้ำ)
CREATE USER IF NOT EXISTS auth_user WITH PASSWORD '...';
CREATE USER IF NOT EXISTS vollos_user WITH PASSWORD '...';
CREATE USER IF NOT EXISTS acmd_user WITH PASSWORD '...';

-- grant เฉพาะ schema ของตัวเอง
GRANT ALL ON SCHEMA auth TO auth_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO auth_user;

GRANT ALL ON SCHEMA vollos TO vollos_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA vollos
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vollos_user;

GRANT ALL ON SCHEMA acmd TO acmd_user; -- ALL รวม USAGE + CREATE แล้ว ไม่ต้อง GRANT CREATE ซ้ำ
ALTER DEFAULT PRIVILEGES IN SCHEMA acmd
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO acmd_user;
-- acmd_user ไม่เห็น schema auth หรือ vollos เลย
-- migration tracking tables: auth.auth_migrations, vollos.vollos_migrations, acmd.acmd_migrations (กำหนดใน drizzle.config.ts ของแต่ละ service)
```
ผลลัพธ์: acmd.cases, acmd.users, auth.users, vollos.leads — แต่ละ user เห็นเฉพาะ schema ตัวเอง
รันโดย DevOps ด้วย superuser ก่อน Phase A เสมอ

---

### 🟡 Medium Fixes

**10. JWKS Caching Strategy**
```
cache public key 1 ชั่วโมง
ถ้า JWT มี kid ไม่ match cache → force refresh ทันที
ไม่ fetch JWKS ทุก request — fetch ครั้งแรก + refresh เมื่อ key หมดอายุ
```

**11. Port Migration Checklist**
เมื่อเปลี่ยน port ต้องอัพเดททุกที่:
- [ ] docker-compose.yml
- [ ] Caddy/reverse proxy config บน VPS
- [ ] .env และ .env.example
- [ ] CI/CD smoke test curl commands
- [ ] README และ documentation

**12. crypto package → copy เข้า acmd**
- copy packages/crypto → acmd/packages/crypto
- ไม่ expose เป็น API (latency hit ทุก medical record read/write)
- ลบออกจาก vollos-core หลัง copy เสร็จ
