# Caddy Reload Runbook (T-096)

## Background

Admin API on Unix socket `/config/admin.sock` (caddy_config volume, uid 1000)
— **never network-reachable**. Set in `infra/caddy/Caddyfile`:
`admin unix//config/admin.sock`. Caddyfile + certs mount via parent dir
(`./infra/caddy:/etc/caddy:ro`) so host file replacements (e.g.
`git reset --hard`) propagate into the container.

## Graceful reload (preferred)

```bash
cd ~/vollos-core
docker exec vollos-core-caddy caddy reload \
  --config /etc/caddy/Caddyfile \
  --address unix//config/admin.sock
```

CI/CD does this automatically when `infra/caddy/Caddyfile` changes (see
`.gitlab-ci.yml` deploy stage). Manual run only for hot-fix.

## Verify

```bash
docker logs vollos-core-caddy --tail 20 | grep -i 'reload\|admin'
curl -sI https://vollos.ai            | head -1   # HTTP/2 200
curl -sI https://accommodate.vollos.ai | head -1   # HTTP/2 200
```

If reload errors, Caddy keeps the **old config running** — no downtime.

## Fallback (if graceful reload fails)

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  up -d --force-recreate caddy
```

Path Plan A (T-095) used. ~2-3s edge downtime — only when graceful errors.

## Troubleshooting

| Error | Fix |
|---|---|
| `dial unix /config/admin.sock: no such file` | Wait 5s (boot); else check `admin` directive + `ls /config/` in container |
| `permission denied` on socket | Confirm `user: "1000:1000"` in compose |
| Caddyfile change doesn't appear | Confirm `./infra/caddy:/etc/caddy:ro` (dir, not single file) |
| `adapt:` syntax error | Bad Caddyfile — `git reset --hard HEAD~1` + re-reload |

## History

T-094 acmd routes didn't apply on VPS. T-095 Plan A: force-recreate caddy
(~2s downtime). T-096 Plan B (this): admin Unix socket + parent dir mount —
future MR merges auto-apply via `caddy reload`, no recreate, no downtime.
