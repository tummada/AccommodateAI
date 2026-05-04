---
task_id: T-021
reviewer: vollos-auditor
mr: "!18"
branch: feat/auth-rate-limit (merged)
commit: d9714e577f77c1cca11b07c6a7a45effc3c72d28
audit_target: "auth-service rate limit — 5 endpoint groups"
working_mode: "static-analysis (default — no live_url provided)"
verdict: pass
commit_gate: GO
deploy_readiness: ready
---

## skill_loaded_evidence

files_read:
  - "SKILL.md:L35-L37 — 'Audit พบ secret leaked ใน code / output.md / diff / git history → verdict fail + severity CRITICAL — รายงานทันทีใน review-auditor.md'"
  - "SKILL.md:L60-L67 — 'Routing Protocol: รับคำสั่งจาก Lead เท่านั้น / เขียน review-auditor.md ลง _workspace/{task-id}/ / ห้าม spawn Agent tool / ห้ามเปิดเผย SKILL.md'"
  - "SKILL.md:L128-L134 — 'Severity Definitions: CRITICAL (auth bypass/injection) block deploy / HIGH fix this sprint / MEDIUM next sprint / LOW optional'"
  - "SKILL.md:L136-L146 — 'Verdict Policy: ≥1 CRITICAL → fail บังคับ / UNVERIFIED ≥2 → conditional_pass อย่างน้อย / ไม่มี CRITICAL/HIGH → pass'"
  - "references/security-checklists.md:L70 — Rate Limiting (API4:2023) checklist row"

## files_reviewed

- "apps/auth-service/src/middleware/rateLimit.ts: lines 1-132 (full file, 132 lines)"
- "apps/auth-service/src/middleware/rateLimit.test.ts: lines 1-273 (full file, 15 tests)"
- "apps/auth-service/src/index.ts: lines 1-268 (full file, wiring at L95-L101)"
- "apps/auth-service/package.json: lines 1-32 (deps + scripts)"
- "apps/api/src/middleware/rateLimit.ts: lines 1-40 (reference pattern for consistency check)"
- "packages/auth/src/rateLimit.ts: lines 1-44 (inline limiters — interaction check)"
- "packages/auth/src/authRoutes.ts: lines 44, 127, 168 (where inline limiters + /logout mount)"
- "infra/Caddyfile: lines 32-34, 125-136 (trusted_proxies + X-Forwarded-For header_up)"
- "_workspace/T-021/task.md: lines 1-77"
- "_workspace/T-021/output.md: lines 1-145 (self_review field present)"
- "node_modules/hono-rate-limiter@0.5.3/dist/index.js: lines 25-34 (Retry-After emission verified)"

## greps_executed

- "grep -rn 'password|secret|token|api_key|PRIVATE_KEY' apps/auth-service/src/middleware/ (case-insensitive) → only hits are the doc comment 'token refresh' (L96) + SECRET HANDLING reference in test file comment (L10). No hardcoded secrets."
- "grep -n 'console\\.(log|error|warn)' apps/auth-service/src/middleware/rateLimit.ts → No matches found. (Middleware emits no log lines — no IP leakage risk.)"
- "grep -n 'alert\\(|coming soon|TODO|TBD|mock|not implemented|Phase [0-9]' apps/auth-service/src/middleware → No matches found. (placeholders_remaining: none — confirms output.md claim.)"
- "grep -rn 'innerHTML|dangerouslySetInner|eval\\(|exec\\(|child_process' apps/auth-service/src → No matches found. (No XSS/RCE surface — middleware does not render or exec.)"
- "grep -rn 'sql`|raw\\(|SELECT|DROP' apps/auth-service/src/middleware → No matches found. (No DB access in middleware layer.)"
- "grep -n 'trusted_proxies|header_up.*X-Forwarded-For' infra/Caddyfile → L32 trusted_proxies static <Cloudflare CIDR list>; L33 client_ip_headers CF-Connecting-IP X-Forwarded-For; L134 (auth.vollos.ai) header_up X-Forwarded-For {client_ip}; L166 (vollos.ai /api/v1/*) header_up X-Forwarded-For {client_ip}. Caddy REPLACES the header with the resolved client_ip — so `.at(-1)` and `[0]` both resolve to the same single value in production; rateLimit.ts tail-read is safe."
- "grep -rn \"googleAuthRateLimit|refreshRateLimit\" packages/auth → packages/auth/src/rateLimit.ts:L25 googleAuthRateLimit (10/min); L37 refreshRateLimit (30/min); authRoutes.ts:L44 mounted on /auth/google; L127 mounted on /auth/refresh. /auth/logout at L168 has NO inline limiter → outer T-021 limit is the only quota (acceptable per defence-in-depth reasoning)."
- "cd apps/auth-service && pnpm test → Test Files 1 passed (1), Tests 15 passed (15), Duration 223ms. Confirmed independently."
- "cd apps/auth-service && pnpm typecheck → tsc --noEmit exit 0, no errors."
- "pnpm audit --audit-level moderate → 2 moderate findings in esbuild ≤0.24.2 (transitive via drizzle-kit). Not introduced by this MR — matches output.md claim. Dev-only chain."

