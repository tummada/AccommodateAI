task_id: T-012
status: completed
branch: fix/rs013-vollos-api-route
commit_sha: e33b9f193d74ba1222a516781c6e16f180665e45
mr_iid: 14
mr_url: https://gitlab.com/vollos-ai/vollos-core/-/merge_requests/14
pipeline_url: https://gitlab.com/vollos-ai/vollos-core/-/pipelines/2462478709
pipeline_status_at_handoff: success
mr_mergeable_status: can_be_merged

# ===========================================================================
# Skill compliance (routing + re-anchor evidence)
# ===========================================================================

skill_loaded_evidence:
  files_read:
    - "~/.claude/skills/vollos-devops/SKILL.md:L60-68 — 'Before Starting (บังคับทุก task) … อ่านไฟล์ปัจจุบันก่อนเสนอแก้ไข'"
    - "~/.claude/skills/vollos-devops/SKILL.md:L234-255 — Caddyfile Pattern + 'handle vs handle_path' note"
    - "~/.claude/skills/vollos-devops/SKILL.md:L383-395 — Pre-Delivery Checklist"

re_anchor_evidence:
  - "Critical Rules (SKILL.md:L457-464): read before delivery — confirmed no Agent spawn, no direct deploy, Caddy-only port binding unchanged"
  - "Security Rules (SKILL.md:L257-267): read before delivery — no hardcoded secrets introduced, no PostgreSQL port exposure change, .env untouched"

# ===========================================================================
# Files changed
# ===========================================================================

files_changed:
  - path: infra/Caddyfile
    action: modified
    existing_read: "infra/Caddyfile:L120-131 — original `vollos.ai { ... root */srv/landing; file_server; try_files ... }` (no /api/v1/* route — root cause of F-T011-1)"
    lines_touched: "L113-156 (vollos.ai block — restructured into handle blocks + updated header comment)"

# ===========================================================================
# Caddyfile change map (task template field)
# ===========================================================================

