---
task_id: T-063
status: completed
agent: vollos-devops
branch: feat/ci-smoke-test
commit_sha: 5168377e303b396ad18c647e7a4a0ccb09918db0
mr_url: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/17
mr_iid: 17
pipeline_url: https://gitlab.com/tummadajingjing/vollos-core/-/pipelines/2464534210
---

## Summary

เพิ่ม post-deploy smoke test ลงใน deploy stage ของ `.gitlab-ci.yml` — curl
`https://vollos.ai/api/v1/health` และ `https://auth.vollos.ai/health`
3 รอบ × 10 วินาที ต้อง 200 ทั้งคู่ ไม่งั้น pipeline fail

- Total diff: +13 / -1 (13 insertions, อยู่ใน budget ≤ 25 บรรทัด)
- ห้ามเปลี่ยน `when: manual` — รักษาไว้ตามโจทย์ (A-3 งาน)
- ห้ามแตะ build / test / secret vars — diff กระทบเฉพาะ `deploy` job

## Decision notes

- **เลือก inline ใน deploy job เดิม (ไม่แยก stage ใหม่)** เพราะ (1) diff เล็กสุด
  (2) smoke test share กับ SSH prerequisites (openssh-client image) ไม่ต้องสร้าง
  before_script ใหม่ — แค่เพิ่ม `curl` ใน `apk add` line เดียว (3) ถ้าแยก stage
  ต้อง duplicate `needs`/`only`/`environment` config — เสี่ยง drift
- **Retry 3×10s** ตาม task spec — แต่ละ attempt ต้อง both URLs = 200; ใช้
  `curl -sS -o /dev/null -w "%{http_code}"` + fallback `|| echo "000"` กัน curl
  crash (network unreachable) ทำให้ pipeline hang
