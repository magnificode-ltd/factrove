#!/bin/sh
# API container entrypoint.
# serve (the default) starts the HTTP server and does not migrate.
# migrate runs prisma migrate deploy and exits.
# FACTROVE_MIGRATE=1 migrates and then serves. Any other value does not migrate.
set -eu

cd /app

run_migrate() {
  node ./node_modules/prisma/build/index.js migrate deploy
}

case "${1:-serve}" in
  serve)
    if [ "${FACTROVE_MIGRATE:-}" = "1" ]; then
      run_migrate
    fi
    exec node dist/main.js
    ;;
  migrate)
    exec node ./node_modules/prisma/build/index.js migrate deploy
    ;;
  *)
    exec "$@"
    ;;
esac
