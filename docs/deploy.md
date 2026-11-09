# Deploying to your own server

Everything needed to run Enkephalin somewhere else is already in the repo:
`Dockerfile`, `docker-compose.yml`, `docker-entrypoint.sh`, and the migrations
the entrypoint runs. There is nothing to add — this document is the order to do
things in, and the handful of values that must change when the address stops
being `localhost`.

**On a ZimaOS or CasaOS box, read `deploy/zimaos/` instead of this file.** The
difference is not cosmetic: those install apps by *pulling an image*, so the
`build: .` in the repo's compose file cannot work there and the image has to be
built elsewhere first. `deploy/zimaos/docker-compose.yml` is the version to
paste in.

## What you are deploying

Two containers and one volume:

| | what it is | reachable from |
|---|---|---|
| `db` | `postgres:17-alpine` | the compose network, plus `127.0.0.1:5432` on the host |
| `web` | this app, built from the `Dockerfile` | `127.0.0.1:3000` on the host |
| `enkephalin-db` | a named volume — **this is where your data lives** | the `db` container |

Both published ports are bound to loopback on purpose. Nothing in this stack
terminates TLS or expects to face the internet; a reverse proxy on the same
machine does that and forwards to `127.0.0.1:3000`. Leave the bindings alone and
the only thing exposed to the network is the proxy.

Two things happen automatically on every boot, which is why there is no separate
"set up the database" step:

- **`docker-entrypoint.sh` runs the migrations** before `node server.js` starts.
  A failed migration stops the container rather than serving against a schema it
  does not expect.
- **`lib/bootstrap.ts` seeds** the site name, the core field definitions, and —
  only if no admin exists yet — one admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
  Re-running is safe: it fills gaps and never overwrites.

## Before you start

- Docker Engine with the Compose plugin (`docker compose version` works).
- **~2 GB of RAM free for the build.** `next build` is the memory-hungry step,
  not the running app. On a 1 GB box the build is killed partway with no useful
  error — either add swap, or build the image elsewhere (see below).
- A DNS name pointed at the server, if you want TLS.

## 1. Get the code onto the server

It is on GitHub — <https://github.com/Derpytaco64/Enkephalin>, public — so a
clone is the easy route. Two others are here because they need no network and
no credentials on the server, and because a public repo is a decision that can
be reversed.

### Clone it

The simplest route, and updating later is `git pull`. **Mind the branch**: the
work lives on `indication-scope`, which as of 2026-11-09 is 58 commits ahead of
`main` — everything from the dosing-by-indication change through imported sets.
Clone it explicitly, or merge it into `main` first and clone the default:

```bash
git clone -b indication-scope https://github.com/Derpytaco64/Enkephalin.git enkephalin
cd enkephalin
```

Nothing tracked is secret: `.env` is gitignored and only `.env.example`, with
its `change-me` placeholders, is committed. What *is* published is the content —
`data/top-drugs-2026.json` and `data/drugs-seed.json` are derived from the
course document (see `PLAN.md`, drug data sourcing). That is a deliberate
choice, recorded in the README; going private later is a setting, though the
history would keep the files either way.

### Ship a tarball of the tracked files

`git archive` writes exactly what is committed at a given ref — so `.env`,
`node_modules/`, `.next/`, `backups/`, the course PDF and the handwritten-note
photo are all left out **by construction rather than by an exclude list you
have to keep right**:

```bash
# on your machine (only scp and tar needed; there is no rsync here)
git archive --format=tar.gz -o enkephalin.tar.gz indication-scope
scp enkephalin.tar.gz you@server:~

# on the server
mkdir -p enkephalin && tar -xzf enkephalin.tar.gz -C enkephalin && cd enkephalin
```

287 tracked files, about 750 KB gzipped, and no history. Verified on
2026-11-09: the archive contains no `.env`, no `node_modules/`, no `.next/`,
and neither the PDF nor the photo. Updating later means another tarball, which
is the one drawback.

### Build here, ship the image

The right answer if the server is too small to run `next build`. Build locally,
save it, load it there:

