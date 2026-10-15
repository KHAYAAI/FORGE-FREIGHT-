FROM node:26-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter @forge-freight/api... \
 && pnpm --filter @forge-freight/api... build \
 && pnpm --filter @forge-freight/api --prod deploy /out

FROM node:26-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
COPY --from=build /repo/apps/api/dist ./dist
EXPOSE 3001
USER node
CMD ["node", "dist/main.js"]