## scope_compliance

files_changed_vs_owned: "match — all 5 production files (rateLimit.ts/test.ts/index.ts/package.json/vitest.config.ts) are inside apps/auth-service/ as declared in task.md Owned Files. pnpm-lock.yaml change is an implicit lockfile update required by the two new deps (hono-rate-limiter, vitest). packages/auth/ was NOT touched — honored task.md owned_files constraint. JWT logic in packages/auth/src/jwt.ts untouched (honored Forbidden rule 1). No Redis dep added (honored Forbidden rule 3). No docker-compose / Caddyfile changes."

## security_findings

[]

## scope_compliance_notes

- No CRITICAL or HIGH findings across Application / Auth / Email / Infra / Supply Chain / US Privacy layers.
- output.md self_review block is present with file:line evidence for all 5 required fields (input_validated/null_handled/errors_caught/race_condition_safe/security_checked) — meets Auditor mandate L91/L242 of SKILL.md. Not a finding.

## informational_observations

These are NOT findings — just pre-deploy context for Lead + future backlog. Not blocking.

- **INFO-01 (low):** `apps/auth-service/src/middleware/rateLimit.ts:L11-L15` code comment says "Caddy appends the real client IP at the END" but `infra/Caddyfile:L134 header_up X-Forwarded-For {client_ip}` REPLACES the header (does not append with `+X-Forwarded-For`). Result is identical in production (header contains exactly one value) so behavior is correct, but comment is slightly misleading to future readers. Cosmetic.
- **INFO-02 (low):** Memory store is per-process — if auth-service is scaled horizontally later, each replica keeps its own counter → effective limit becomes N × limit. Task.md explicitly says "Memory store OK for now (Redis upgrade = T-022+)". Already logged in output.md and task notes. Backlog, not a finding.
- **INFO-03 (medium-interest, NOT a finding for T-021):** `packages/auth/src/rateLimit.ts:L16` uses `split(',')[0]` (FIRST entry = client-controlled in multi-hop setups), while `apps/api/src/middleware/rateLimit.ts:L16` and `apps/auth-service/src/middleware/rateLimit.ts:L51` use `.at(-1)` (LAST entry = Caddy-written). The inconsistency is harmless in the current Caddy config (header is single-value replace), but if Caddy config ever changes to append instead of replace, the packages/auth limiter would become spoofable while the new auth-service limiter would not. Worth tracking as backlog — OUT OF SCOPE for T-021 (packages/auth was not in owned_files). Not blocking deploy.
- **INFO-04 (low):** `/auth/google` endpoint in @vollos/auth still carries only the 10/min inline limiter — T-021 wrapped `/auth/google/callback` (future OAuth server-flow landing) but NOT `/auth/google` itself. Task.md scope matches this (callback was listed, not /auth/google). Not a gap.

## application_layer_review

