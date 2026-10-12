#!/bin/sh
set -eu
if [ -d /app/data ]; then
  chown -R node:node /app/data
fi
exec setpriv --reuid=node --regid=node --init-groups node server.mjs
