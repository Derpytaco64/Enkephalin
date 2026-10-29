#!/bin/sh
# Migrate before serving, so the app never answers a request against a schema
# it does not expect. A failed migration must stop the container rather than
# start a half-working one.
set -e
echo "running migrations..."
./node_modules/tsx/dist/cli.mjs db/migrate.ts
exec "$@"
