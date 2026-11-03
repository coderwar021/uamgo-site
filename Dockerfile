# syntax=docker/dockerfile:1
FROM node:26.13.0-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:26.13.0-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9
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
