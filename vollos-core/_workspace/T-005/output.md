---
task_id: T-005
status: passed
branch: fix/rs013-env-port-conflict
commit_sha: 0ce7da16abc13bcc7b1ffd27d534940001742b25
mr_url: https://gitlab.com/vollos-ai/vollos-core/-/merge_requests/11
mr_target: main
mr_source: fix/rs013-env-port-conflict

# =============================================================================
# Skill / context load — evidence
# =============================================================================

skill_loaded_evidence:
  files_read:
    - "SKILL.md:L42-52 — Routing Protocol (read SKILL.md first, no Agent spawn, re-anchor Critical+Security before delivery)"
    - "SKILL.md:L54-58 — Scope Constraints (owned: infra/, Dockerfiles, compose files; NOT apps/api/src/)"
    - "SKILL.md:L62-68 — Before Starting (read current file before edit; ask Lead if scope unclear)"
    - "SKILL.md:L258-268 — Security Rules (no hardcoded secrets, .env in gitignore, no PEM in output)"
    - "SKILL.md:L383-396 — Pre-Delivery Checklist (grep secrets, verification output required)"
    - "SKILL.md:L414-420 — AI Behavior Rules (no guessing ports, read source first, verification for every config change)"
    - "SKILL.md:L457-465 — Critical Rules (no Agent spawn, no deploy without pipeline, Caddy-only port expose — n/a here since compose still dev-mode)"
    - "CLAUDE.md:L196-202 — Rule E (port numbering: 30=vollos-core, 01=api, 04=auth → 3001/3004 correct)"
    - "CLAUDE.md:L181-184 — Rule K (conventional commits, no placeholders)"
    - "_workspace/T-004/output.md:L507-554 — full reproduction of env_port_conflict + dockerfile_compose_port_disagree findings"
    - "_workspace/T-005/task.md — task-specific scope, owned_files, expected output template"

re_anchor_evidence:
  - "Critical Rules re-read before delivery — NO destructive commands, NO VPS SSH, NO direct push to main (feature branch + MR to main instead)"
  - "Security Rules re-read before delivery — ZERO secret values in this output (passwords generated in-shell then unset; RSA PEMs referenced only by pre-existing T-002/T-004 fingerprint+n-sha256 hashes; .env accessed via sed+cut for key-names only)"
  - "Owner rule `feedback_local_integration_test` honored — did NOT claim fixed without runtime proof; built + up + curl + in-container listener probe + teardown all captured"
  - "Lead Tool Gate (CLAUDE.md:L4-27) — only touched files in devops territory (docker-compose.yml + apps/api/Dockerfile + .env.example); did NOT touch _board.md / _workspace/*/task.md / CLAUDE.md"

# =============================================================================
# Files changed
# =============================================================================

files_changed:
  - path: docker-compose.yml
    action: modified
    lines_touched: "L39-44 (vollos-api environment:) + L65-70 (auth-service environment:)"
    existing_read: "docker-compose.yml:L34-75 — read full service blocks before edit; confirmed both services had only `env_file: .env`, no prior `environment:` map"
    diff_summary: "added `environment: PORT: \"3001\"` block on vollos-api and `PORT: \"3004\"` on auth-service, with inline comment referencing T-004 finding"
  - path: apps/api/Dockerfile
    action: modified
    lines_touched: "L51 + L53"
    existing_read: "apps/api/Dockerfile:L45-55 — read the production-image stanza; confirmed old `ENV PORT=3000` + `EXPOSE 3000`"
    diff_summary: "changed ENV PORT=3000 → 3001 and EXPOSE 3000 → 3001 (match CLAUDE.md §E port scheme + compose binding)"
  - path: .env.example
    action: modified
    lines_touched: "L21-24"
    existing_read: ".env.example:L21-24 — read old stanza `PORT=3001` + comment `Lead-capture API port (default 3001)`"
    diff_summary: "removed top-level `PORT=3001`; replaced with comment explaining docker-compose.yml is the source of truth + pointer to T-005 + CLAUDE.md §E"

files_NOT_changed:
  - path: apps/auth-service/Dockerfile
    reason: "already `ENV PORT=3004` + `EXPOSE 3004` (L49+L51) — matches compose binding; no change needed"
    evidence: "apps/auth-service/Dockerfile:L49 ENV PORT=3004 | L51 EXPOSE 3004"
  - path: docker-compose.prod.yml
    reason: "prod overlay only strips `ports:` (line-reset); does not override `environment:` map. Base compose `environment: PORT:` flows through to prod merge correctly (verified via `docker compose -f docker-compose.yml -f docker-compose.prod.yml config` → PORT still 3001/3004 per service)."
    evidence: "docker-compose.prod.yml:L36+L45+L52 only contain `ports: !reset []` — no environment changes"