- **`exit 0` on pass + `exit 1` on fail** — GitLab script step treat non-zero
  = job fail ตามต้องการ (AC #4)

## self_review

- ac_1_smoke_test_added_after_deploy:
    result: true
    evidence: ".gitlab-ci.yml:50-62 — ssh deploy command อยู่ L50; smoke block อยู่ L51-62 ภายใต้ `script:` เดียวกับ deploy job, ลำดับ after ssh"
- ac_2_curl_two_urls_check_200:
    result: true
    evidence: ".gitlab-ci.yml:54 (`curl ... https://vollos.ai/api/v1/health`) + L55 (`curl ... https://auth.vollos.ai/health`) + L56 (`if [ \"$api\" = \"200\" ] && [ \"$auth\" = \"200\" ]`)"
- ac_3_retry_3x_10s_both_200_per_attempt:
    result: true
    evidence: ".gitlab-ci.yml:53 (`for i in 1 2 3`) + L56 (both URLs must = 200 ใน same iteration) + L60 (`[ $i -lt 3 ] && sleep 10`)"
- ac_4_smoke_fail_causes_pipeline_fail:
    result: true
    evidence: ".gitlab-ci.yml:62 (`exit 1`) หลัง loop จบโดยไม่มี attempt ใด pass — GitLab treat non-zero exit = job fail"
- ac_5_when_manual_preserved:
    result: true
    evidence: ".gitlab-ci.yml:66 (`when: manual` ยังอยู่); `git diff` ไม่แตะบรรทัดนี้ (diff แสดง insertion ที่ L44 + L51-62 เท่านั้น)"
- branched_from_origin_main:
    result: true
    evidence: "git checkout -b feat/ci-smoke-test origin/main; git merge-base feat/ci-smoke-test origin/main = c4d2a76 (current main HEAD); git log --oneline -3 → 5168377 → c4d2a76 → ba7a549"
- mr_opened:
    result: true
    evidence: "MR !17 state=opened target=main source=feat/ci-smoke-test URL: https://gitlab.com/tummadajingjing/vollos-core/-/merge_requests/17"
- pipeline_test_green:
    result: true
    evidence: "Pipeline 2464534210: test job status=success (only `test` runs on MR event — `build` + `deploy` มี `only: - main` เป็น pre-existing config ไม่เกี่ยว T-063)"
- build_deploy_behavior_documented:
    result: true
    evidence: "Main pipeline 2464485562 (last main commit) แสดง test=success, build=success, deploy=manual — ยืนยันว่า build + deploy behavior คง identical หลัง merge; สมมติ A-1 diff กระทบแค่ deploy script content"
- no_secret_leak:
    result: true
    evidence: "MR description + commit message ไม่มี VPS_SSH_KEY/VPS_HOST/credentials; smoke test ใช้ public HTTPS URLs; `grep -i 'password\\|secret\\|token' .gitlab-ci.yml` = เจอแค่ชื่อตัวแปร `CI_REGISTRY_PASSWORD` (pre-existing, pointing ไป GitLab var) — ไม่มี value plaintext"
- conventional_commit:
    result: true
    evidence: "commit message: `feat(ci): add post-deploy smoke test for health endpoints` — ตรง pattern feat(scope): ..."

## placeholders_remaining

none — grep clean

```
$ grep -nE "TODO|TBD|placeholder|coming soon|FIXME|XXX|alert\(|not implemented|Phase [0-9]" .gitlab-ci.yml
(no output — 0 matches)
```

## files_changed

- path: .gitlab-ci.yml
  action: modified
  lines: "L44 (เพิ่ม curl ใน apk add), L51-62 (เพิ่ม smoke test block หลัง ssh deploy command)"
  diff_stat: "+13 -1"
  existing_read: ".gitlab-ci.yml:40-55 — deploy job ssh pattern, image alpine:3.19, before_script ssh-agent setup (อ่านก่อนแก้)"

## pipeline_status

- pipeline_id: 2464534210
- trigger: merge_request_event
- ref: refs/merge-requests/17/head
- sha: 5168377e
- status: success
- jobs:
  - test: success (stage=test) — pnpm typecheck + lint + test ผ่าน
  - build: not run on MR pipeline (pre-existing `only: - main` — no change in T-063)
  - deploy: not run on MR pipeline (same reason); on main = manual-pending (verified via pipeline 2464485562 for last main commit)

## constraints_respected

- ไม่ trigger deploy job จริง (MR pipeline ไม่รัน deploy เลยเพราะ `only: - main`; main pipeline จะมี deploy = manual-pending — ไม่ถูก trigger โดย MR นี้)
- ไม่แตะ build stage / test stage / docker compose / VPS config / secret vars
- ไม่ push ตรง main (push branch feat/ci-smoke-test + เปิด MR !17)
- ไม่ run `docker compose config` (ไม่เกี่ยวกับ task)
- ไม่ Read/cat .env (ใช้ `grep -E '^VOLLOS_CLI=' /home/ipon/workspace/vollos/.env | cut -d= -f2-` — echo เฉพาะ length ไม่ใช่ value)
- ไม่ echo token/secret value ใน output หรือ chat

## skill_loaded_evidence

- files_read:
  - "SKILL.md:L38 — 'ก่อนรัน command ที่อาจ resolve env vars/secrets ... หยุด. อ่าน memory feedback_secret_handling_protocol.md ก่อน'"
  - "SKILL.md:L64 — 'Owned areas: ตาม owned_files ใน task.md (ปกติคือ infra/, pnpm-workspace.yaml, root package.json, Dockerfiles, .gitlab-ci.yml)'"
  - "SKILL.md:L72 — 'อ่านไฟล์ปัจจุบันก่อนเสนอแก้ไข — ถ้า task ให้แก้ Dockerfile/compose/config ต้องอ่านไฟล์นั้นก่อน'"
  - "SKILL.md:L471 — 'ห้ามบอก เสร็จ โดยไม่แสดง verification output — ทุก config change ต้องมี command + output ใน output.md'"

## re_anchor_evidence

- "Critical Rules (SKILL.md:L464-471): อ่านก่อน deliver — ยืนยัน non-root / no port expose / no hardcode secret / MR workflow / verification output ครบ"
- "Security Rules (SKILL.md:L264-274): อ่านก่อน deliver — task นี้ไม่แตะ Docker/UFW/fail2ban/secret; เฉพาะ CI YAML — ไม่มี attack surface ใหม่"
- "Push-back Protocol (SKILL.md:L404-415): ไม่เจอ request ที่ต้อง push back — task spec ถูกต้องตาม best practice (retry logic + fail-fast)"

## blocker

null

## next_action

รอ Lead spot-check diff + output.md → spawn vollos-auditor ตรวจ CI config surface → ถ้า pass ให้ owner decide merge. หลัง merge → T-064 (Phase A-2: rollback + Telegram alert + local simulation test) ก่อน A-3 (flip `when: on_success`)

## issues

[]
