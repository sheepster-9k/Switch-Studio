# Build on the CI host arch so Vite/rolldown native bindings are always available.
# The output is plain JS/CSS, so it runs on any target platform.
ARG BUILDPLATFORM
FROM --platform=$BUILDPLATFORM node:22-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/data ./data

RUN chown -R node:node /app

ENV HA_CONFIG_PATH=/homeassistant
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8878

EXPOSE 8878

USER node
CMD ["node", "dist/server/index.js"]