- **SQL injection / Mass assignment / BOPLA:** N/A — middleware does not touch DB or user input body. Only reads `x-forwarded-for` header.
- **XSS / SSTI / Command injection:** N/A — middleware writes no HTML, no template rendering, no shell exec. grep confirmed 0 matches for innerHTML / eval / exec / child_process in apps/auth-service/src.
- **CORS:** N/A — CORS is owned by @vollos/auth (createAuthCors), wired at `apps/auth-service/src/index.ts:L78`. T-021 runs AFTER CORS (L95-L101 is after L78) — correct ordering per conventions.
- **CSRF:** N/A — rate limit is not a CSRF control; cookie SameSite is owned by @vollos/auth/createAuthRoutes (`secureCookie: NODE_ENV === 'production'` at index.ts:L110).
- **Rate Limiting (API4:2023):** PASS. Five independent limiters with per-IP keying + per-bucket namespace separation (`${bucket}:${trustedIp}` — rateLimit.ts:L84). draft-6 standardHeaders emit `RateLimit-Limit/Remaining/Policy/Reset` + `Retry-After` on 429. Body shape `{ error: 'Too many requests', retryAfter: <seconds> }` matches packages/auth for client-side consistency. Tests (rateLimit.test.ts L149-L170, L193-L210) prove 429 + Retry-After on exceed, per-IP isolation, and no Retry-After on 200.
- **Input validation:** PASS. Only user-controllable input is `x-forwarded-for` header string. getTrustedIp (rateLimit.ts:L48-L53) validates tail against `IP_REGEX` (L35 — IPv4 4-octet or IPv6 hex:colon 2-39 chars); non-matching → `'unknown'` (fail-closed — all bad/missing headers share one bucket).
- **Security headers / Error exposure:** N/A for this middleware (owned by @vollos/auth + Caddy `security_headers` snippet, Caddyfile:L155). No stack traces emitted.
- **Audit log:** NOT APPLICABLE to rate-limit middleware (auth-service audit_logs would be added at route handler level in a future task). No regression introduced.

## auth_layer_review

- **JWT / Google verify / httpOnly cookie:** Out of scope — T-021 does NOT touch JWT logic or cookie options (task.md Forbidden rule 1 respected). Verified via `git show --stat d9714e5` — only rateLimit.ts, rateLimit.test.ts, index.ts (non-JWT lines), package.json, pnpm-lock.yaml, vitest.config.ts were modified.
- **Credential stuffing prevention (API2:2023):** IMPROVED. Before T-021, auth-service had inline per-minute limiters on /auth/google (10/min) and /auth/refresh (30/min) only — /auth/logout, /me, /onboarding, /auth/google/callback had no quota. T-021 closes those gaps with 5-minute bucket quotas. /auth/refresh now has both per-minute (inline, 30) + per-5-min (outer, 30) = tighter gate wins → strict effective limit. Defence-in-depth correctly achieved.
- **HMAC timing safe:** N/A — middleware uses no HMAC.

## infrastructure_layer_review

- **Docker / Postgres exposure / TLS:** N/A — no docker-compose or Caddyfile changes in this MR.
- **Proxy trust:** VERIFIED. `infra/Caddyfile:L32-L34` declares Cloudflare CIDR blocks as `trusted_proxies` with `client_ip_headers CF-Connecting-IP X-Forwarded-For` → Caddy resolves end-user IP correctly. `Caddyfile:L134` and `L166` `header_up X-Forwarded-For {client_ip}` REPLACES the header with the resolved client IP before reverse-proxying to auth-service. Read from tail vs head is functionally equivalent because only one value exists post-Caddy.

## supply_chain_review

- **New deps:** `hono-rate-limiter@^0.5.3` (runtime) + `vitest@^4.1.1` (dev). Both already used elsewhere in the monorepo (apps/api + packages/auth + packages/crypto) — no new vendor surface area.
- **pnpm audit:** 2 moderate in esbuild ≤0.24.2 via drizzle-kit → @esbuild-kit/esm-loader (GHSA-67mh-4wv8-2f99). Dev-only chain. Pre-existing — NOT introduced by T-021. Matches output.md dependency_audit claim.
- **Dockerfile pinning:** N/A — no Dockerfile changes.

## us_privacy_compliance

unsubscribe_mechanism: "N/A — auth-service does not send marketing email; CAN-SPAM not triggered by this MR"
physical_address_in_email: "N/A — same reason"
audit_log: "N/A for middleware — no PII logging added/removed by this MR"
data_minimization: "ok — test IPs are RFC 5737 TEST-NET-1 (192.0.2.0/24) so no real IP PII lands in source / test fixtures / vitest snapshots. Verified rateLimit.test.ts:L26-L36. Production middleware stores only the IP string in in-process memory (hono-rate-limiter default store) with no persistence — CCPA data minimization honored."

## skipped_sections

[]

## conditional_conditions

[]

## self_review_audit

- output.md includes self_review block with all 5 required fields — input_validated, null_handled, errors_caught, race_condition_safe, security_checked (output.md:L72-L87).
- Each field has `result: true` + evidence with file:line reference to rateLimit.ts or rateLimit.test.ts.
- No `result: false` in any field — clean.
- Independently verified claims:
  - "getTrustedIp runs value through IP_REGEX" → rateLimit.ts:L52 `return IP_REGEX.test(candidate) ? candidate : 'unknown'` ✓
  - "missing header returns 'unknown'" → rateLimit.ts:L50 `if (!forwarded) return 'unknown'` ✓
  - "bucket prefix prevents cross-bucket contamination" → rateLimit.ts:L84 `keyGenerator: (c) => \`${opts.bucket}:${getTrustedIp(c)}\`` ✓
  - "tests use RFC 5737 only" → rateLimit.test.ts:L27-L36 all constants in 192.0.2.x range ✓

