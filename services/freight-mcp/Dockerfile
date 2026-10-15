FROM node:26-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY services/freight-mcp ./services/freight-mcp
RUN pnpm install --frozen-lockfile --filter @forge-freight/freight-mcp... \
 && pnpm --filter @forge-freight/freight-mcp... build \
 && pnpm --filter @forge-freight/freight-mcp --prod deploy /out

FROM node:26-alpine
ENV NODE_ENV=production
ENV MCP_TRANSPORT=http
WORKDIR /app
COPY --from=build /out .
COPY --from=build /repo/services/freight-mcp/dist ./dist
EXPOSE 9000
USER node
CMD ["node", "dist/main.js"]