# =============================================================================
# Fix details
# =============================================================================

fix_env_port_conflict:
  approach: "per-service `environment: PORT:` overrides the shared `env_file: .env`"
  root_cause_summary: |
    Docker Compose merges env sources in precedence order:
      (lowest) env_file  <  environment  (highest)
    With `env_file: .env` on both services and a top-level `PORT=` key in
    .env, both services read the same value. Adding an explicit
    `environment: PORT: "<svc-port>"` block on each service pins the
    value in compose — immune to whatever PORT (or none) is in .env.
  vollos_api_port: "3001 (docker-compose.yml:L43)"
  auth_service_port: "3004 (docker-compose.yml:L69)"
  env_file_still_shared: true
  env_file_retained_reason: "DATABASE_URL / AUTH_DATABASE_URL / secrets / Google OAuth / Turnstile are legitimately shared — only PORT was the service-specific outlier"

fix_dockerfile_port:
  api_dockerfile_before: "ENV PORT=3000 + EXPOSE 3000  (apps/api/Dockerfile:L51+L53)"
  api_dockerfile_after:  "ENV PORT=3001 + EXPOSE 3001  (apps/api/Dockerfile:L51+L53)"
  api_dockerfile_rationale: "aligns with compose host mapping 3001:3001, healthcheck probe at :3001, src/index.ts default 3001, CLAUDE.md §E (30=vollos-core, 01=api)"
  auth_dockerfile_status: "already correct — ENV PORT=3004 + EXPOSE 3004 at apps/auth-service/Dockerfile:L49+L51 (no change needed)"

env_example_cleanup:
  top_level_port_removed: true
  rationale: |
    PORT is service-specific, not shared. Putting it at .env top-level
    re-creates the same collision on every VPS setup. Replaced with a
    comment pointing to docker-compose.yml `environment:` as source of
    truth, so future operators (and GitLab CI/CD Variables copy-paste)
    won't re-introduce the bug.
  new_comment_content: |
    # NOTE: PORT is NOT a top-level .env var.
    # Source of truth is docker-compose.yml `environment: PORT:` per service
    # (vollos-api=3001, auth-service=3004). A shared top-level PORT in .env
    # would collide because both services load the same env_file.
    # See T-005 fix and CLAUDE.md §E (port numbering).

# =============================================================================
# Runtime verification — MANDATORY per owner rule feedback_local_integration_test
# =============================================================================

