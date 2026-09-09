#!/usr/bin/env bash
set -euo pipefail

DBPASS="$(openssl rand -hex 24)"
JWT="$(openssl rand -hex 48)"

su - postgres -c "psql -v ON_ERROR_STOP=1" <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'quasar') THEN
    CREATE ROLE quasar LOGIN PASSWORD '${DBPASS}' CREATEDB;
  ELSE
    ALTER ROLE quasar PASSWORD '${DBPASS}' CREATEDB;
  END IF;
END
\$\$;
SQL

mkdir -p /home/quasar-backend
cat > /home/quasar-backend/.env <<ENV
DATABASE_URL="postgresql://quasar:${DBPASS}@localhost:5432/quasar"
PORT=3000
NODE_ENV="production"
JWT_SECRET="${JWT}"
JWT_EXPIRES_IN="12h"
CLIENT_HASH=""
CORS_ORIGIN="*"
ENV
chmod 600 /home/quasar-backend/.env

echo "ENV_WRITTEN"
