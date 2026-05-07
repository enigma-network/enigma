#!/bin/sh
set -e

echo "=== [enigma-web] STARTUP DEBUG ==="
echo "--- Environment ---"
echo "NODE_ENV=$NODE_ENV"
echo "PORT=$PORT"
echo "HOSTNAME=$HOSTNAME"
echo "WEBSITES_PORT=$WEBSITES_PORT"
echo "DATABASE_URL=$DATABASE_URL"
echo "NEXTAUTH_URL=$NEXTAUTH_URL"
echo "NEXTAUTH_SECRET=${NEXTAUTH_SECRET:+SET}"
echo "AUTH_GITHUB_ID=${AUTH_GITHUB_ID:+SET}"
echo "ENIGMA_SERVER_URL=$ENIGMA_SERVER_URL"
echo "--- System ---"
echo "User: $(id)"
echo "Working dir: $(pwd)"
echo "Node: $(node --version)"
echo "--- Disk ---"
df -h /tmp /data 2>/dev/null || true
echo "DB path exists: $(test -f "${DATABASE_URL#file:}" && echo YES || echo NO)"
echo "=== END DEBUG ==="

echo "[enigma-web] Running database migrations..."
npx prisma migrate deploy 2>&1
echo "[enigma-web] Migrations done."

echo "[enigma-web] Starting Next.js on port ${PORT:-3000}..."
exec node server.js 2>&1
