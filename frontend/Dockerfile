FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
# The existing lockfile has an optional peer version mismatch between
# autumn-js and better-auth. Keep the locked dependency versions in Docker.
RUN npm ci --legacy-peer-deps

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3001

CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "3001"]