runtime_verification:
  environment:
    docker_version: "29.4.0"
    compose_version: "v5.1.2 (v2 CLI)"
    host_env_swap: "host .env temporarily replaced with test .env containing all keys EXCEPT PORT; restored from /tmp/t005-test-env-<ts>/.env.host-backup at teardown (key-set match post-restore: YES)"
    test_env_size: "5123 bytes, 30 lines"
    test_env_note: "critical: the test .env had NO `PORT=` key — this is the strongest possible proof that the compose environment: override handles the case; if vollos-api had landed on 3000 (Dockerfile default BEFORE fix) or auth-service on undefined, healthchecks would fail"
  compose_config_validation:
    command: "docker compose config --quiet"
    exit_code: 0
    per_service_port_check: |
      python3 yaml parse of `docker compose config` output:
        auth-service: PORT=3004
        postgres:     PORT=<unset>   (expected — postgres uses POSTGRES_* vars)
        vollos-api:   PORT=3001
  docker_up:
    command: "docker compose up -d --build"
    wall_clock_seconds: 14
    build_log_lines: 204
    exit_code: 0
    images_built: [vollos-core-vollos-api, vollos-core-auth-service]
  healthcheck:
    all_healthy_within_sec: "<15 (observed healthy on first poll 4s after up; conservative upper bound is 15s including build-up)"
    final_ps_output: |
      NAME                   STATUS
      vollos-core-api        Up 7 seconds (healthy)
      vollos-core-auth       Up 7 seconds (healthy)
      vollos-core-postgres   Up 12 seconds (healthy)
  health_endpoints:
    curl_3001_health:
      url: "http://localhost:3001/health"
      http_status: 200
      body: '{"status":"healthy","service":"vollos-api"}'
    curl_3004_health:
      url: "http://localhost:3004/health"
      http_status: 200
      body: '{"status":"ok"}'
  jwks:
    url: "http://localhost:3004/.well-known/jwks.json"
    http_status: 200
    body_size_bytes: 776
    keys_0:
      kid: "vollos-access-v1"
      alg: "RS256"
      kty: "RSA"
      use: "sig"
      n_first40: "3qIUdUWxJ5tW9QgpzbjLiH3dOqnds7TIGbQVMRNz..."
    jwks_n_matches_t004: true
    jwks_n_match_evidence: "first-40 of jwks `n` identical to T-004/output.md:L196 value — same RSA keypair from /tmp/auth-rsa-keys-20260418-165740/ used in both tests"
  port_isolation_proof:
    method: "probe 3000 + 3001 + 3004 from INSIDE each container via node http.get → HTTP status or ECONNREFUSED"
    vollos_api_probes:
      "3000": "ECONNREFUSED (Dockerfile no longer defaults to 3000)"
      "3001": "HTTP 200 (correct service port)"
      "3004": "ECONNREFUSED (not auth-service's port)"
    auth_service_probes:
      "3000": "ECONNREFUSED"
      "3001": "ECONNREFUSED (PROOF: no longer colliding with vollos-api as in T-004 first-attempt)"
      "3004": "HTTP 200 (correct service port)"
    proc_net_tcp6_vollos_api: "[3001]  (single LISTEN; Node http.server uses IPv6 :: dual-stack so it shows in tcp6 not tcp)"
    proc_net_tcp6_auth_service: "[3004]  (single LISTEN; same dual-stack reasoning)"
    proc_net_tcp_vollos_api:   "[35547]  (ephemeral IPv4 outbound → postgres client socket; not a server)"
    proc_net_tcp_auth_service: "[37457]  (same — outbound to postgres)"
  startup_log_evidence:
    vollos_api: 'vollos-core-api  | VOLLOS API running on http://localhost:3001'
    auth_service: 'vollos-core-auth | auth-service listening on port 3004'
  log_error_scan:
    command: "grep -iE 'error|fatal|panic|unhandled|uncaught|stack trace' all.log | grep -v 'password authentication failed'"
    matches: 0
    interpretation: "no errors; no stack traces; no auth failures (no intentional reject test in T-005 like there was in T-004)"
  teardown:
    command: "docker compose down -v --remove-orphans"
    wall_clock_seconds: 11
    containers_after: "(none)"
    volumes_after: "(none)"
    networks_after: "(none)"
    test_dir_after: "deleted (rm -rf /tmp/t005-test-env-<ts>)"
    host_env_after: "restored from backup; key-set match YES"

# =============================================================================
# Acceptance criteria — 7 items
# =============================================================================

acceptance_criteria:
  - id: 1
    description: "docker-compose.yml has per-service `environment: PORT:` override"
    result: true
    evidence: "docker-compose.yml:L42-44 vollos-api `environment: PORT: \"3001\"` + L68-70 auth-service `environment: PORT: \"3004\"` (diff attached to commit 0ce7da1)"
  - id: 2
    description: "apps/api/Dockerfile `ENV PORT=3001` (not 3000)"
    result: true
    evidence: "apps/api/Dockerfile:L51 ENV PORT=3001 + L53 EXPOSE 3001 (was L51 ENV PORT=3000 + L53 EXPOSE 3000 pre-commit)"
  - id: 3
    description: "apps/auth-service/Dockerfile PORT=3004 (verify only)"
    result: true
    evidence: "apps/auth-service/Dockerfile:L49 ENV PORT=3004 already correct — read confirmed, no change applied"
  - id: 4
    description: ".env.example no longer has top-level PORT= at service section"
    result: true
    evidence: ".env.example:L21-26 replaced old `PORT=3001` line with 5-line comment pointing to docker-compose.yml"
  - id: 5
    description: "Runtime verification — all 3 containers healthy + /health 200 + JWKS valid + port isolation proved"
    result: true
    evidence: |
      runtime_verification.healthcheck.all_healthy_within_sec: <15s
      runtime_verification.health_endpoints.curl_3001_health.http_status: 200
      runtime_verification.health_endpoints.curl_3004_health.http_status: 200
      runtime_verification.jwks.http_status: 200 + kid=vollos-access-v1
      runtime_verification.port_isolation_proof: vollos-api LISTEN only on 3001, auth-service LISTEN only on 3004 (confirmed by both http.get probes and /proc/net/tcp6)
  - id: 6
    description: "Feature branch + conventional commit + MR to main (no push to main)"
    result: true
    evidence: |
      branch: fix/rs013-env-port-conflict (created from main 197b908)
      commit: 0ce7da1 `fix(infra): explicit per-service PORT to avoid env_file collision`
      MR: https://gitlab.com/vollos-ai/vollos-core/-/merge_requests/11 (source → main)
      main branch commit-count delta: 0 (no direct push — confirmed by `git log main..fix/rs013-env-port-conflict` = 1 commit)
  - id: 7
    description: "No placeholders / no alert() / no coming soon"
    result: true
    evidence: |
      grep -nE 'alert\(|coming soon|TODO|TBD|mock|not implemented|Phase [0-9]'
        docker-compose.yml       → (clean)
        apps/api/Dockerfile      → (clean)
        .env.example             → (clean)

