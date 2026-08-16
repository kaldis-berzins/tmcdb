# -----------------------------
# Build stage
# -----------------------------
FROM node:22-slim AS builder

WORKDIR /app

# Prisma needs OpenSSL on Debian slim images
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Generate SvelteKit's .svelte-kit/tsconfig.json etc.
RUN npx svelte-kit sync

# Generate Prisma client
RUN npx prisma generate

# Build SvelteKit app
RUN npm run build

# Remove dev dependencies for smaller production image
RUN npm prune --omit=dev


# -----------------------------
# Runtime stage
# -----------------------------
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Prisma schema and migrations are needed if running migrate deploy in container
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node build"]