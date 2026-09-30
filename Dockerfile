FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && mkdir /data && chown node:node /data
COPY --chown=node:node src ./src
USER node
ENV HOST=0.0.0.0 PORT=3000 TOKEN_FILE=/data/imweb-tokens.enc
EXPOSE 3000
CMD ["node", "src/index.js"]
