---
task_id: T-087
title: Copy 4 Gmail/Google OAuth secrets from vollos-core → vollos-acmd via GitLab API
agent: vollos-devops
spawn_started_at: 2026-04-29T08:55+07:00
mode: MODE_1
priority: high
estimated_time: 10 min
dependencies: []
parent_context: "acmd Lead handshake [2] (M3-001 Beta launch) — ต้องการ 4 ค่าใน acmd CI/CD Variables เพื่อให้ acmd ส่ง trial reminder emails ผ่าน noreply@vollos.ai (Gmail OAuth2 Nodemailer)"
---

## Goal

คัดลอก **4 GitLab CI/CD Variables** จาก source (`tummadajingjing/vollos-core`) ไปยัง target (`tummadajingjing/vollos-acmd`) โดย:
- ใช้ GitLab API เท่านั้น (ห้ามเปิด UI / ห้าม cat ค่าใน terminal)
- รักษา flag เหมือน source: **Masked + Protected = true** ทั้ง 4
- ห้าม value leak ใน stdout/stderr/output.md

## 4 Variables (source: vollos-core)

| Key | Source value flags | Target flags ที่ต้องตั้ง |
|-----|---------------------|--------------------------|
| `GOOGLE_CLIENT_ID` | masked=True, protected=True | masked=True, protected=True |
| `GOOGLE_CLIENT_SECRET` | masked=True, protected=True | masked=True, protected=True |
| `GOOGLE_REFRESH_TOKEN` | masked=True, protected=True | masked=True, protected=True |
| `GMAIL_USER` | masked=True, protected=True | masked=True, protected=True |

## Project IDs (verified 2026-04-29)

- **Source:** `tummadajingjing/vollos-core` → ID `81441960` (URL-encode: `tummadajingjing%2Fvollos-core`)
- **Target:** `tummadajingjing/vollos-acmd` → ID `81442964` (URL-encode: `tummadajingjing%2Fvollos-acmd`)

## Token

- **Token name:** `VOLLOS_CLI_v2`
- **File path:** `/home/ipon/workspace/vollos-ai/vollos-core/.env`
- **Source command:** `set -a; source /home/ipon/workspace/vollos-ai/vollos-core/.env; set +a`
- **Header to use:** `-H "PRIVATE-TOKEN: $VOLLOS_CLI_v2"`
- **Verified:** Token เข้าทั้ง 2 project ได้แล้ว (HTTP 200 — Lead verified 2026-04-29)

## Implementation Steps

### Step 1 — GET 4 values from source (vollos-core)

```bash
set -a; source /home/ipon/workspace/vollos-ai/vollos-core/.env; set +a
SRC_PROJECT="tummadajingjing%2Fvollos-core"

for KEY in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REFRESH_TOKEN GMAIL_USER; do
  curl -s -H "PRIVATE-TOKEN: $VOLLOS_CLI_v2" \
    "https://gitlab.com/api/v4/projects/$SRC_PROJECT/variables/$KEY" \
    > /tmp/T-087-src-$KEY.json
done
```

⚠️ Read `value` field via `python3 -c "import json; print(json.load(open('/tmp/T-087-src-KEY.json'))['value'])"` เก็บใน shell var **ห้าม echo ออก stdout**.

### Step 2 — POST 4 values to target (vollos-acmd)

ตรวจก่อนว่า target ยังไม่มี variable นั้น (ถ้ามีอยู่ก่อน → PUT update แทน POST):

```bash
TGT_PROJECT="tummadajingjing%2Fvollos-acmd"

for KEY in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REFRESH_TOKEN GMAIL_USER; do
  # Check if exists
  EXISTING=$(curl -s -o /dev/null -w "%{http_code}" -H "PRIVATE-TOKEN: $VOLLOS_CLI_v2" \
    "https://gitlab.com/api/v4/projects/$TGT_PROJECT/variables/$KEY")
  
  VALUE=$(python3 -c "import json; print(json.load(open('/tmp/T-087-src-$KEY.json'))['value'])")
  
  if [ "$EXISTING" = "200" ]; then
    # PUT update existing
    curl -s -o /dev/null -w "PUT $KEY → HTTP %{http_code}\n" \
      --request PUT -H "PRIVATE-TOKEN: $VOLLOS_CLI_v2" \
      "https://gitlab.com/api/v4/projects/$TGT_PROJECT/variables/$KEY" \
      --form "value=$VALUE" \
      --form "masked=true" \
      --form "protected=true" \
      --form "variable_type=env_var"
  else
    # POST new
    curl -s -o /dev/null -w "POST $KEY → HTTP %{http_code}\n" \
      --request POST -H "PRIVATE-TOKEN: $VOLLOS_CLI_v2" \
      "https://gitlab.com/api/v4/projects/$TGT_PROJECT/variables" \
      --form "key=$KEY" \
      --form "value=$VALUE" \
      --form "masked=true" \
      --form "protected=true" \
      --form "variable_type=env_var"
  fi
done
```

### Step 3 — Verify (sha256 fingerprint compare)

