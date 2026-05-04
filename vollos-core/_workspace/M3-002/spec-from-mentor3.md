# M3-002 — Burn → Main 302 Redirect (Beta Invite Link Hardening)

**Date:** 2026-04-29 (Day 2 of Beta Launch Sprint)
**From:** mentor3 → vollos-core Lead
**Repo:** `vollos-core` (this repo — Caddy + DNS + TLS scope)
**Cross-ref:** acmd `_workspace/M3-001` (Beta gate token validation = destination of redirect)
**Priority:** MUST land before Day 5 Beta invite push (100 emails)

---

## 1. Why (Background)

Beta invite emails (Day 5, 100 ฉบับ) ส่งจาก burn domain `@tryvollos.com` / `@getvollos.com` (cold outreach reputation, warmed since 21 เม.ย.) — แต่ link ใน email ต้องพา recipient ไป `accommodate.vollos.ai/beta?token=xxx` (acmd Beta signup, host บน vollos-core VPS).

**Risk if not handled:** sender domain ≠ link domain = **spam filter flag เป็น phishing pattern** → mail ลง spam folder → reply rate < 1% → kill criterion trigger Day 8.

**Solution:** ส่ง email ที่มี link `tryvollos.com/beta?token=xxx` → vollos-core Caddy ทำ **HTTP 302 redirect** ไป `https://accommodate.vollos.ai/beta?token=xxx` (filter เห็น link domain = sender domain → ไม่ flag).

**Why vollos-core (not Cloudflare or app-level):** Pon ตัดสิน 2026-04-29 ว่า redirect ต้องอยู่ vollos-core เพราะ:
1. Single source of truth ของ infra (`vollos-core/infra/Caddyfile` + git-tracked + GPG backup)
2. Avoid Cloudflare config sprawl (ไม่แบ่ง routing logic ระหว่าง CF Page Rules กับ Caddy)
3. Consistent operational pattern กับ existing acmd subdomain routing (D1 already extends Caddy for `accommodate.vollos.ai`)

---

## 2. Scope Extension Required (acmd plan06 §7 D1)

ปัจจุบัน acmd plan06 §7 ระบุ "ห้ามแก้ vollos-core ระหว่าง MVP — **EXCEPTION D1:** Caddyfile แตะได้เฉพาะ subdomain route สำหรับ `accommodate.vollos.ai`".

**Request:** Pon + mentor3 + vollos-core Lead ตัดสินใจ extend **D1** ให้รวม:
- `tryvollos.com/beta*` → 302 redirect ไป `https://accommodate.vollos.ai/beta{uri}`
- `getvollos.com/beta*` → 302 redirect ไป `https://accommodate.vollos.ai/beta{uri}`

**Scope strictly limited to** `/beta*` path เท่านั้น — root `/` + path อื่นของ tryvollos / getvollos ไม่แตะ (กัน scope creep).

**Decision log entry needed (mentor3 DB):** decisions_log → idea=accommodateai, type=infrastructure, decision="D1_extend_burn_redirect_beta_path", reason="reduce phishing-pattern flag from sender≠link domain mismatch in Day 5 Beta invite".

---

## 3. Implementation Spec

### 3.1 Caddyfile site blocks (add to `vollos-core/infra/Caddyfile`)

```caddy
# Burn domain → main app redirect (M3-002, 2026-04-29)
# Scope: /beta path only — preserve email DNS records (MX/SPF/DKIM/DMARC) untouched
tryvollos.com {
    redir /beta* https://accommodate.vollos.ai{uri} 302
    # explicit deny everything else (no leak of other paths)
    respond / 404
    respond /* 404
}

getvollos.com {
    redir /beta* https://accommodate.vollos.ai{uri} 302
    respond / 404
    respond /* 404
}
```