caddyfile_changes:
  vollos_ai_handle_api_v1_added_line: 138
  vollos_ai_catch_all_block_line: 147
  order_correct: true  # 138 < 147 — handle /api/v1/* evaluated BEFORE catch-all
  www_vollos_ai_block_present: true
  www_vollos_ai_handle_api_v1_added: false
  www_vollos_ai_reasoning: |
    www.vollos.ai block is a pure 301 redirect (infra/Caddyfile:L157-164
    `redir https://vollos.ai{uri} permanent`). Any /api/v1/* request to
    www.vollos.ai will be 301-redirected to https://vollos.ai/api/v1/*
    where the new `handle /api/v1/*` route picks it up. Adding a parallel
    reverse_proxy on www would be dead code because the redir fires first.
  reverse_proxy_target: "vollos-core-api:3001"
  reverse_proxy_network: "vollos-network (shared between caddy + vollos-api per docker-compose.yml:L51-57, L128-130)"
  header_policy: |
    X-Real-IP + X-Forwarded-For set to {client_ip}, which resolves to the
    real end-user IP because Cloudflare ranges are declared in global
    `trusted_proxies static ...` at infra/Caddyfile:L32 (T-008 work).
    Mirrors the auth.vollos.ai pattern at L102-110 for consistency.

# ===========================================================================
# Validation — all commands + outputs captured
# ===========================================================================

validation:
  caddy_validate:
    command: |
      TMP=$(mktemp -d)
      openssl req -x509 -newkey rsa:2048 -nodes \
        -keyout $TMP/cloudflare.key -out $TMP/cloudflare.pem \
        -days 1 -subj "/CN=stub"
      docker run --rm \
        -v $PWD/infra/Caddyfile:/etc/caddy/Caddyfile:ro \
        -v $TMP:/etc/caddy/certs:ro \
        caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile
    stub_cert_rationale: |
      Real Cloudflare Origin Cert files (infra/certs/cloudflare.pem +
      cloudflare.key) are gitignored and live only on the VPS. To make
      `caddy validate` pass provisioning (which opens cert files), a
      throwaway self-signed cert was generated in a tmpdir and mounted
      at /etc/caddy/certs. The stub is discarded after the check —
      never touches git, never deployed.
    output: |
      {"level":"info","msg":"using config from file","file":"/etc/caddy/Caddyfile"}
      {"level":"info","msg":"adapted config to JSON","adapter":"caddyfile"}
      {"level":"info","msg":"redirected default logger","from":"stderr","to":"/var/log/caddy/access.log"}
      Valid configuration
    exit_code: 0
    verdict: pass

  caddy_adapt_syntax_only:
    command: "docker run --rm -v $PWD/infra/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2-alpine caddy adapt --config /etc/caddy/Caddyfile --pretty"
    output_head: |
      {
        "admin": { "disabled": true },
        "logging": { ... format json ... },
        "apps": { "http": { "servers": { "srv0": { "listen": [":443"], "routes": [ ... ] } } } }
    verdict: pass (JSON adapted successfully — syntax valid even without cert files)

  compose_config_dev:
    command: "docker compose -f docker-compose.yml config --quiet"
    exit_code: 0
    verdict: pass

  compose_config_merged:
    command: "docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet"
    exit_code: 0
    verdict: pass

  placeholder_grep:
    command: "grep -nE 'alert\\(|coming soon|TODO|TBD|not implemented|Phase [0-9]' infra/Caddyfile"
    exit_code: 1
    matches: 0
    verdict: clean

  secret_audit:
    command: "grep -rnE 'PASSWORD|SECRET|KEY' infra/Caddyfile"
    matches: 0
    verdict: clean  # only comment refers to `cloudflare.key` as a file path — not a hardcoded secret value

# ===========================================================================
# What explicitly did NOT change
# ===========================================================================

untouched_confirmed:
  - item: "import security_headers"
    evidence: "infra/Caddyfile:L132 still present inside vollos.ai block (HSTS, CSP, X-Frame DENY, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, -Server)"
  - item: "trusted_proxies (Cloudflare ranges)"
    evidence: "infra/Caddyfile:L32 unchanged — global block"
  - item: "TLS cert path"
    evidence: "infra/Caddyfile:L128 `tls /etc/caddy/certs/cloudflare.pem /etc/caddy/certs/cloudflare.key` unchanged"
  - item: "www.vollos.ai 301 redirect"
    evidence: "infra/Caddyfile:L157-164 unchanged"
  - item: "auth.vollos.ai reverse_proxy"
    evidence: "infra/Caddyfile:L94-111 unchanged"
  - item: "docker-compose.yml + docker-compose.prod.yml"
    evidence: "git diff shows only infra/Caddyfile modified — compose files untouched"

# ===========================================================================
# Post-merge deploy runbook (plain Thai — for owner / next DevOps on VPS)
# ===========================================================================

post_merge_deploy_runbook: |
  ## คู่มือ deploy หลัง MR !14 merge เข้า main (สำหรับหัวหน้า / DevOps คนต่อไป)

  เวลาที่ใช้: ~2 นาที  |  ต้องทำตอน: หลังกด merge MR !14 แล้วเท่านั้น
  เครื่องมือ: terminal + SSH key ของ VPS

  ### ขั้น 1 — SSH เข้า VPS
  ```bash
  ssh -i ~/.ssh/vollos_deploy_v3 ipon@187.124.244.96
  ```

  ### ขั้น 2 — อัพเดท code จาก main
  ```bash
  cd ~/vollos-core
  git fetch origin main
  git log origin/main --oneline -3   # เช็คว่า commit ใหม่มา: e33b9f1 "fix(infra): reverse-proxy..."
  git pull origin main
  ```
  **คาดหวัง:** เห็น `infra/Caddyfile | X ++++----` ใน summary

  ### ขั้น 3 — Restart Caddy เท่านั้น (ไม่แตะ api/postgres/auth)
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps caddy
  ```
  `--no-deps` = ไม่ไป restart postgres / vollos-api / auth-service (ไม่จำเป็น + กัน downtime ของ API)

  **คาดหวัง output:**
  ```
  Container vollos-core-caddy  Recreate
  Container vollos-core-caddy  Recreated
  Container vollos-core-caddy  Starting
  Container vollos-core-caddy  Started
  ```

  ### ขั้น 4 — รอ Caddy healthcheck pass (~10-15 วินาที)
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.prod.yml ps caddy
  ```
  **ต้องเห็น:** `STATUS` column = `Up X seconds (healthy)` — ถ้ายังเป็น `(health: starting)` รออีก 10 วินาทีแล้วรันซ้ำ

  ### ขั้น 5 — Smoke test จากตัว VPS (เช็คว่า Caddy ภายในทำงาน)
  ```bash
  curl -fsS -o /tmp/csrf.json -w "HTTP %{http_code}\nCT %{content_type}\n" https://vollos.ai/api/v1/csrf
  cat /tmp/csrf.json | head -c 200; echo
  ```
  **ต้องเห็น:**
  - `HTTP 200` (หรือ 403 ถ้า API rate-limit — ยังเป็น JSON เหมือนกัน)
  - `CT application/json` — **ต้องไม่ใช่ text/html**
  - body เริ่มด้วย `{"token":"..."}` — **ต้องไม่ใช่ `<!DOCTYPE html>`**

  ### ขั้น 6 — Smoke test landing page ไม่พัง
  ```bash
  curl -sI https://vollos.ai/ | head -3
  ```
  **ต้องเห็น:** `HTTP/2 200` + `content-type: text/html` (landing HTML ยังเสิร์ฟปกติ)

  ### ขั้น 7 — Smoke test auth ไม่พัง (กัน collateral damage)
  ```bash
  curl -s https://auth.vollos.ai/health
  ```
  **ต้องเห็น:** `{"status":"ok"}`

  ### ขั้น 8 — แจ้งหัวหน้า
  บอกหัวหน้าว่า "Deploy T-012 เสร็จแล้วครับ — /api/v1/csrf ตอบ JSON แล้ว ปุ่ม Get Early Access พร้อมทดสอบ"

  ### ถ้าขั้นไหนพัง — Rollback
  ```bash
  cd ~/vollos-core
  git log --oneline -5                         # หา commit ก่อนหน้า (637df7e)
  git checkout 637df7e -- infra/Caddyfile      # rollback Caddyfile อย่างเดียว
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps caddy
  ```
  แล้วแจ้งหัวหน้าว่า rollback แล้ว พร้อม error message ที่เจอ (จาก `docker logs vollos-core-caddy --tail 50`)

  ### หมายเหตุสำคัญ
  - **ไม่ต้อง restart vollos-api/auth-service/postgres** — fix นี้แตะแค่ Caddy routing
  - **ไม่ต้องแก้ .env** — ไม่มี env vars ใหม่
  - **ไม่ต้อง migration** — ไม่แตะ DB schema
  - Cloudflare edge cache ของ `/api/v1/csrf` ควรเป็น bypass อยู่แล้ว (API endpoint) แต่ถ้า browser ฝั่ง user ยัง cache HTML เก่า → แนะนำ hard reload (Ctrl+Shift+R)

# ===========================================================================
# Self review (evidence-based per CLAUDE.md Agent Self-Review)
# ===========================================================================

self_review:
  ac_01_handle_api_v1_added:
    result: true
    evidence: "infra/Caddyfile:L138-143 `handle /api/v1/* { reverse_proxy vollos-core-api:3001 { header_up X-Real-IP {client_ip}; header_up X-Forwarded-For {client_ip} } }`"
  ac_02_order_correct:
    result: true
    evidence: "infra/Caddyfile:L138 (handle /api/v1/*) precedes L147 (catch-all `handle {`). 138 < 147. Caddy evaluates handle blocks in declaration order; API matches first, catch-all never swallows it."
  ac_03_existing_behavior_preserved:
    result: true
    evidence: |
      infra/Caddyfile:L125-155 vollos.ai block still includes:
        L128 tls /etc/caddy/certs/cloudflare.pem /etc/caddy/certs/cloudflare.key
        L130 import security_headers
        L131 encode gzip zstd
      Catch-all `handle {}` at L147-151 contains the original static logic
      verbatim (root * /srv/landing; file_server; try_files). Landing HTML
      rendering path unchanged.
  ac_04_caddy_validate_passes:
    result: true
    evidence: "validation.caddy_validate exit_code: 0 + 'Valid configuration' stdout (with stub cert shim for gitignored CF Origin Cert)"
  ac_05_compose_config_passes:
    result: true
    evidence: |
      validation.compose_config_dev exit_code: 0
      validation.compose_config_merged exit_code: 0
  ac_06_commit_on_correct_branch:
    result: true
    evidence: "git rev-parse --abbrev-ref HEAD → fix/rs013-vollos-api-route; git rev-parse HEAD → e33b9f193d74ba1222a516781c6e16f180665e45"
  ac_07_conventional_commit:
    result: true
    evidence: "commit subject `fix(infra): reverse-proxy /api/v1/* on vollos.ai for lead capture form` — matches `fix(scope): description` conventional format per CLAUDE.md F6"
  ac_08_mr_opened:
    result: true
    evidence: "GitLab API returned iid: 14, state: opened, target: main — https://gitlab.com/vollos-ai/vollos-core/-/merge_requests/14"
  ac_09_pipeline_green:
    result: true
    evidence: "Pipeline 2462478709 status: success. GitLab API merge_status: can_be_merged. Confirmed via `curl /api/v4/projects/81395879/merge_requests/14` at handoff time — https://gitlab.com/vollos-ai/vollos-core/-/pipelines/2462478709"
  ac_10_self_review_evidence_based:
    result: true
    evidence: "every AC field cites file:line (Caddyfile lines + git SHA + MR iid + API response fields) — no generic claims"
  ac_11_placeholder_grep_clean:
    result: true
    evidence: "validation.placeholder_grep exit_code: 1 (no match) against infra/Caddyfile"

  scope_bound_checks:
    - check: "only infra/Caddyfile changed"
      result: true
      evidence: "git show --stat e33b9f1 → `1 file changed, 29 insertions(+), 8 deletions(-)` — infra/Caddyfile only"
    - check: "no forbidden files touched"
      result: true
      evidence: "CLAUDE.md, _board.md, _workspace/*/task.md, apps/*/src/**, packages/*/src/** all absent from diff"
    - check: "no push to main"
      result: true
      evidence: "git push went to origin/fix/rs013-vollos-api-route (new branch); main HEAD unchanged at 637df7e"
    - check: "no SSH to VPS during this task"
      result: true
      evidence: "No ssh commands executed. Deploy step deferred to post-merge runbook above."
    - check: "no secrets displayed"
      result: true
      evidence: "Stub self-signed cert generated in tmpdir + discarded. No .env read. No real CF Origin Cert bytes touched. MR body + commit msg contain no secret values."

# ===========================================================================
# Placeholder / secret final audit
# ===========================================================================

placeholders_remaining: none — grep clean
placeholder_grep:
  command: "grep -nE 'alert\\(|coming soon|TODO|TBD|not implemented|Phase [0-9]' infra/Caddyfile"
  exit_code: 1
  scope: "infra/Caddyfile (only file changed in this task)"

secret_audit:
  env_values_displayed: false
  pem_bytes_displayed: false
  jwt_values_displayed: false
  stub_cert_rationale: "temporary self-signed cert mounted only into ephemeral `docker run --rm` for `caddy validate` — tmpdir removed after command returned, never committed, never pushed"

# ===========================================================================
# Risks / notes for Lead
# ===========================================================================

issues: []

notes: |
  - Only `infra/Caddyfile` is in the MR. No compose, no Dockerfile, no env change.
  - Deploy is `docker compose up -d --no-deps caddy` (restart Caddy only) — ~10 sec downtime for the edge, zero downtime for postgres/api/auth because they're not touched.
  - {client_ip} in the new reverse_proxy block works because T-008 already configured `trusted_proxies static <CF ranges>` globally (Caddyfile:L32). If that global line were ever removed, X-Real-IP / X-Forwarded-For would leak CF edge IPs instead of real user IPs — note for future refactor.
  - www.vollos.ai block intentionally NOT modified — it is a 301 redir, any /api/v1/* on www automatically bounces to apex and hits the new route. Adding a parallel reverse_proxy would be dead code.
  - This MR does NOT fix F-T011-2 (www.vollos.ai DNS missing) — separate owner action (add CF DNS A-record for www).
  - Pipeline is green (success) and MR is `can_be_merged` at handoff.

next_action: "Lead: (1) review MR !14 (pipeline already green, merge_status=can_be_merged); (2) spawn Auditor if code/security diff warrants it (this is a routing config change — low-risk, but up to Lead); (3) merge MR; (4) execute post_merge_deploy_runbook above (or spawn another DevOps task); (5) re-run T-011 Track 2 smoke test: `curl https://vollos.ai/api/v1/csrf` must return JSON not HTML."
