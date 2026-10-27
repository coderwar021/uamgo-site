# syntax=docker/dockerfile:1
FROM node:26.12.1-bookworm-slim@sha256:28147155d47dc31abe0a46e0d12b59b2fb3d0a2dcc5dc65fce76a074180b16fe AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:26.12.1-bookworm-slim@sha256:28147155d47dc31abe0a46e0d12b59b2fb3d0a2dcc5dc65fce76a074180b16fe
WORKDIR /app
RUN mkdir -p /app/data && chown node:node /app/data
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json server.mjs accounts.mjs audit.mjs cli.mjs cloudflare-ips.mjs rental.mjs security.mjs site-sign.mjs waffo.mjs ./
COPY --chown=node:node public ./public
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod 755 /app/docker-entrypoint.sh
ENV NODE_ENV=production
EXPOSE 8080
ENTRYPOINT ["/app/docker-entrypoint.sh"]
