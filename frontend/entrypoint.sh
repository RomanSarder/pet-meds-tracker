#!/bin/sh
set -e

# Substitute only ${BACKEND_URL} and ${PORT} — single quotes prevent the shell from
# expanding nginx's own $variables (e.g. $proxy_host, $remote_addr).
envsubst '${BACKEND_URL} ${PORT}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
