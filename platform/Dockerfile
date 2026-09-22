FROM node:22-slim AS base
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npx next build

FROM base AS runner
ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
RUN npm install -g prisma@6.19.3
EXPOSE 3000
# Aplica o schema, cria a equipe de IA inicial e sobe o servidor.
CMD ["sh", "-c", "prisma db push --skip-generate --schema prisma/schema.prisma && node prisma/seed.mjs; HOSTNAME=0.0.0.0 PORT=${PORT:-3000} node server.js"]