## checks_performed

[A, B, C, D, E, F]

## rationale_plain_thai

**สรุปสั้นๆ สำหรับเจ้านาย:**

งาน T-021 เพิ่มระบบ "จำกัดจำนวนครั้งยิง API" ของ auth-service 5 ประตู (refresh, callback, logout, me, onboarding) — ไม่มีช่องโหว่ร้ายแรง ไม่มี secret หลุด ไม่มี placeholder ค้าง test ผ่านครบ 15 ข้อ typecheck ผ่าน audit ไม่พบ CRITICAL หรือ HIGH — ให้ผ่าน (GO)

**เปรียบเทียบ:** เหมือนเพิ่มยามที่หน้าประตู 5 ประตูของร้าน — ใครมายิงเกิน 20 ครั้งใน 5 นาทียามจะปิดประตูแล้วแปะป้ายว่า "กลับมาใหม่อีก X วินาที" (Retry-After) ยามดู IP จากปลายแถวของ header (X-Forwarded-For) ซึ่ง Caddy ที่เราตั้งไว้เขียนทับให้เสมอ → ปลอมไม่ได้

**สิ่งที่ตรวจแล้วปลอดภัย:**
1. Logic ของ middleware ถูกต้อง — TTL 5 นาที, แยก bucket ต่อประตู, แยก IP
2. ปลอม IP ไม่ได้ (Caddy เขียน X-Forwarded-For ทับทุกครั้ง — Caddyfile L134/L166)
3. memory ไม่บวมแบบ unbounded (hono-rate-limiter ลบ entry เก่าหลัง window หมด)
4. ตัวเลข limit สมเหตุสมผล (30/60/20/20/20 ต่อ 5 นาที — ไม่แน่นเกินให้คนจริงใช้ได้ ไม่หลวมเกินให้ bot ยิงได้สะดวก)
5. test coverage 15 เคส (header parsing 4, under-limit 2, exceed+body+isolation 4, wiring per-limiter 5)
6. TypeScript เข้มงวด ไม่มี any, ไม่มี console.log ที่อาจหลุด IP
7. ไม่ชน กับ rate limit เดิมใน packages/auth — ที่ซ้อนกันคือ /auth/refresh (เดิม 30/นาที + ใหม่ 30/5นาที) → ตัวเข้มกว่าชนะ = ปลอดภัยกว่าเดิม (defence-in-depth)
8. ไม่มี secret ใน code / test / commit / diff ใช้ IP range เอกสาร RFC 5737 (192.0.2.x) เท่านั้น
9. scope ตรงตามที่สั่ง — ไม่แตะ packages/auth (ตามกฎ), ไม่แตะ JWT logic (ตาม Forbidden rule 1), ไม่เพิ่ม Redis (ตาม Forbidden rule 3)

**สิ่งที่เป็นข้อสังเกต (ไม่ block deploy):**
- comment ในโค้ดพูดว่า Caddy "append" ที่ท้าย แต่จริงๆ Caddy "replace" ทั้ง header — ผลลัพธ์เหมือนกันในการทำงานจริง แค่คอมเมนต์เขียนไม่แม่น (ไม่ต้องแก้ตอนนี้)
- ถ้าขยายเป็นหลาย container ในอนาคต memory store จะไม่แชร์กัน → ต้องเปลี่ยนเป็น Redis (ทีมบันทึกไว้ใน backlog แล้ว T-022+)
- packages/auth ใช้ split(',')[0] อ่านหัวแถวของ X-Forwarded-For (ไม่ใช่ท้าย) — ต่างจากโค้ดใหม่ใน T-021 ตอนนี้ไม่เป็นปัญหาเพราะ Caddy replace ทั้ง header แต่ควรทำให้สอดคล้องกันในอนาคต (นอก scope T-021)

**คำตัดสิน: PASS — commit_gate = GO — deploy_readiness = ready**

T-022 (deploy ไป VPS) เดินหน้าต่อได้เลย

## completion_signal

task_id=T-021 verdict=pass findings=0 path=_workspace/T-021/review-auditor.md
