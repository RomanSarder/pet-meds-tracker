#!/bin/sh
set -e
cd /app/backend
node /app/backend/dist/backend/src/db/migrate.js
exec node /app/backend/dist/backend/src/server.js