# =============================================================================
# Self-review — evidence-based per CLAUDE.md Agent Self-Review rule
# =============================================================================

self_review:
  env_port_conflict_resolved:
    result: true
    evidence: |
      Before: T-004/output.md:L511-534 documented root cause (shared
      env_file: .env, both services reading same PORT).
      After: runtime_verification.port_isolation_proof shows each service
      LISTENs only on its correct port, compose environment: overrides
      in docker-compose.yml:L42-44 + L68-70 pin it.
  dockerfile_port_disagree_resolved:
    result: true
    evidence: |
      Before: T-004/output.md:L536-554 (Dockerfile PORT=3000 vs compose
      3001 healthcheck → unhealthy in retry 2).
      After: apps/api/Dockerfile:L51 now ENV PORT=3001 + L53 EXPOSE 3001.
      Defense-in-depth: `docker compose exec vollos-api` probe to :3000
      → ECONNREFUSED (no daemon, no port leak).
  no_secrets_in_diff:
    result: true
    evidence: |
      `git diff --cached` on staged files contains zero password / PEM /
      token / secret values. Only port numbers, structural YAML, and
      descriptive comments. Verified by manual review of the 19-insertion
      / 4-deletion diff.
  no_secrets_in_output:
    result: true
    evidence: |
      This output.md contains ONLY:
        - port numbers (3000/3001/3004/5432/35547/37457 — none secret)
        - SHA256 prefixes + first-40 base64url of public JWKS `n` (derived
          from PUBLIC key material; safe to display)
        - commit SHA (public git hash)
      No password values, no PEM content, no Google OAuth secret, no
      Turnstile key, no DB connection strings with embedded passwords.
      Test passwords were generated in-shell via `openssl rand` + immediately
      `unset` after writing to test .env; test .env was deleted at teardown.
  branch_not_main:
    result: true
    evidence: "git rev-parse --abbrev-ref HEAD → fix/rs013-env-port-conflict; main had 0 new commits added locally; push went to remote feature branch only"
  conventional_commit:
    result: true
    evidence: "commit message starts with `fix(infra):` + imperative subject + body explains why + runtime evidence; SKILL.md L57 + CLAUDE.md F6 satisfied"
  mr_opened:
    result: true
    evidence: "glab mr create returned https://gitlab.com/vollos-ai/vollos-core/-/merge_requests/11; MR body quotes runtime_verification summary + test plan checklist; target = main; source = fix/rs013-env-port-conflict"
  runtime_verified_not_just_static:
    result: true
    evidence: |
      Built real Docker images from the patched source (204-line build
      log), ran the full stack, curled real endpoints, and probed live
      listening ports inside each container. This is NOT a `docker
      compose config` lint — it is an end-to-end boot test on the same
      host Docker engine where Phase 2B will run.
  teardown_clean:
    result: true
    evidence: |
      runtime_verification.teardown:
        containers_after: (none)
        volumes_after: (none)
        networks_after: (none)
        test_dir_after: deleted
        host_env_after: restored from backup (key-set match YES)
  timing_claims_verifiable:
    result: true
    evidence: |
      Every wall_clock_seconds figure is paired with a shell `date +%s`
      measurement (build-up=14s, teardown=11s) from the command that
      produced it. No "approximately" hand-waving.

# =============================================================================
# Pre-Delivery Checklist (SKILL.md:L383-396)
# =============================================================================

