---
task_id: T-083
title: ตรวจ cert ปัจจุบัน + รายงาน SAN coverage (read-only diagnostic)
agent: vollos-devops
spawn_started_at: 2026-04-28T15:38:21Z
priority: high
mode: 1
status: in_progress
parent_request: cross-repo handshake from Lead@acmd (M3-001 Beta launch)
---

## Context

acmd Lead ขอเพิ่ม Caddy routes 3 subdomains ใหม่ใต้ `*.accommodate.vollos.ai`:
- `accommodate.vollos.ai` → `acmd-landing:80`
- `app.accommodate.vollos.ai` → `acmd-web:80`
- `api.accommodate.vollos.ai` → `acmd-api:3101`

Owner approved (after consult mentor3) — แยก cert ตาม best practice (ไม่รวมเป็น cert เดียว)
mentor3 approved D1 (Caddy exception) + D12 (subdomain pattern)

## Task

**Read-only diagnostic** — ตรวจ cert ปัจจุบันที่ vollos-core ใช้อยู่ + รายงานว่า:
1. cert file path ที่ใช้จริง
2. SAN (Subject Alternative Names) ของ cert ปัจจุบัน
3. วันหมดอายุ
4. cert ปัจจุบันครอบ subdomain ของ accommodate ไหม (คาดว่าไม่)

## Acceptance Criteria

1. ✅ รัน `openssl x509 -in infra/certs/cloudflare.pem -noout -text` (local) — รายงาน Subject + SANs + Not After
2. ✅ ระบุชัดว่า cert ปัจจุบันครอบ `*.accommodate.vollos.ai` หรือไม่
3. ✅ ระบุไฟล์ cert ทั้งหมดใน `infra/certs/` (รวมถึง .key file ถ้ามี — ไม่แสดงเนื้อหา private key)
4. ✅ ห้ามแตะไฟล์ใดๆ — เป็น read-only diagnostic เท่านั้น
5. ✅ self_review field ครบ ทุก result: true + evidence file:line

## Owned Files

- `_workspace/T-083/output.md` (สร้างใหม่)

## Constraints

- **CRITICAL: read-only** — ห้ามแก้ไฟล์ใดๆ ไม่ commit ไม่ push
- ห้ามแสดงเนื้อหา private key (`*.key` files) — แสดงเฉพาะชื่อไฟล์ + permission + size
- public cert (`*.pem`) แสดง SAN/Subject/Expiry ได้

## Output Format

```yaml
task_id: T-083
agent: vollos-devops
completed_at: <ISO timestamp>
status: completed
findings:
  cert_path: "infra/certs/cloudflare.pem"
  subject: "<from openssl output>"
  sans:
    - "<SAN 1>"
    - "<SAN 2>"
  not_after: "<expiry date>"
  covers_accommodate_subdomains: false  # or true with evidence
  cert_files_in_dir:
    - filename: "cloudflare.pem"
      size_bytes: <N>
      permissions: "<unix perms>"
self_review:
  ran_openssl: { result: true, evidence: "command output line X" }
  san_extracted: { result: true, evidence: "..." }
  no_files_modified: { result: true, evidence: "git status clean" }
  no_private_key_exposed: { result: true, evidence: "only filenames listed for *.key" }
```

## Lead Notes

- งานนี้คือ pre-flight check ก่อน T-084 (regenerate cert)
- ผลของ T-083 จะกำหนดว่า T-084 ต้อง generate cert ใหม่อย่างไร
- ถ้าพบ cert ปัจจุบันครอบ accommodate ด้วย (unlikely) → T-084 cancel ใช้ของเดิม
