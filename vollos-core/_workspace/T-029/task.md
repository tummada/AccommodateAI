---
id: T-029
title: Recover CI/CD Variables from old group vollos-ai → copy to new personal project
assigned_to: vollos-devops
priority: high
status: in_progress
spawn_started_at: 2026-04-19T16:45+07:00
security_checkpoint: true
owned_files: []
dependencies: [T-028]
---

## Context

T-028 transfer vollos-core group→personal ทำให้ project-level Variables หายหมด (count=0)

สมมติฐาน: variables อาจอยู่ที่ **group level** `vollos-ai` (ที่โปรเจกต์ inherit มาตอนยังอยู่ group) — transfer ออกทำให้ไม่ inherit แล้ว แต่ของที่ group ยังอยู่

## Scope

### Phase A — Investigation (อ่านอย่างเดียว ห้าม mutate)

1. หา group ID ของ `vollos-ai`: `GET /groups/vollos-ai` → extract `id`
2. List group-level variables: `GET /groups/:group_id/variables`
   - ถ้าเจอ > 0 ตัว → proceed to Phase B
   - ถ้า 0 ตัว → report + stop (Variables ไม่ได้อยู่ที่ group)
3. Verify new project has 0 variables (confirm T-028 finding): `GET /projects/:new_id/variables`
4. หาที่อื่นที่อาจเก็บ secret: 
   - `GET /groups/vollos-ai/deploy_tokens` (ถ้ามี)
   - `GET /projects/:new_id/deploy_tokens`
   - `GET /projects/:old_id_if_any/hooks` (ถ้า API redirect)

### Phase B — Copy (ถ้า Phase A เจอ variables ที่ group)

5. สำหรับแต่ละ variable ที่ group:
   - อ่าน: `GET /groups/:group_id/variables/:key` → ได้ `{key, value, protected, masked, environment_scope, variable_type}`
   - เขียน: `POST /projects/:new_id/variables` ด้วย payload เดียวกัน
   - verify: `GET /projects/:new_id/variables/:key` → ตรงกัน (compare non-value fields only; ห้าม print value)
6. report จำนวน copied + any skipped (พร้อมเหตุผล)

### Phase C — Branch recovery check

7. List branches ที่ local มีแต่ remote ไม่มี:
   ```
   git branch -r | grep -v HEAD > /tmp/remote_branches.txt
   git branch | grep -v '^\*' > /tmp/local_branches.txt
   diff /tmp/local_branches.txt /tmp/remote_branches.txt
   ```
8. report list ของ local branches ที่ remote ไม่มีอีกต่อไป
   - **ห้าม push back อัตโนมัติ** — ให้ Lead/owner ตัดสินใจว่าจะเก็บอันไหน
   - Clean up temp files

## Secret Handling (บังคับ)

- `VOLLOS_CLI` token สำหรับ API — source via `set -a; source /home/ipon/workspace/vollos/.env; set +a`
- **ห้าม print token** ในทุกรูปแบบ
- **ห้าม print variable values** — แม้ใน comparison ให้ hash/mask
- ทำ comparison ด้วย masked checksum: `echo -n "$value" | sha256sum | cut -c1-8` ถ้าต้องเทียบ
- หลังเสร็จ: ลบ /tmp/*_branches.txt + `history -c`

## Acceptance Criteria

1. [ ] Phase A done — group variables count reported
2. [ ] Phase A done — new project variables count reported (confirm 0)
3. [ ] ถ้า group variables > 0 → Phase B done with copy count
4. [ ] ถ้า group variables = 0 → stop after Phase A + report where else to look
5. [ ] Phase C done — list branches local-only (no push)
6. [ ] ไม่มี secret value ใน log/output
7. [ ] Temp files cleaned

## Self-Review

output.md ต้องมี `self_review` + report รายละเอียด:
- `group_id`: (int)
- `group_variables_found`: key names list (no values)
- `group_variables_copied`: count + key names
- `new_project_variables_after`: count + key names
- `local_only_branches`: list (for Lead decision)