```bash
docker compose build web
docker save enkephalin-web:latest | gzip > enkephalin-web.tar.gz
scp enkephalin-web.tar.gz you@server:~
# on the server:
gunzip -c enkephalin-web.tar.gz | docker load
```

You still need `docker-compose.yml` and `.env` on the server, plus a one-file
override so compose uses the loaded image instead of trying to build it:

```yaml
# docker-compose.override.yml -- picked up automatically
services:
  web:
    build: !reset null
    image: enkephalin-web:latest
```

The downside is real: every update then means building and shipping a new
tarball, and the server has no source tree to read when something looks wrong.
Prefer building on the server if it can.

## 2. Write the server's `.env`

`.env` is gitignored and never travels. Write a new one on the server from
`.env.example`, and change these:

```bash
cp .env.example .env
```

```ini
POSTGRES_PASSWORD=<long random string>
DATABASE_URL=postgres://enkephalin:<that same password>@db:5432/enkephalin
DATABASE_URL_HOST=postgres://enkephalin:<that same password>@127.0.0.1:5432/enkephalin

# openssl rand -base64 32  -- a fresh one, not the one from your laptop
BETTER_AUTH_SECRET=<32 random bytes, base64>

# The PUBLIC https address. better-auth uses it as its baseURL, so getting it
# wrong is the classic "login appears to work and then you are logged out":
# cookies are issued for the wrong origin.
BETTER_AUTH_URL=https://drugs.example.com

ADMIN_EMAIL=derpytaco64@gmail.com
ADMIN_PASSWORD=<a password you will change in the UI afterwards>

SITE_NAME=Enkephalin
```

Two notes worth having:

- `POSTGRES_PASSWORD` is only read when the volume is **created**. Changing it
  later in `.env` does not change the password Postgres has, and the app then
  cannot connect. Decide it now.
- `ADMIN_PASSWORD` is a seed, not the live password. Once you change your
  password in the app, the env value is dead weight — and if you ever delete
  the user, the next boot will reseed from it.

## 3. First boot

```bash
docker compose up -d --build
docker compose logs -f web
```

You are looking for `running migrations...`, then `[bootstrap] seeded admin …`,
then Next's ready line. Then check it from the host:

```bash
curl -s localhost:3000/api/health   # {"ok":true,"db":"up"}
```

`/api/health` does a real `select 1`, so a 200 there means the web container and
the database are both actually working. Compose gates `web` on the database's
own healthcheck, so a slow first start is normal rather than broken.

## 4. Put it behind TLS

The app speaks plain HTTP on loopback and expects something in front. **Caddy**
is the least work, because it gets the certificate itself:

```
# /etc/caddy/Caddyfile
drugs.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl reload caddy
```

That is the whole configuration — Caddy sets `X-Forwarded-Proto` and preserves
the `Host` header by default, which is what the auth cookies need.

With **nginx** instead, those headers are yours to set, and forgetting
`X-Forwarded-Proto` is the usual cause of a redirect loop on sign-in:

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name drugs.example.com;

    ssl_certificate     /etc/letsencrypt/live/drugs.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/drugs.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
    }
}
```

Then open only 80 and 443 in the firewall. Nothing needs 3000 or 5432 from
outside, and 5432 is not listening there anyway.

## 5. Get the content in

A fresh database has the field definitions and your admin account, and no drugs.
Two ways in, and they answer different questions.

### Seed from the committed sheet

`data/drugs-seed.json` is in the repo, so a new server can be filled without
copying anything. It needs Node on the host (not in the container) because the
runtime image deliberately ships without the dev tree:

```bash
npm ci                 # once, for the scripts
npm run seed
```

Safe to re-run: it fills gaps, corrects changed facts, and never blanks or
overwrites a hand-verified value without `--force`.

### Move the database you already have

Use this if you want your real work — edits, study schedules, quiz history,
imported sets, users — on the server rather than a fresh copy of the sheet.

**The whole database, exactly.** No Node needed on either end, and it carries
everything including sessions and tables the backup format does not model:

```bash
# on your machine
docker compose exec -T db pg_dump -U enkephalin -d enkephalin -Fc > enkephalin.dump
scp enkephalin.dump you@server:~

