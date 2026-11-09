# Running it on ZimaOS

The Ishi-Reader pattern works here — clone into `/DATA/AppData`, build on the
box, push to Docker Hub, install from the App Store:

```bash
cd /DATA/AppData/Ishi-Reader
git pull
docker build -t dt64/ishi-read:latest .
docker push dt64/ishi-read:latest
```

**One difference, and it is the only one that matters: this app is two
containers, not one.** It needs a Postgres beside it, and the two find each
other over the compose network — so the thing you paste into Custom Install is
a two-service compose file rather than a single image, and it carries the
database password and the auth secret as environment variables. That file is
`docker-compose.yml` next to this one.

Everything else is the same shape. Migrations run from the container's
entrypoint on every boot, so there is no separate "set up the database" step,
and `lib/bootstrap.ts` seeds the field definitions and one admin on the first
start.

## 1. Build and push, on the Zima

```bash
cd /DATA/AppData
git clone -b indication-scope https://github.com/Derpytaco64/Enkephalin.git Enkephalin
cd Enkephalin
docker build -t dt64/enkephalin:latest .
docker push dt64/enkephalin:latest
```

`docker login` first if the box is not already logged in. Note the branch:
**`indication-scope`**, not `main` — `main` is 58 commits behind as of
2026-11-09, missing dosing-by-indication and imported sets entirely.

The build wants **~2 GB of free RAM**; `next build` is the hungry step, not the
running app. If it dies without a clear error, that was the memory — add swap,
or build it on the Windows box and `docker save | ssh … docker load` instead.

The push is optional, strictly speaking. It is in this flow because a CasaOS
installer *pulls*, and will go looking on Docker Hub for an image that is
already on the disk. If you would rather keep it local, skip the push and add
one line to the web service:

```yaml
    pull_policy: never
```

What ends up on Docker Hub is the runtime image only: the `Dockerfile`'s final
stage copies the standalone server, the static assets and `db/`, so
`data/drugs-seed.json` and the rest of the course extract are **not** in the
published image. They are in the public repo, which is a separate decision
recorded in the root README.

## 2. Fill in the compose file, then install

Open `docker-compose.yml` next to this file and replace every `CHANGE-ME`:

| value | what to put |
|---|---|
| `POSTGRES_PASSWORD` | a long random string — **the same string in `DATABASE_URL`** |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32`, fresh |
| `BETTER_AUTH_URL` | `http://<zima-ip>:3636` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | your seed login |

Two things about that file worth knowing before you paste it.

**`BETTER_AUTH_URL` is the one that fails silently.** `lib/auth.ts` hands it to
better-auth as its `baseURL`, so if it says `http://zima.local:3636` and you
browse to `http://192.168.1.50:3636`, the session cookie is issued for an
origin you are not on: sign-in appears to succeed and you are signed straight
out again. Pick one address and use it everywhere, scheme and port included.

**The port mapping is `3636:3000`, and that is not a typo.** 3636 is the port
on the Zima; 3000 is inside the container, where the server listens no matter
what the host side says. Only the left number is yours to pick. The same
asymmetry is why the healthcheck inside the compose file says 3000 while the
`curl` you run from a terminal says 3636.

Then: **App Store → the `+` / Custom Install → Import docker-compose**, paste,
install.

Postgres deliberately publishes no port. Nothing off-box needs it, and the
`npm run export` / `restore` scripts that wanted `127.0.0.1:5432` need Node,
which the Zima has not got — `docker exec` covers pg_dump and psql instead.

## Behind a reverse proxy

Sign-in answers `Invalid origin` with a 403, and nothing else looks wrong.

better-auth validates the request's `Origin` header against a trusted list
that, by default, holds **exactly one** entry: the origin of `baseURL`, which
is `BETTER_AUTH_URL`. A proxy forwards the browser's origin — the public
hostname — so the two stop matching the moment anything sits in front of the
app. Set the other address explicitly:

```yaml
      BETTER_AUTH_TRUSTED_ORIGINS: https://drugs.example.com
```

Comma-separated for more than one, and origins rather than URLs: scheme, host
and port, no path. Wildcards work, since the value is passed through to
better-auth's own matcher untouched.

Which address stays as `BETTER_AUTH_URL` is then a real choice, because the
Secure cookie flag is derived from its scheme — `baseURL.startsWith('https://')`
and nothing else:

| `BETTER_AUTH_URL` | cookies | consequence |
|---|---|---|
| the `https://` proxy URL | `Secure` | correct, but plain-http LAN access can never log in — a browser will not send a Secure cookie over http |
| the `http://` LAN address | not `Secure` | both ways in work; fine when the proxy is on your own network, wrong if it faces the internet |

Pick one. Wanting both across mixed schemes is what produces "it signs me in
and then signs me straight out".

