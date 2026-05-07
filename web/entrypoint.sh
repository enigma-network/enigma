#!/bin/sh
set -e
echo "[enigma-web] Running database migrations..."
npx prisma migrate deploy
echo "[enigma-web] Starting Next.js..."
exec node server.js
