---
id: T-019
title: Track 2 post-test DB verification — confirm 2 leads + unsubscribe + delete worked
assigned_to: vollos-devops
priority: medium
status: in_progress
spawn_started_at: 2026-04-18T22:44:46+07:00
security_checkpoint: true
domain_consultation: null
---

## Context

Owner tested Track 2 successfully:
1. **Google One Tap** (account `[email protected]`) → received auto-reply email → tested unsubscribe button
2. **Manual form** (account `[email protected]`) → received auto-reply → tested "ลบข้อมูล" (delete data button — likely CCPA right-to-delete)

Need to verify DB state matches observed behavior:
- Both leads actually inserted
- Unsubscribe field updated correctly after click
- Delete actually removed (or anonymized) record

## Scope — Read-only DB verification

### Query 1: Count leads by source
```
docker exec vollos-core-postgres psql -U auth_user -d vollos_prod -c \
  "SELECT source, unsubscribed_at IS NOT NULL AS unsubscribed, COUNT(*) FROM vollos.leads GROUP BY source, unsubscribed;"
```

### Query 2: Check test emails specifically (but redact in output)
```
docker exec vollos-core-postgres psql -U auth_user -d vollos_prod -c \
  "SELECT substring(email FROM 1 FOR 3) || '***' AS email_prefix,
          source,
          unsubscribed_at IS NOT NULL AS unsub,
          deleted_at IS NOT NULL AS deleted,
          created_at
   FROM vollos.leads
   WHERE email IN ('[email protected]', '[email protected]')
   ORDER BY created_at;"
```

Note: if schema doesn't have `deleted_at` column → delete may be hard-delete (row removed). In that case expect to see only unsubscribed record (no delete record).

### Query 3: Audit log entries (if audit_logs table exists)
```
docker exec vollos-core-postgres psql -U auth_user -d vollos_prod -c \
  "SELECT action, target_type, created_at
   FROM vollos.audit_logs
   WHERE created_at > NOW() - INTERVAL '2 hours'
   ORDER BY created_at DESC;"
```

### Query 4: Schema of leads + audit_logs (understand structure for interpretation)
```
docker exec vollos-core-postgres psql -U auth_user -d vollos_prod -c "\d vollos.leads"
docker exec vollos-core-postgres psql -U auth_user -d vollos_prod -c "\d vollos.audit_logs"
```

## Acceptance Criteria

1. **Query 1** — count shows leads exist (≥ 2 total, likely more if other activity)
2. **Query 2** — both test emails present OR delete worked (record missing)
3. **Query 3** — audit_logs show actions from test session (INSERT / UNSUBSCRIBE / DELETE)
4. **Query 4** — schema understood (columns for unsubscribe + delete state)
5. Interpret results: answer "did unsubscribe actually work" + "did delete actually work" in plain Thai
6. No PII displayed — emails redacted (first 3 chars + `***`), no names, no IP
7. No secret values displayed

## Expected Output

```yaml
task_id: T-019
status: passed | partial | failed

leads_table_state:
  total_count: N
  by_source:
    - google_one_tap: X (unsubscribed: Y)
    - manual_form: Z (unsubscribed: W)

test_email_verification:
  tummadajingjing_at_gmail:
    exists: true|false (PII redacted)
    source: google_one_tap | manual_form
    unsubscribed: true|false
    deleted: true|false (or hard-deleted = not in DB)
  chalermpon_at_chula:
    exists: true|false
    source: ...
    unsubscribed: ...
    deleted: ...

audit_trail:
  total_entries_last_2h: N
  actions_found: [LEAD_CREATED, LEAD_UNSUBSCRIBED, LEAD_DELETED, ...]

interpretation_plain_thai:
  unsubscribe_worked: "คำอธิบายว่า unsubscribe ทำงานจริงหรือไม่ + หลักฐาน"
  delete_worked: "คำอธิบายว่า delete ทำงานจริงหรือไม่ + soft/hard delete"
  compliance_notes: "CCPA/CAN-SPAM posture — เพียงพอไหม?"

schema_findings:
  leads_columns: [id, email, name, company, source, unsubscribed_at, deleted_at, ...]
  has_soft_delete: true|false  # deleted_at column exists?
  audit_logs_columns: [...]

issues_found: []
```

## Rules

- **SSH read-only** — only psql SELECT + \d queries. NO writes to DB.
- **Never display secrets** — redact emails (3 chars + ***), no IPs, no names
- Memory `feedback_secret_handling_protocol.md` applies
- Short task — estimated 5-10 min

Begin.
