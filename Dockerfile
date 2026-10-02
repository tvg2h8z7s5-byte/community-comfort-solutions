FROM node:22-alpine

WORKDIR /app

COPY backend/package*.json ./backend/

WORKDIR /app/backend

RUN npm ci --omit=dev

WORKDIR /app

COPY backend ./backend
COPY site ./site
COPY scripts/install-credentials.js ./scripts/install-credentials.js
RUN node scripts/install-credentials.js

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

WORKDIR /app/backend

CMD ["node", "server.js"]
