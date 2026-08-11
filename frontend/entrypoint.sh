#!/bin/sh
set -e

# Strip a trailing slash from BACKEND_URL. `proxy_pass $backend` with a variable
# whose value carries a URI part — even a bare "/" — makes nginx REPLACE the
# rewritten request URI with that part, so every /api/* call would arrive at the
# backend's "/" and 404, silently discarding the rewrite below.
BACKEND_URL="${BACKEND_URL%/}"
export BACKEND_URL

# Substitute only ${BACKEND_URL} and ${PORT} — single quotes prevent the shell from
# expanding nginx's own $variables (e.g. $proxy_host, $remote_addr).
envsubst '${BACKEND_URL} ${PORT}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
