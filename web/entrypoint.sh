#!/bin/sh
set -e
echo "[enigma-web] Version: ${APP_VERSION:-unknown}"
echo "[enigma-web] Running database migrations..."
npx prisma migrate deploy
echo "[enigma-web] Starting Next.js on port ${PORT:-80}..."
exec node server.js
