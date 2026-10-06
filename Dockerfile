# syntax=docker/dockerfile:1
FROM node:26.9.0-bookworm-slim@sha256:582460f614631b59b824ac6020533b9bf339c7fdf3a6d7db31abb6b4065f0212 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:26.9.0-bookworm-slim@sha256:582460f614631b59b824ac6020533b9bf339c7fdf3a6d7db31abb6b4065f0212
WORKDIR /app
RUN mkdir -p /app/data && chown node:node /app/data
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json server.mjs accounts.mjs aether.mjs audit.mjs cloudflare-ips.mjs rental.mjs security.mjs site-sign.mjs waffo.mjs ./
COPY --chown=node:node public ./public
USER node
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.mjs"]
