# One build, three images: docker build --target server|edge|client .
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY packages/sim/package.json packages/sim/
COPY packages/netcode/package.json packages/netcode/
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY apps/edge/package.json apps/edge/
RUN npm ci --no-audit --no-fund
COPY packages packages
COPY apps apps
RUN npm run build

FROM node:22-slim AS server-deps
WORKDIR /app
COPY apps/server/package.json ./package.json
# Workspace packages are bundled into main.mjs; only real npm deps are needed at runtime.
RUN npm pkg delete "dependencies.@bkny/netcode" "dependencies.@bkny/sim" && npm install --omit=dev --no-audit --no-fund --no-package-lock

FROM node:22-slim AS server
WORKDIR /app
ENV NODE_ENV=production
COPY --from=server-deps /app/node_modules node_modules
COPY --from=build /app/apps/server/dist/main.js main.mjs
USER node
EXPOSE 7777
CMD ["node", "main.mjs"]

FROM node:22-slim AS edge
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/edge/dist/main.js main.mjs
USER node
EXPOSE 8080
CMD ["node", "main.mjs"]

FROM nginxinc/nginx-unprivileged:1.27-alpine AS client
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/client/dist /usr/share/nginx/html
EXPOSE 8080
