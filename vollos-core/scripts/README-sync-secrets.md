# sync-secrets.sh

Distribute GitLab CI/CD Variables from a single source-of-truth project
(`tummadajingjing/vollos-core`) to one or more product repos
(`vollos-acmd`, `vollos-bnfg`, ...).

The script never prints raw secret values. Audit output uses
`sha256:<first-8-hex>` fingerprints only.

---

## TH (ภาษาไทย)

### ใช้เมื่อไร

- หมุน secret ที่ `vollos-core` แล้วต้อง sync ไป product repo ทุกตัว
- เพิ่ม product repo ใหม่ — sync secret ชุดเดียวกันเข้า project ใหม่
- ตรวจว่า target repo ทุกตัวมี secret ตรงกับ source (drift detection)

### Setup ครั้งแรก

```bash
cp scripts/secrets-config.example.yaml scripts/secrets-config.yaml
# แก้ targets / keys ตามที่ต้องการ (ไฟล์นี้ gitignored แล้ว)
```

ต้องมี `VOLLOS_CLI_v2` (GitLab Personal Access Token, scope: `api`) ใน
`.env` ที่ root ของ repo นี้ — script load ให้อัตโนมัติ

### คำสั่งใช้บ่อย

```bash
# ดูว่าจะเปลี่ยนอะไร (default mode — ไม่แตะ GitLab)
./scripts/sync-secrets.sh

# Apply จริง (ต้องระบุ --apply)
./scripts/sync-secrets.sh --apply

# Sync key เฉพาะตัว ไป target เฉพาะ (ad-hoc)
./scripts/sync-secrets.sh \
  --target tummadajingjing/vollos-acmd \
  --keys GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET \
  --apply

# ใช้ config คนละไฟล์
./scripts/sync-secrets.sh --config /path/to/other.yaml --dry-run
```

### Output ตัวอย่าง

```
=== sync-secrets.sh — apply mode ===
Source: tummadajingjing/vollos-core
Targets: tummadajingjing/vollos-acmd

[tummadajingjing/vollos-acmd]
  GOOGLE_CLIENT_ID       sha256:170eefb5  ✅ already in sync
  GOOGLE_CLIENT_SECRET   sha256:ab8cb5cb  🔄 UPDATED (was sha256:11223344)
  GOOGLE_REFRESH_TOKEN   sha256:c29311d4  ➕ CREATED
  GMAIL_USER             sha256:cdd35c43  ✅ already in sync

Summary: 1 created, 1 updated, 2 already in sync, 0 errors.
```

### กฎความปลอดภัย

- **ห้าม commit** `scripts/secrets-config.yaml` (อยู่ใน `.gitignore` แล้ว)
- script ไม่เคยพิมพ์ค่า secret — แสดงแค่ sha256:8 fingerprint
- ค่า secret ที่ดาวน์โหลดมาเก็บใน `/tmp/T-088-sync-XXXXXX/` (chmod 700)
  และถูก `shred -u` ทันทีเมื่อ script จบ
- ห้ามรันด้วย `bash -x` หรือ `set -x` — จะ leak token ใน curl command
- ทุกครั้งหมุน secret → sync ทันที ห้ามค้างไว้

### Exit codes

| code | meaning |
|------|---------|
| 0 | success (all in sync after run, or dry-run completed) |
| 1 | GitLab HTTP error (network / 5xx / per-key error count > 0) |
| 2 | missing token (`VOLLOS_CLI_v2` not in `.env`) |
| 3 | missing source key (key listed in config not found at source) |
| 4 | target repo not accessible (403/404 — token scope wrong) |
| 5 | sha256 mismatch after apply (CRITICAL — investigate immediately) |
| 6 | invalid arguments / config |

### เมื่อไหร่จะเลิกใช้

ถ้าวันหนึ่ง owner ย้าย repo ทั้งหมดเข้า GitLab Group แล้วเปิด **Group
Variables** → script นี้ไม่จำเป็นอีก เพราะ Group Variables inherit ลง project
อัตโนมัติ ดู `~/.claude/projects/-home-ipon-workspace-vollos-ai-vollos-core/memory/project_secrets_strategy.md`
สำหรับ migration plan

---

## EN (English)

### Why this exists

GitLab Group Variables would be the cleanest solution, but VOLLOS repos live
under a personal namespace (`tummadajingjing/`) because the owner's purchased
CI/CD minutes are bound to that personal namespace and don't transfer to
groups. Until that changes, secrets must be copied per-project.

This script does that copy idempotently and safely.

### Quick start

```bash
# 1. Copy config template (the real config is gitignored)
cp scripts/secrets-config.example.yaml scripts/secrets-config.yaml

# 2. Ensure VOLLOS_CLI_v2 is set in .env (GitLab PAT with `api` scope)

# 3. Dry-run first — always
./scripts/sync-secrets.sh

# 4. Apply if the dry-run looks right
./scripts/sync-secrets.sh --apply
```

### Modes

| Mode | Flag | Behavior |
|------|------|----------|
| Dry-run (default) | `--dry-run` (or omitted) | Print what would change. Never writes. |
| Apply | `--apply` | Writes via PUT/POST. Verifies sha256 after each write. |
| Ad-hoc | `--target REPO --keys K1,K2 --apply` | Bypass config file. Source defaults to `tummadajingjing/vollos-core`. |

### How it decides

For every (target, key) pair:

1. GET source value, compute `sha256:8`
2. GET target value, compute `sha256:8`
3. Match → skip (`✅ already in sync`)
4. No match → dry-run prints `🔄 WOULD UPDATE`, apply runs PUT then re-GETs and
   compares fingerprints again. Mismatch after PUT exits with code 5.
5. Target 404 → dry-run prints `➕ WOULD CREATE`, apply runs POST then verifies.

### Security guarantees

- No raw values printed to stdout/stderr/log
- No raw values written to disk except in `mktemp -d` dir (`chmod 700`),
  shredded on exit via `trap`
- No `set -x` (would echo curl with token)
- HTTP body is never echoed without status-code framing
- Token unset on exit

### Operational guidance

- Run after every secret rotation in `vollos-core`
- Run as the last step of onboarding a new product repo
- Keep `secrets-config.yaml` out of git (already in `.gitignore`)
- If `--apply` exits 5, do **not** retry blindly — investigate (could be a
  GitLab masking constraint silently dropping characters from your value).