This is config, but the option it feeds was added to `lib/auth.ts` on
2026-11-09 — so an image built before that ignores the variable entirely.
Rebuild and push, then restart.

## 3. First boot

From the app tile's log view, or a terminal:

```bash
docker logs -f enkephalin-web
```

In order: `running migrations...`, `migrations applied`, Next's ready line,
`[bootstrap] seeded admin …`. **No `migration failed` lines** — if you see
some, the image was built from a commit before 2026-11-09, when the database
healthcheck was reporting ready during `initdb`. Then:

```bash
curl -s http://127.0.0.1:3636/api/health    # {"ok":true,"db":"up"}
```

That endpoint runs a real query, so a true there means the app and the database
are talking rather than merely both running.

## 4. Get your drugs in

The database is empty at this point — field definitions and your admin account,
no drugs. **Move the one you already have** rather than reseeding: 236 drugs
with hand-verified edits, study schedules and quiz history, and ZimaOS cannot
run `npm run seed` anyway.

On the Windows box, with the local stack up:

```bash
docker compose exec -T db pg_dump -U enkephalin -d enkephalin -Fc > enkephalin.dump
```

Upload that to `/DATA` with the ZimaOS **Files** app (or `scp` it), then:

```bash
docker stop enkephalin-web
docker cp /DATA/enkephalin.dump enkephalin-db:/tmp/enkephalin.dump
docker exec enkephalin-db pg_restore -U enkephalin -d enkephalin \
  --clean --if-exists /tmp/enkephalin.dump
docker exec enkephalin-db rm /tmp/enkephalin.dump
docker start enkephalin-web
rm /DATA/enkephalin.dump
```

Copy the dump *into* the container rather than piping it in. A `-Fc` archive
needs to seek, and `pg_restore … < file` through `exec` fails with `did not
find magic string in file header` — which reads like a corrupt dump and is not
one.

Plenty of `does not exist, skipping` notices are normal: `--clean` tries to
drop objects a fresh database never had. Errors that are not "skipping" are
worth reading properly.

A `pg_dump` move brings the accounts with it, password hashes included, so you
sign in with the password you already use and the `ADMIN_PASSWORD` in the YAML
is never used — `lib/bootstrap.ts` seeds an admin only when none exists.

The JSON backup (`npm run export`) is the other route, and the wrong one here:
it matches progress to accounts **by email** and will not create a login out of
a file, and it does not model imported sets yet. It is for merging content, not
for moving a database.

To start from the course sheet instead, the source clone from step 1 is still
on the box, so the seed can run in a throwaway container — the host needs no
Node:

```bash
docker run --rm --network enkephalin_default \
  -e DATABASE_URL_HOST=postgres://enkephalin:<password>@db:5432/enkephalin \
  -v /DATA/AppData/Enkephalin:/app -w /app node:22-alpine \
  sh -c 'npm ci && npm run seed'
```

## 5. Pushing an update

Exactly the Ishi-Reader flow:

```bash
cd /DATA/AppData/Enkephalin
git pull
docker build -t dt64/enkephalin:latest .
docker push dt64/enkephalin:latest
```

Then make the app pick it up — the tile's update button, or:

```bash
docker pull dt64/enkephalin:latest
docker restart enkephalin-web
```

A `:latest` tag means you cannot say from the outside which build is running.
If that ever matters, tag with the date as well (`dt64/enkephalin:2026-11-09`)
and name that tag in the compose file.

New migrations need nothing extra: they run as the new container starts. There
are no down-steps, though, so rolling *back* across a migration is a restore
from backup rather than an older image.

## 6. Backing it up

Everything lives in `/DATA/AppData/enkephalin-db`, which is the point of the
bind mount — ZimaOS's file manager and backup tooling can see it.

Do not back it up by copying those files while Postgres is running; that is a
torn copy, not a backup. Dump it:

```bash
mkdir -p /DATA/Backups
docker exec -t enkephalin-db pg_dump -U enkephalin -d enkephalin -Fc \
  > /DATA/Backups/enkephalin-$(date +%F).dump
```

Worth putting on a timer, and worth copying off the Zima — a backup on the same
disk as the database is a copy.

## TLS, if you want it

Only needed if this becomes reachable from outside the house. As it stands it
is plain HTTP on your LAN, with session cookies not marked secure: fine for a
network you trust, not fine on the open internet, where the login would travel
in the clear.

- **Tailscale** — install it on the Zima, set `BETTER_AUTH_URL` to the
  `*.ts.net` name, and it is encrypted with no certificate and no public DNS
  record. Simplest by a distance.
- **A Caddy container in front**, as in `docs/deploy.md` — then change the web
  service's ports to `127.0.0.1:3636:3000` so only the proxy can reach it, and
  set `BETTER_AUTH_URL` to the `https://` name.