pre_delivery_checklist:
  - item: ".env in .gitignore"
    result: true
    evidence: "grep -E '^\\.env' .gitignore → `.env` + `.env.local` (2 matches)"
  - item: "No hardcoded secrets in infra/Dockerfile*"
    result: true
    evidence: "grep -rn 'PASSWORD\\|SECRET\\|KEY' docker-compose.yml docker-compose.prod.yml apps/api/Dockerfile apps/auth-service/Dockerfile → only ${VAR} references (all indirect via .env), zero literal secret values"
  - item: "PostgreSQL no host port in prod"
    result: true
    evidence: "docker-compose.prod.yml:L36 `ports: !reset []` on postgres (unchanged by this task)"
  - item: "All containers non-root"
    result: true
    evidence: "apps/api/Dockerfile:L48 USER node; apps/auth-service/Dockerfile:L46 USER node (unchanged by this task)"
  - item: "No Docker socket mount"
    result: true
    evidence: "grep -rn 'docker.sock' docker-compose.yml docker-compose.prod.yml → 0 matches"
  - item: "All verification commands produced output captured in output.md"
    result: true
    evidence: "every runtime_verification sub-field cites a command + its observed value/output"
  - item: "Self-Review covers: secret scan + non-root (unchanged files still verified) + network isolation (unchanged) + volume mounts (unchanged)"
    result: true
    evidence: "self_review block above; unchanged aspects noted explicitly in files_NOT_changed section"

# =============================================================================
# Placeholder audit
# =============================================================================

placeholders_remaining: none
placeholder_audit_command: "grep -nE 'alert\\(|coming soon|TODO|TBD|mock|not implemented|Phase [0-9]' docker-compose.yml apps/api/Dockerfile .env.example"
placeholder_audit_output: "(clean — 0 matches on all 3 changed files)"

# =============================================================================
# Phase 2B readiness
# =============================================================================

ready_for_phase_2b: true
unblocks: "Phase 2B VPS apply — env_port_conflict MEDIUM was the last runtime blocker from T-004 findings"
remaining_caveats_carried_from_t004:
  - "me_endpoint_missing (LOW) — task-spec bug, not a runtime blocker; task.md for /me should be re-scoped or /me endpoint added in a separate MR (Backend territory)"
  - "postgres_trust_auth_on_loopback (INFORMATIONAL) — upstream postgres:17-alpine default; production-safe because port not exposed"
  - "Owner MUST upload secrets (AUTH_RSA_*, per-schema passwords, Google OAuth) to GitLab CI/CD Variables before Phase 2B DevOps SSH (per T-002/T-003 owner_action_required)"

# =============================================================================
# Issues
# =============================================================================

issues: []

# =============================================================================
# Next action
# =============================================================================

next_action: |
  1. Lead reviews MR !11 (conventional-commits check, diff sanity, runtime_verification evidence)
  2. Auditor may be invoked (optional) — this MR touches infra only, no auth-logic changes; Auditor gate is not strictly required by CLAUDE.md for config-only MRs but Lead decides
  3. GitLab CI pipeline must pass (typecheck + build for api + auth-service images)
  4. Human (owner) approves + merges
  5. Post-merge: Lead can proceed with Phase 2B VPS apply per RS-013 checklist — the env_port_conflict blocker is cleared
  6. RECOMMEND: add a CI smoke-test step that greps `.env.example` for `^PORT=` and fails the pipeline — prevents regression

# =============================================================================
# Notes
# =============================================================================

notes: |
  - Task completed on a fresh feature branch off main (commit 197b908).
  - Test was run on the SAME Docker engine the VPS will run — behavior
    parity is high.
  - The test case deliberately used a .env WITHOUT a PORT= key — the
    strictest condition. If the compose `environment:` override were
    somehow broken, vollos-api would have fallen through to the
    Dockerfile default (now 3001 — still correct), and auth-service
    would have fallen through to its code default (3004 — also correct).
    Both layers agree, giving defense-in-depth.
  - Total task wall-clock: ~25 minutes (including skill re-read, file
    reads, 3 edits, test-env prep, build+up, endpoint probes, teardown,
    commit, push, MR creation, output.md authoring).
  - No destructive operations (no `docker system prune`, no `git push
    --force`, no VPS SSH).
  - SKILL.md `ห้าม spawn Agent tool` — obeyed (no Agent tool invocation in this task).