```bash
echo "=== source vs target sha256 fingerprint ==="
for KEY in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REFRESH_TOKEN GMAIL_USER; do
  SRC_SHA=$(python3 -c "import json; print(json.load(open('/tmp/T-087-src-$KEY.json'))['value'])" | sha256sum | cut -c1-8)
  TGT_VAL=$(curl -s -H "PRIVATE-TOKEN: $VOLLOS_CLI_v2" \
    "https://gitlab.com/api/v4/projects/$TGT_PROJECT/variables/$KEY" | python3 -c "import json,sys; print(json.load(sys.stdin)['value'])")
  TGT_SHA=$(printf '%s' "$TGT_VAL" | sha256sum | cut -c1-8)
  if [ "$SRC_SHA" = "$TGT_SHA" ]; then
    echo "$KEY: ✅ MATCH (sha256:$SRC_SHA)"
  else
    echo "$KEY: ❌ MISMATCH src=$SRC_SHA tgt=$TGT_SHA"
  fi
done
```

### Step 4 — Verify flags on target

```bash
curl -s -H "PRIVATE-TOKEN: $VOLLOS_CLI_v2" \
  "https://gitlab.com/api/v4/projects/$TGT_PROJECT/variables?per_page=100" | \
  python3 -c "
import json, sys
keys = ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN','GMAIL_USER']
vars = json.load(sys.stdin)
for v in vars:
    if v['key'] in keys:
        print(f\"{v['key']:25s} masked={v['masked']} protected={v['protected']} type={v['variable_type']}\")
"
```

ต้องได้ทั้ง 4 ตัว: `masked=True protected=True type=env_var`

### Step 5 — Cleanup (mandatory)

```bash
shred -u /tmp/T-087-src-*.json 2>/dev/null || rm -f /tmp/T-087-src-*.json
unset VALUE TGT_VAL SRC_SHA TGT_SHA EXISTING
history -c && history -w
```

## Acceptance Criteria

1. ✅ 4 variables existed at target with correct values (sha256 match all 4)
2. ✅ All 4 target variables: masked=True + protected=True + type=env_var
3. ✅ output.md ไม่มี plaintext value ของ secret (ห้ามมี GOCSPX-, 1//, ค่าจริงใดๆ)
4. ✅ /tmp/T-087-src-*.json deleted (verified)
5. ✅ bash history cleared post-task

## Forbidden Commands (Secret Handling MASTER protocol)

ห้ามรัน:
- `cat /tmp/T-087-src-*.json` หรือใดๆ ที่ดู raw value
- `echo $VALUE` / `printenv` / `env | grep`
- `docker compose config` (ไม่เกี่ยว task นี้แต่ห้ามใช้เด็ดขาด)
- `curl ... | tee` (อาจ leak)
- Display ค่า value ใน comment, log, output.md

## Output Format

ใน output.md ต้องมี:

```yaml
secret_handling_acknowledgment:
  read_forbid_list: true
  will_not_run_forbidden_commands: true
  will_redact_values_in_output: true
  will_cleanup_at_end: true
  understood_consequences_of_leak: true

results:
  source_project: "tummadajingjing/vollos-core (id 81441960)"
  target_project: "tummadajingjing/vollos-acmd (id 81442964)"
  variables_processed:
    - key: GOOGLE_CLIENT_ID
      action: POST or PUT
      sha256_first8: "xxxxxxxx"
      target_flags: "masked=True protected=True"
      verify_match: true
    - key: GOOGLE_CLIENT_SECRET
      action: ...
      sha256_first8: "xxxxxxxx"
      target_flags: "masked=True protected=True"
      verify_match: true
    - key: GOOGLE_REFRESH_TOKEN
      action: ...
      sha256_first8: "xxxxxxxx"
      target_flags: "masked=True protected=True"
      verify_match: true
    - key: GMAIL_USER
      action: ...
      sha256_first8: "xxxxxxxx"
      target_flags: "masked=True protected=True"
      verify_match: true
  
  cleanup:
    tmp_files_deleted: true
    bash_history_cleared: true

self_review:
  - field: "all_4_variables_copied"
    result: true/false
    evidence: "Step 4 output → 4/4 keys present with correct flags"
  - field: "sha256_match_all"
    result: true/false
    evidence: "Step 3 output → 4/4 ✅ MATCH"
  - field: "no_secret_leak_in_output"
    result: true/false
    evidence: "grep -E 'GOCSPX-|1//|noreply@' output.md → 0 matches (only fingerprints visible)"
  - field: "cleanup_complete"
    result: true/false
    evidence: "ls /tmp/T-087-src-*.json → no matches"
```

## Applicable Rules (CLAUDE.md citations)

- **CLAUDE.md global SECURITY** — ห้ามแสดง secrets ใน output, mask ทุกที่
- **feedback_secret_handling_protocol.md** — FORBID list + Cleanup protocol
- **Architecture Rule J1** — Secrets ใน GitLab CI/CD Variables (masked + protected)
- **Architecture Rule J3** — `.env.example` ครบ ไม่มี value จริง (ไม่เกี่ยว task นี้แต่เผื่อ)

## Domain Consultation

ไม่ต้องปรึกษา domain expert — task นี้เป็น pure infra/secret rotation operation
