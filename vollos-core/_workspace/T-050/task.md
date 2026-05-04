---
id: T-050
title: Deduplicate google.accounts.id.initialize() on landing page
assigned_to: vollos-frontend
priority: low
status: in_progress
spawn_started_at: 2026-04-20T11:25+07:00
security_checkpoint: false
owned_files:
  - apps/landing/index.html
  - apps/landing/**
dependencies: []
---

## Context

Owner browser-test (2026-04-20) on https://vollos.ai showed console warning:
```
[GSI_LOGGER]: google.accounts.id.initialize() is called multiple times.
This could cause unexpected behavior and only the last initialized instance will be used.
```

Google's own warning — the landing page calls `google.accounts.id.initialize()` 2 times. Only the last one takes effect but it's sloppy.

Likely cause: One Tap init + Sign-In button init both call initialize() with (possibly) different configs. Should consolidate into one init call with merged config, or guard so initialize runs exactly once.

## Scope

1. `grep -n "google.accounts.id.initialize" apps/landing/` to locate call sites
2. Inspect: are they identical? Different configs? Called on different events?
3. Refactor: ONE call to initialize(), shared config. If two different configs are truly needed (they usually aren't for One Tap + button), document why.
4. Browser-level verification is owner's manual step (agent does curl + grep only) — note this in output.md
5. Keep all EXISTING features working: One Tap popup + Sign-In button + credential callback

## Workflow

1. `git fetch origin && git checkout -b fix/landing-gsi-dedup origin/main`
2. Implement
3. Commit: `fix(landing): deduplicate google.accounts.id.initialize() call`
4. Push + open MR

## Acceptance Criteria

1. [ ] `initialize()` called exactly once in landing page
2. [ ] Google One Tap still triggers (code path preserved)
3. [ ] Google Sign-In button still renders (code path preserved)
4. [ ] Credential callback still wired
5. [ ] grep evidence: `grep -c "google.accounts.id.initialize" apps/landing/index.html` = 1
6. [ ] Branch pushed + MR opened
7. [ ] Placeholder Audit clean
8. [ ] `self_review` complete

## Self-Review (Mandatory)

## Deliverable

`/home/ipon/workspace/vollos-ai/vollos-core/_workspace/T-050/output.md`
