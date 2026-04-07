FROM node:20-alpine AS base

# Install openssl for Prisma
RUN apk add --no-cache openssl

# Install dependencies and generate Prisma client
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
ENV PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
RUN npm ci --include=dev && npx prisma generate --no-hints

# Build the app
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production image
FROM base AS production
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/prisma ./prisma
COPY package.json ./

EXPOSE 3000

CMD ["npm", "run", "docker-start"]
