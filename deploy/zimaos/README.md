# Running it on ZimaOS

There are two ways in, and the difference is *where the image gets built*.
Everything else — migrations on boot, the seeding, the healthchecks — carries
over from the repo's own compose file unchanged.

**[Route A: clone it on the Zima and build there](#route-a-clone-and-build-on-the-zima)**
is the simpler one, and the one to start with. The repo's own
`docker-compose.yml` works as-is, plus a small override for the ports. It needs
~2 GB of free RAM for `next build` and about five minutes.

**[Route B: build the image elsewhere and ship it](#route-b-build-elsewhere-and-ship-the-image)**
uses `deploy/zimaos/docker-compose.yml` instead, and is the answer when the box
cannot build — too little RAM, or no outbound network for `npm ci`.

One correction to something an earlier draft of this file said, because it sent
people down Route B needlessly: **the App Store importer cannot build, but the
Zima can.** CasaOS-derived app installers only *pull* images, so a compose file
saying `build: .` is no good in that dialog — but the Docker daemon underneath
is an ordinary one, and `docker compose up --build` in a terminal builds like
anywhere else. The constraint is RAM, not the platform.

## Route A: clone and build on the Zima

### A1. Get the source there

```bash
mkdir -p /DATA/AppData && cd /DATA/AppData
git clone -b indication-scope https://github.com/Derpytaco64/Enkephalin.git enkephalin
cd enkephalin
```

No `git` on the box? The repo is public, so curl and tar are enough:

```bash
mkdir -p /DATA/AppData && cd /DATA/AppData
curl -fL https://github.com/Derpytaco64/Enkephalin/archive/refs/heads/indication-scope.tar.gz | tar xz
mv Enkephalin-indication-scope enkephalin && cd enkephalin
```

The tarball route gives up `git pull` for updates — re-download instead.

### A2. Write `.env`

The repo's compose interpolates every value from `.env`, which is gitignored
and so is never in the clone. `.env.example` lists them; the five that must
actually change are the Postgres password (in **both** places), a fresh
`BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL` — which must be *exactly* the
address you will type in the browser, port included, or the session cookie is
issued for an origin you are not on and signing in silently fails.

Note `DATABASE_URL` uses the host `db` (the compose service name) while
`DATABASE_URL_HOST` uses `127.0.0.1` — the first is for the app inside the
network, the second for operator scripts on the host. Keep both.

### A3. Override the ports

The repo's compose binds both published ports to `127.0.0.1`, because it was
written for a server with a reverse proxy in front. On a NAS you want the app
reachable from your laptop, so republish it on every interface. An override
file rather than an edit, so `git pull` never fights you:

```yaml
# /DATA/AppData/enkephalin/docker-compose.override.yml
services:
  web:
    ports: !override ["3000:3000"]
```

`!override` replaces the list rather than appending to it — without it you get
both bindings, and the loopback one is harmless but confusing. Postgres keeps
its loopback-only binding, which is correct: nothing off-box should reach it.

### A4. Build and start

```bash
docker compose up -d --build
docker compose logs -f web
```

Expect `running migrations...`, then `migrations applied`, then Next's ready
line, then `[bootstrap] seeded admin`. Then jump to
[First boot](#4-first-boot-both-routes) below — the rest of this file applies to both
routes.

Updating later is `git pull && docker compose up -d --build`. **The `--build`
is not optional**: the container runs a built image, so without it your pull
changed nothing that is running.

## Route B: build elsewhere and ship the image

Three steps: build the image, get it onto the Zima, paste the YAML.

## 0. Check the architecture

```bash
docker image inspect enkephalin-web:latest --format '{{.Os}}/{{.Architecture}}'
# linux/amd64
```

ZimaBoard, ZimaBlade and ZimaCube are all x86-64, so an image built on your
Windows machine matches. If you are running ZimaOS on ARM hardware instead,
build for it explicitly or the container will refuse to start with an `exec
format error`:

```bash
docker buildx build --platform linux/arm64 -t enkephalin-web:arm64 .
```

## 1. Build and tag the image

```bash
docker compose build web
```

That produces `enkephalin-web:latest`. Give it a real tag before shipping it —
`latest` on a home server is how you end up unable to say what is running:

```bash
docker tag enkephalin-web:latest enkephalin-web:2026-11-09
```

## 2. Get the image onto the Zima

### Side-load over SSH — no accounts, no registry

The straightforward route, and the one to use if the repo is still local-only.

```bash
docker save enkephalin-web:2026-11-09 | gzip > enkephalin-web.tar.gz   # ~100 MB
scp enkephalin-web.tar.gz zima@<zima-ip>:/DATA/
ssh zima@<zima-ip> 'gunzip -c /DATA/enkephalin-web.tar.gz | docker load && rm /DATA/enkephalin-web.tar.gz'
```

Then in the compose file use the bare name, since there is no registry to pull
from — and ZimaOS must not try:

```yaml
image: enkephalin-web:2026-11-09
pull_policy: never
```

`pull_policy: never` matters. Without it an install can fail trying to reach
Docker Hub for an image that is already sitting there locally.

### Or push to GHCR — better if you will update often

Needs the GitHub repo from `docs/deploy.md`. A private repo gives you a private
image, which then needs a login on the Zima as well.

```bash
# on your machine
echo <a classic PAT with write:packages> | docker login ghcr.io -u <you> --password-stdin
docker tag enkephalin-web:2026-11-09 ghcr.io/<you>/enkephalin-web:2026-11-09
docker push ghcr.io/<you>/enkephalin-web:2026-11-09

# on the Zima, once, if the package is private
ssh zima@<zima-ip> 'echo <a PAT with read:packages> | docker login ghcr.io -u <you> --password-stdin'
```

Updating is then: build, tag with a new date, push, and change one line in the
app's compose in the ZimaOS UI.

## 3. Edit the YAML, then paste it

Open `docker-compose.yml` next to this file and replace every `CHANGE-ME`:

| value | what to put |
|---|---|
| `POSTGRES_PASSWORD` | a long random string — **the same string in `DATABASE_URL`** |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32`, fresh |
| `BETTER_AUTH_URL` | the exact address you will type in the browser |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | your seed login |
| `web.image` | the tag from step 2 |

**`BETTER_AUTH_URL` is the one that fails silently.** `lib/auth.ts` hands it to
better-auth as its `baseURL`, so if it says `http://zima.local:3000` and you
browse to `http://192.168.1.50:3000`, the session cookie is issued for an
origin you are not on: sign-in appears to succeed and you are immediately
signed out again. Pick one address and use it everywhere — scheme and port
included.

Then: **App Store → the `+` / Custom Install → Import docker-compose**, paste,
install. ZimaOS creates `/DATA/AppData/enkephalin/db` for the database itself.

Two notes on the file, both deliberate:

- **Postgres publishes no port.** Nothing outside the compose network needs it,
  and the host scripts that wanted `127.0.0.1:5432` cannot run on ZimaOS
  anyway — there is no Node there. `docker exec` covers the rest.
- **The web port is published to the whole LAN** (`3000:3000`) rather than
  loopback, because reaching it from your laptop is the point. That means plain
  HTTP across your network, with session cookies not marked secure. Fine on a
  home LAN you trust; see "TLS, if you want it" below if this ever leaves it.

## 4. First boot (both routes)

ZimaOS shows container logs from the app tile, or over SSH:

```bash
docker logs -f enkephalin-web
```

Look for `running migrations...`, then `[bootstrap] seeded admin …`, then
Next's ready line. Then:

```bash
curl -s http://<zima-ip>:3000/api/health   # {"ok":true,"db":"up"}
```

That endpoint does a real `select 1`, so a 200 means the app and the database
are genuinely talking, not merely running.

## 5. Get your drugs in (both routes)

The database is empty at this point — field definitions and your admin account,
no drugs. **Move the one you already have**, rather than reseeding: you have
236 drugs with hand-verified edits, study schedules and quiz history, and
ZimaOS cannot run `npm run seed` regardless (no Node, and the runtime image
deliberately ships without the dev tree).

```bash
# on your machine, with the local stack up
docker compose exec -T db pg_dump -U enkephalin -d enkephalin -Fc > enkephalin.dump
scp enkephalin.dump zima@<zima-ip>:/DATA/

# on the Zima -- stop the app first so nothing writes mid-restore.
# Use the ZimaOS UI to stop it, or:
ssh zima@<zima-ip>
docker stop enkephalin-web
docker cp /DATA/enkephalin.dump enkephalin-db:/tmp/enkephalin.dump
docker exec -i enkephalin-db pg_restore -U enkephalin -d enkephalin \
  --clean --if-exists /tmp/enkephalin.dump
docker exec -i enkephalin-db rm /tmp/enkephalin.dump
rm /DATA/enkephalin.dump
docker start enkephalin-web
```

Copy the dump *into* the container rather than piping it in. A `-Fc` archive
needs to seek, and `pg_restore … < file` through `docker exec` fails with
`did not find magic string in file header` — which reads like a corrupted dump
and is not one.

A `pg_dump` move brings the accounts with it, passwords included, so the
`ADMIN_*` values in the YAML are never used after this: `lib/bootstrap.ts`
seeds an admin only when none exists.

The JSON backup (`npm run export`) is the other route, but it is the wrong one
here — it matches progress to accounts **by email** and will not create a
login out of a file, and it does not model imported sets yet. It is for merging
content, not for moving a database.

## 6. Backing it up (both routes)

Everything lives in `/DATA/AppData/enkephalin/db`, which is why the compose file
uses a bind mount there instead of a named volume: ZimaOS's own file manager and
backup tooling can see it.

Do not back it up by copying those files while Postgres is running — that is a
torn copy, not a backup. Dump it instead:

```bash
# a ZimaOS cron job, or run it from your laptop over ssh
docker exec -t enkephalin-db pg_dump -U enkephalin -d enkephalin -Fc \
  > /DATA/Backups/enkephalin-$(date +%F).dump
```

## TLS, if you want it

Only needed if this is reachable from outside your house. Two routes that both
avoid opening a port:

- **Tailscale** — install it on the Zima, set `BETTER_AUTH_URL` to the
  `*.ts.net` name, and the traffic is encrypted without a certificate or a
  public DNS record. Simplest by a distance.
- **A Caddy container in front**, as in `docs/deploy.md` — then change the web
  service's ports to `127.0.0.1:3000:3000` so only the proxy can reach it, and
  set `BETTER_AUTH_URL` to the `https://` name.

Do not put this on the open internet over plain HTTP. The login would be sent
in the clear, and the session cookie with it.
