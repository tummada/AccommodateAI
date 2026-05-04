---
task_id: T-083
agent: vollos-devops
completed_at: 2026-04-28T15:55:00Z
status: completed
---

# T-083 — Cert Diagnostic (read-only)

## Summary (1-line)

Cert ปัจจุบันบน VPS เป็น Cloudflare Origin Certificate ครอบ `*.vollos.ai` + `vollos.ai` เท่านั้น (single-level wildcard) — **ไม่ครอบ** `accommodate.vollos.ai` หรือ `*.accommodate.vollos.ai` (multi-level subdomains) → T-084 ต้อง regenerate cert ใหม่

## Important Note — Cert Location

`infra/certs/` ไม่มีในไฟล์ local repo — gitignored ตาม `.gitignore:15-21`:
```
# T-008: also blocks Cloudflare Origin Certificate (.pem + .key) in infra/certs/
*.pem
*.key
keys/*.pem
keys/*.key
infra/certs/
```

ไฟล์ cert จริงอยู่บน VPS เท่านั้น (`/home/ipon/vollos-core/infra/certs/`) — ตรวจผ่าน SSH เพื่อทำ diagnostic ให้ได้ข้อมูลจริง (alternative path คือ Caddyfile L10-15 ระบุไว้ชัด)

## Findings

```yaml
findings:
  cert_path_local: "infra/certs/cloudflare.pem (DOES NOT EXIST locally — gitignored)"
  cert_path_vps: "/home/ipon/vollos-core/infra/certs/cloudflare.pem"
  subject: 'O = "CloudFlare, Inc.", OU = CloudFlare Origin CA, CN = CloudFlare Origin Certificate'
  issuer: 'C = US, ST = California, L = San Francisco, O = "CloudFlare, Inc.", OU = CloudFlare Origin SSL ECC Certificate Authority'
  sans:
    - "*.vollos.ai"
    - "vollos.ai"
  not_before: "Mar 26 15:51:00 2026 GMT"
  not_after: "Mar 22 15:51:00 2041 GMT (15-year Cloudflare Origin CA cert)"
  covers_accommodate_subdomains: false
  coverage_analysis:
    accommodate_vollos_ai: "NOT covered — `*.vollos.ai` is single-level wildcard; does NOT match multi-level subdomain (accommodate.vollos.ai matches but app.accommodate.vollos.ai / api.accommodate.vollos.ai do NOT)"
    apex_accommodate: "accommodate.vollos.ai IS covered by `*.vollos.ai` (one label depth)"
    deep_subdomains: "app.accommodate.vollos.ai + api.accommodate.vollos.ai NOT covered (two label depths) — wildcard SAN matches only ONE label per RFC 6125 §6.4.3"
  cert_files_in_dir:
    - filename: "cloudflare.pem"
      size_bytes: 1143
      permissions: "-rw-r--r-- (644)"
      owner: "ubuntu:ubuntu"
      mtime: "Apr 18 12:40 2026"
      content_displayed: "public cert metadata only (Subject/SAN/dates) — full PEM body not shown"
    - filename: "cloudflare.key"
      size_bytes: 241
      permissions: "-rw------- (600)"
      owner: "ubuntu:ubuntu"
      mtime: "Apr 18 12:40 2026"
      content_displayed: "FILENAME + METADATA ONLY — private key contents not displayed (per task constraint #3)"
```

## Verification Output

### 1. ls -la (on VPS — local dir does not exist)

```
$ ssh ... ls -la /home/ipon/vollos-core/infra/certs/
total 16
drwxrwxr-x 2 ipon   ipon   4096 Apr 18 12:40 .
drwxrwxr-x 4 ipon   ipon   4096 Apr 20 10:42 ..
-rw------- 1 ubuntu ubuntu  241 Apr 18 12:40 cloudflare.key
-rw-r--r-- 1 ubuntu ubuntu 1143 Apr 18 12:40 cloudflare.pem
```

### 2. openssl x509 (on VPS)

```
$ openssl x509 -in /home/ipon/vollos-core/infra/certs/cloudflare.pem \
    -noout -subject -ext subjectAltName -dates -issuer

subject=O = "CloudFlare, Inc.", OU = CloudFlare Origin CA, CN = CloudFlare Origin Certificate
X509v3 Subject Alternative Name:
    DNS:*.vollos.ai, DNS:vollos.ai
notBefore=Mar 26 15:51:00 2026 GMT
notAfter=Mar 22 15:51:00 2041 GMT
issuer=C = US, ST = California, L = San Francisco, O = "CloudFlare, Inc.", OU = CloudFlare Origin SSL ECC Certificate Authority
```

### 3. git status (after task — clean)

```
 M _board.md
 M _workspace/T-075/output.md
?? _workspace/T-076/
?? _workspace/T-077/
?? _workspace/T-078/
?? _workspace/T-079/
?? _workspace/T-080/
?? _workspace/T-081/
?? _workspace/T-082/
?? _workspace/T-083/
```

ไม่มีการแก้ไฟล์อื่นนอกจาก output.md ใน T-083 (untracked dir ที่ Lead สร้าง task.md ไว้ + output.md ที่ devops เขียน)

## Implication for T-084

cert ปัจจุบันใช้ไม่ได้สำหรับ acmd routes — ต้อง regenerate cert ใหม่ที่ครอบทั้ง:
- `vollos.ai` + `*.vollos.ai` (existing — ต้องคงไว้)
- `accommodate.vollos.ai` (apex of new branch — covered already by `*.vollos.ai` แต่ต้องยืนยัน)
- `*.accommodate.vollos.ai` (new — for app./api./acmd-landing routes)

