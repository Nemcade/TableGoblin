FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4180 TABLE_GOBLIN_DATA=/data
COPY --from=build /app/dist ./dist
COPY --from=build /app/.server-runtime ./.server-runtime
COPY --from=build /app/scripts/room-server.cjs ./scripts/room-server.cjs
COPY --from=build /app/scripts/room-assets.cjs ./scripts/room-assets.cjs
COPY --from=build /app/scripts/room-media.cjs ./scripts/room-media.cjs
COPY --from=build /app/scripts/online-runtime.cjs ./scripts/online-runtime.cjs
COPY --from=build /app/scripts/dice-service.cjs ./scripts/dice-service.cjs
COPY --from=build /app/scripts/room-dice-worker.cjs ./scripts/room-dice-worker.cjs
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4180
CMD ["node", "scripts/room-server.cjs"]
