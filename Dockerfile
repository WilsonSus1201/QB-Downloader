FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4173
ENV HOST=0.0.0.0
ENV DATA_DIR=/data
ENV CONTAINER_MODE=1
ENV DISABLE_DESKTOP_ACTIONS=1
ENV DOWNLOAD_ROOTS=Downloads=/downloads

COPY package.json ./
COPY server.js ./
COPY public ./public

RUN mkdir -p /data /downloads

EXPOSE 4173

CMD ["node", "server.js"]