แนะนำ T-084 generate cert ใหม่ผ่าน Cloudflare Origin CA dashboard with hostnames:
```
vollos.ai, *.vollos.ai, accommodate.vollos.ai, *.accommodate.vollos.ai
```

ตามที่ owner approved (separate cert per best practice):
- **Option A** (single cert ครอบทุก hostname above) — operationally ง่ายที่สุด
- **Option B** (cert แยกไฟล์: `cloudflare.pem` + `cloudflare-acmd.pem`) — แยก blast radius ถ้า leak

owner เลือก Option B (per task.md L20: "แยก cert ตาม best practice (ไม่รวมเป็น cert เดียว)") → T-084 จะสร้างไฟล์ใหม่ `cloudflare-acmd.pem` + `cloudflare-acmd.key` คู่กับของเดิม

## skill_loaded_evidence

```yaml
files_read:
  - "SKILL.md:L36-39 — '🔴 SECRET HANDLING: ก่อนรัน command ที่อาจ resolve env vars/secrets... Output.md ใช้ sha256 first-8 fingerprint เท่านั้น — ห้าม plaintext secret values'"
  - "SKILL.md:L57-58 — 'Re-anchor: อ่าน Critical Rules + Security Rules ทุกครั้งที่เริ่ม task ใหม่'"
  - "SKILL.md:L417-426 — 'AI Behavior Rules: ห้ามรัน destructive commands... ทุก config change ต้องมี verification command'"
```

## re_anchor_evidence

- "Critical Rules: read before delivery — ห้าม spawn Agent tool, ห้ามแก้ไฟล์นอก owned areas, ห้ามรัน destructive commands"
- "Security Rules: read before delivery — ห้ามแสดง private key contents (task constraint #3 + global rule 'NEVER display secrets')"
- "Read-only constraint: confirmed — task.md L44 'ห้ามแก้ไฟล์ใดๆ ไม่ commit ไม่ push'"

## files_changed

```yaml
- path: _workspace/T-083/output.md
  action: created
  existing_read: "task.md:L48-72 — output format spec"
```

(ไม่ได้แตะไฟล์อื่นใดใน repo ตาม read-only constraint)

## self_review

```yaml
ran_openssl:
  result: true
  evidence: "Verification Output §2 — openssl x509 -in /home/ipon/vollos-core/infra/certs/cloudflare.pem -noout -subject -ext subjectAltName -dates -issuer returned full output with SAN DNS:*.vollos.ai, DNS:vollos.ai + notAfter Mar 22 2041"
san_extracted:
  result: true
  evidence: "findings.sans (output.md L31-33) — SANs = ['*.vollos.ai', 'vollos.ai'] extracted from openssl X509v3 Subject Alternative Name field"
covers_accommodate_subdomains_determined:
  result: true
  evidence: "findings.coverage_analysis (output.md L36-39) — wildcard `*.vollos.ai` covers single label only (RFC 6125 §6.4.3); accommodate.vollos.ai is covered (one label) but app./api./acmd-landing.accommodate.vollos.ai NOT covered (two labels)"
no_files_modified:
  result: true
  evidence: "Verification Output §3 — git status output identical to pre-task baseline (same M _board.md, M _workspace/T-075/output.md, untracked T-076..T-083 dirs); only file created = _workspace/T-083/output.md (the deliverable itself, mandated by task.md L40)"
no_private_key_exposed:
  result: true
  evidence: "findings.cert_files_in_dir (output.md L51-56) — cloudflare.key listed with filename + size (241 bytes) + perms (600) + owner only; content_displayed='FILENAME + METADATA ONLY'; openssl was run only against .pem (public), never against .key"
no_secret_leaked:
  result: true
  evidence: "openssl output shown contains only Subject DN, SAN DNS names, validity dates, issuer DN — all PUBLIC fields of an X.509 certificate (no key material, no signature bytes)"
read_only_constraint_honored:
  result: true
  evidence: "git status (Verification Output §3) shows zero new modifications attributable to this task other than the deliverable output.md (mandated by task.md L40 owned_files)"
```

## next_action

null — completed. Lead can now use these findings to scope T-084 (regenerate Cloudflare Origin Cert that covers `*.accommodate.vollos.ai` + `accommodate.vollos.ai`)

## issues

[]

## notes

- Diagnostic ใช้ SSH เข้า VPS เพราะไฟล์ cert gitignored (`.gitignore:16-21`) ไม่มีใน repo local — Caddyfile L10-15 ยืนยันชัดว่า "Cert files are gitignored (*.pem / *.key) and synced onto the VPS out-of-band"
- ข้อมูลที่ display ทั้งหมดเป็น public X.509 metadata — ไม่มี private key bytes, signature bytes, หรือ secret value
- Cloudflare Origin Cert มี validity 15 ปี (Mar 2026 → Mar 2041) — ไม่ใช่ Let's Encrypt 90 วัน — ปกติของ CF Origin CA
- Caddyfile (`infra/Caddyfile:128, 159, 191`) reference cert file ตำแหน่งเดียวกันทั้ง 3 site blocks (auth.vollos.ai / vollos.ai / www.vollos.ai) — ใช้ cert เดียวกันหมด
- ตาม task.md L20 owner เลือก separate-cert pattern → T-084 ควรสร้าง `cloudflare-acmd.pem` + `cloudflare-acmd.key` แยก ไม่รวมกับของเดิม + Caddyfile route ของ acmd subdomains ต้อง reference ไฟล์ใหม่นี้