# on the server, with the stack up and web stopped so nothing writes mid-restore
docker compose stop web
docker compose cp ~/enkephalin.dump db:/tmp/enkephalin.dump
docker compose exec -T db pg_restore -U enkephalin -d enkephalin \
  --clean --if-exists /tmp/enkephalin.dump
docker compose exec -T db rm /tmp/enkephalin.dump
docker compose start web
```

Copy the file in rather than piping it: a `-Fc` archive needs to seek, and
`pg_restore … < file` through `exec` fails with `did not find magic string in
file header` — which looks like a corrupt dump and is not one.

**Or the portable backup**, which is the format the app itself writes and reads
and is readable JSON rather than a binary blob:

```bash
# on your machine
npm run export                       # writes backups/<timestamp>.json
scp backups/<timestamp>.json you@server:~/enkephalin/

# on the server (needs `npm ci` there)
npm run restore -- <timestamp>.json --replace
```

`--replace` also deletes every drug the file does not mention, which is what
moving a database wants; it asks for confirmation unless you pass `--yes`.

Do this *after* the first boot has seeded your admin, and with the same
`ADMIN_EMAIL` as the account the progress belongs to. The format matches
progress to accounts by email and will not invent a login out of a file, so an
email it does not find is reported as skipped — which is also why a `pg_dump`
move needs no admin seeding at all: the accounts come with it, passwords
included, and `ADMIN_PASSWORD` in the server's `.env` never gets used.

One caveat, deliberate and documented in `lib/data/backup.ts`: imported **sets**
are not in the backup format yet, so set-item progress is skipped. Re-import the
set files (`docs/set-format.md`) on the server, or use `pg_dump` if you have
sets you care about keeping.

## Updating after a change

```bash
git pull                      # or re-ship the tarball, if there is no remote
docker compose up -d --build
```

`--build` is not optional — the running container is a built image, so without
it your changes are simply not there. Migrations run as the new container
starts, so schema changes need nothing extra. The volume is untouched by a
rebuild.

To roll back, check out the previous commit and run the same command. Note that
migrations do not come with down-steps, so a rollback across a migration is a
restore from backup, not a `git checkout`.

## Backups

The data lives in the `enkephalin-db` volume. `docker compose down` leaves it
alone; **`docker compose down -v` destroys it**, which is the one command in
this document that loses your work.

A nightly dump, kept for two weeks:

```bash
# /etc/cron.daily/enkephalin-backup
#!/bin/sh
set -e
cd /home/you/enkephalin
docker compose exec -T db pg_dump -U enkephalin -d enkephalin -Fc \
  > "backups/$(date +%F).dump"
find backups -name '*.dump' -mtime +14 -delete
```

`backups/` is gitignored, so it will not end up in a push. Copy it off the
machine as well — a backup on the same disk as the database is a copy, not a
backup.

## Things that will bite you

- **Changes not showing up.** The image is built. `docker compose up -d --build`.
- **Signed in, then immediately signed out.** `BETTER_AUTH_URL` does not match
  the address in the browser's bar, scheme included.
- **The build dies with no error.** Out of memory. Add swap, or build elsewhere
  and `docker save` / `docker load`.
- **`password authentication failed`.** `POSTGRES_PASSWORD` was changed after
  the volume existed. Either set it back, or `ALTER USER enkephalin PASSWORD …`
  inside the database.
- **Your study progress "did not restore".** It was skipped, and the script
  said so: the JSON backup matches progress to accounts **by email**, and
  reports an email it cannot find rather than creating a login out of a file.
  Sign in once (or make sure `ADMIN_EMAIL` is the same address) before
  restoring. A `pg_dump` move has no such problem — it brings the accounts.
- **`npm run export` cannot connect.** It runs on the host, where the compose
  hostname `db` does not resolve. That is what `DATABASE_URL_HOST` is for.
