# Runs on any container host: AWS (ECS/App Runner), GCP (Cloud Run), Azure (Container Apps), Fly, Render, Kubernetes.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_STANDALONE=1
RUN npm run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 DATABASE_PATH=/data/propniti.db
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# Schema, applied on first start (src/lib/platform/sqlite.ts).
COPY --from=build /app/migrations ./migrations
# Demo data (SQLite). Mount a volume here to keep it across restarts.
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
