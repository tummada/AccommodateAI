---
task_id: T-033
agent: vollos-devops
status: completed
verdict: SOFT-DELETED-GRACE-PERIOD
finished_at: 2026-04-19T18:45+07:00
---

## Summary

Old GitLab project `vollos-ai/vollos-core` successfully soft-deleted via API.
GitLab applied a grace-period (soft-delete): project renamed to
`vollos-ai/vollos-core-deletion_scheduled-81395879` and flagged
`marked_for_deletion_at: 2026-04-19`. Production (3 URLs) unaffected.

## Pre-flight findings

### 1. New project (tummadajingjing/vollos-core) health
- `GET /projects/tummadajingjing%2Fvollos-core` → **HTTP 200**
- `path_with_namespace: tummadajingjing/vollos-core`
- `default_branch: main`
- `archived: false`, `marked_for_deletion_at: null`
- `main` tip commit = **`a65660d2b555734a6e829cf8cab3769755a60f7a`** (short `a65660d2`) — matches T-032 verified commit exactly.

### 2. Old project (vollos-ai/vollos-core) branch audit
`GET /projects/vollos-ai%2Fvollos-core/repository/branches` → 4 branches:

| branch                     | merged | default | protected | tip      |
|----------------------------|--------|---------|-----------|----------|
| main                       | —      | yes     | yes       | 540c8ac2 |
| docs/cleanup-allowlist-d7  | YES    | no      | no        | db3ad925 |
| feat/api-v1-versioning     | YES    | no      | no        | 589e17a1 |
| feat/rs-013-core           | NO     | no      | no        | 40918bd0 |

### 3. Cross-project commit presence
- Old main tip `540c8ac2` exists in NEW main → **HTTP 200** (old main fully contained in new).
- New main tip `a65660d2` NOT in OLD project → **HTTP 404** (expected — T-032 + migration commits made after fork).
- `feat/rs-013-core` 11 commits: 10 exist in NEW, 1 (`40918bd0`) does not.

### 4. Unmerged commit `40918bd0` — content analysis
- Title: `chore: update workspace state — T-001 board status + DevOps output.md`
- Files changed: only 2
  - `_board.md` (modified) — workspace bookkeeping
  - `_workspace/T-001/output.md` (new) — DevOps audit trail
- No code, no config, no migrations, no infra, no .env changes.

### 5. Content equivalence check (SHA-256 of blobs)
- `_workspace/T-001/output.md` in OLD `feat/rs-013-core`: `6daa2d69...d6752`
- `_workspace/T-001/output.md` in NEW `main`:           `6daa2d69...d6752`
- **IDENTICAL** — file already preserved in new project via an earlier carry-over commit.
- `_board.md` differs — expected, since `_board.md` evolved substantially in new project (T-002..T-033 tracked there) and OLD's version is an earlier snapshot now obsolete.

### Pre-flight verdict
**CLEAN** — unique content on `feat/rs-013-core` is stale workspace state already superseded by newer `_board.md` in the new project. No production code, config, or data at risk. Safe to delete.

## DELETE API call

```
DELETE https://gitlab.com/api/v4/projects/vollos-ai%2Fvollos-core
```

Response:
```
{"message":"202 Accepted"}
HTTP 202
```

## Post-delete verification

### Project lookup by path
```
GET /projects/vollos-ai%2Fvollos-core
-> HTTP 301 redirect to /projects/81395879
```

### Project lookup by numeric ID (81395879)
```
GET /projects/81395879 -> HTTP 200
{
  "path_with_namespace": "vollos-ai/vollos-core-deletion_scheduled-81395879",
  "archived": false,
  "marked_for_deletion_at": "2026-04-19",
  "marked_for_deletion_on":  "2026-04-19",
  "default_branch": "main",
  "visibility": "private"
}
```

- GitLab Free applied **soft-delete with grace period** (common behavior: ~7 days before permanent removal).
- Project is renamed and flagged; original path `vollos-ai/vollos-core` redirects but is effectively released.
- `permanent_deletion_at` not included in this endpoint's response; GitLab typically performs the permanent purge ~7 days after `marked_for_deletion_on`.

## 3-URL health AFTER delete

| URL                               | Before | After |
|-----------------------------------|--------|-------|
| https://vollos.ai                 | 200    | 200   |
| https://auth.vollos.ai/health     | 200    | 200   |
| https://api.vollos.ai/health      | 200    | 200   |

Production fully unaffected — VPS points to new namespace registry and does not rely on the old project.

## Self-review (evidence-based)

- [x] **Pre-flight new project verified** — `a65660d2b555734a6e829cf8cab3769755a60f7a` matches T-032 target (GET /projects/tummadajingjing%2Fvollos-core/repository/branches/main → 200).
- [x] **Old-project branch audit done** — 4 branches enumerated; compare API + SHA-256 blob hash used to prove only divergence is stale workspace bookkeeping.
- [x] **Unmerged commit inspected line-by-line** — `40918bd0` diff only touches `_board.md` + `_workspace/T-001/output.md`; `output.md` sha256 identical to NEW main copy.
- [x] **DELETE issued** — `DELETE /projects/vollos-ai%2Fvollos-core` → 202 Accepted.
- [x] **Post-delete state confirmed** — project renamed to `vollos-ai/vollos-core-deletion_scheduled-81395879` and `marked_for_deletion_at: 2026-04-19` (soft-delete + grace period).
- [x] **VPS 3-URL health verified** — all 200 before and after DELETE.
- [x] **No secrets printed** — `VOLLOS_CLI` sourced silently via `set -a; source .env; set +a`, never echoed.
- [x] **Placeholder audit** — no code files modified; N/A (read-only API work).

### Placeholders remaining
none — grep clean (no code files modified in this task).

## Acceptance criteria checklist

1. [x] Pre-flight check: new project healthy + main matches T-032 verification (`a65660d2`)
2. [x] Old-project branch audit: clean (only stale workspace bookkeeping diverges; already superseded in new project)
3. [x] DELETE API call issued → 202 Accepted
4. [x] Verification: old project no longer at original path (301); by ID shows `deletion_scheduled` + `marked_for_deletion_at`
5. [x] VPS + 3 URLs still 200 after delete
6. [x] No secrets leaked

## Notes for Lead

- **Grace period:** GitLab Free marks projects for deletion on a delayed timeline (typically ~7 days). If `vollos-ai` namespace must be fully reclaimed sooner, owner can navigate to the project in GitLab UI and choose **"Delete project immediately"** on the paid tier, or wait out the window. On Free, the soft-delete is the final state the API exposes.
- The project namespace `vollos-ai` group itself still exists and is now empty. If the owner wants to delete the group entirely, that is a separate `DELETE /groups/vollos-ai` call — **not in scope for T-033**.
- No rollback action required. If owner changes their mind during the grace window, project can be restored via `POST /projects/81395879/restore` (GitLab keeps the record until permanent purge).