**Notes on Caddy syntax:**
- `{uri}` = full path + query string ของ request (Caddy placeholder) → preserve `?token=xxx` automatically
- `redir ... 302` = HTTP 302 Temporary Redirect (NOT 301 — see §5 pitfall)
- `respond / 404` ปิด root และ path อื่น = avoid expose accidental endpoint

### 3.2 DNS records (DevOps action)

| Record | Current | Required |
|---|---|---|
| `tryvollos.com` A | (TBD — DevOps verify ก่อน) | ชี้ไป VPS public IP (`<VPS_IP>`) |
| `getvollos.com` A | (TBD) | ชี้ไป VPS public IP (`<VPS_IP>`) |
| `tryvollos.com` MX | (current — Google Workspace) | **UNCHANGED** (อย่าแก้) |
| `tryvollos.com` TXT (SPF/DKIM/DMARC) | (current) | **UNCHANGED** |
| `getvollos.com` MX / TXT | (current) | **UNCHANGED** |

**CRITICAL:** A record + MX/TXT เป็น records แยก — แก้ A ไม่กระทบ email. แต่ DevOps ต้อง:
1. **Snapshot DNS records ปัจจุบันก่อนแก้** (`dig tryvollos.com ANY +noall +answer > dns-snapshot-tryvollos-pre.txt`)
2. ตรวจ A record ปัจจุบันของ tryvollos.com — ถ้ามีอยู่แล้ว (เช่น parking page) = override / ถ้าไม่มี = add ใหม่
3. หลังแก้ verify MX/TXT ค่าเดิม unchanged (`dig MX tryvollos.com` + `dig TXT tryvollos.com` → diff กับ snapshot)

### 3.3 TLS certificate

vollos-core Caddy ต้อง issue cert สำหรับ `tryvollos.com` + `getvollos.com`:

**Option C1 — Caddy auto-issue Let's Encrypt** (RECOMMENDED ถ้า DNS ไม่ใช่ Cloudflare proxy):
- Caddy automatic management (ตั้งค่าอยู่แล้วใน global block)
- Requirements: port 80/443 public + A record DNS resolve correctly
- Verify: `caddy validate --config /etc/caddy/Caddyfile` then reload service

**Option C2 — Cloudflare Origin Cert** (ถ้า tryvollos / getvollos DNS proxy ผ่าน Cloudflare):
- Generate Origin Cert per domain → mount เป็น cert file → reference ใน Caddyfile `tls /path/cert.pem /path/key.pem`
- Same pattern กับ existing 3 acmd subdomains

DevOps ตรวจ DNS ปัจจุบัน + เลือก path → report ใน task output.

---

## 4. Test Cases (DevOps Acceptance Criteria)

| # | Test | Expected |
|---|---|---|
| 1 | `caddy validate --config /etc/caddy/Caddyfile` after edit | `Valid configuration` (no error) |
| 2 | `caddy reload` after edit | reload success, no service downtime |
| 3 | `curl -sI https://tryvollos.com/beta?token=test123` | HTTP 302 + `location: https://accommodate.vollos.ai/beta?token=test123` |
| 4 | `curl -sI https://getvollos.com/beta?token=test456` | HTTP 302 + `location: https://accommodate.vollos.ai/beta?token=test456` |
| 5 | `curl -sIL https://tryvollos.com/beta?token=valid_token_X` (follow redirect) | Final 200 + Beta signup form HTML body |
| 6 | `curl -sI https://tryvollos.com/` (root) | HTTP 404 |
| 7 | `curl -sI https://tryvollos.com/anything-else` | HTTP 404 |
| 8 | Email DNS unchanged: `dig MX tryvollos.com` + `dig TXT tryvollos.com` | ค่าเดิม diff = 0 (compare snapshot) |
| 9 | Email send test: `swaks --to test@gmail.com --from test@tryvollos.com --server smtp.gmail.com` (จาก Workspace) | Send successful (email infra unaffected) |
| 10 | Browser test: paste `https://tryvollos.com/beta?token=test` in Chrome → URL bar update + page renders | Pass |

---

## 5. Pitfalls / Notes

1. **DON'T break email DNS** — `tryvollos.com` ใช้ส่งเมล์ Mode A อยู่. Snapshot DNS ก่อน + diff หลัง (test #8). ถ้า MX หาย — rollback DNS ทันที.

2. **DON'T use 301** — ใช้ **302 (Temporary)** เท่านั้น. 301 = browser cache permanent → stuck cache ถ้าเปลี่ยน flow อนาคต.

3. **HTTPS required** — destination ต้องเป็น `https://accommodate.vollos.ai` (TLS valid Cloudflare Origin Cert ตามที่ T-068 vollos-core handshake confirm). ถ้า redirect ไป `http://` = filter flag insecure.

4. **Cert provisioning timing** — Let's Encrypt issuance ต้อง DNS resolve ก่อน. Workflow: (1) update DNS A record (2) wait 1-5 นาที DNS propagation (`dig tryvollos.com` confirm) (3) reload Caddy (4) Caddy auto-issue cert (5) test.

5. **Click tracking via Instantly = OFF** — ใน campaign Beta Day 5, mentor3 จะตั้ง click tracking = false (เพื่อไม่ให้ link ผ่าน Instantly redirect tracker `bdb.cx`). Track UTM ฝั่ง server-side log ของ acmd-api แทน.

6. **Email body link example (final form)**:
   ```
   Click here to claim your Beta access:
   https://tryvollos.com/beta?token=abc123xyz
   ```
   (1 link เดียว + unsubscribe link footer = 2 link total — กฎ G3 CAN-SPAM + best practice anti-spam)

7. **Reverse direction not in scope** — main → burn redirect ไม่ต้องการ. Edge เฉพาะ burn → main ทางเดียว.

---

## 6. Estimated Effort

- Caddyfile edit: 10 นาที
- DNS A record update + propagation: 5-30 นาที
- TLS cert issuance: 1-5 นาที (auto)
- Testing 10 cases: 30 นาที
- Total: **~1 ชั่วโมง** (DevOps single-track)

---

## 7. Owner + Timeline

- **Owner:** DevOps agent (under vollos-core Lead orchestration)
- **Pre-req:** Pon + mentor3 sign-off ของ D1 extension (mentor3 decisions_log entry) ก่อน DevOps spawn
- **Spawn timing:** Day 2-3 of acmd Beta Launch Sprint (parallel with acmd T-060 + T-061)
- **Deadline:** End of Day 4 (Day 5 = Beta invite push from mentor3, link must work)
- **Verifier:** vollos-core Auditor read-only run test cases §4 (esp. #8 email DNS unchanged) before Day 5

---

## 8. Cross-References

- acmd `_workspace/M3-001/spec-from-mentor3.md` AC-5 (Beta gate token validation — destination of redirect)
- acmd plan06.md §7 Constraint vollos-core (D1 exception scope — **MUST extend** for this M3-002)
- acmd plan06.md §11 Lead Handling (burn domain Mode A → Mode B transition)
- mentor3 audit_log id=551 (Day 1 audit, Day 2 readiness)
- mentor3 decisions_log id=126 (rubric pipeline_choice for Day 1 audit)
- vollos-core `infra/Caddyfile` lines 228-266 — existing 3 acmd subdomain pattern (reference style)
- vollos-core T-068 — acmd handshake (TLS valid 3 hostnames confirmed Day 1)

**Status:** PENDING — needs (1) D1 extension decision logged in mentor3 DB (2) vollos-core Lead ack (3) DevOps spawn → report back via vollos-core `_board.md`

---

**Signed:** mentor3 coach (vollos-mentor3 v3) — 2026-04-29 09:05 ICT
**Repo path:** `vollos-core/_workspace/M3-002/spec-from-mentor3.md` (single source — original acmd draft deleted 2026-04-29 per Pon directive)
