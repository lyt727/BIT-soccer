FROM node:22-alpine

WORKDIR /app

# 项目零运行时依赖，直接拷贝源码即可
COPY server ./server
COPY app ./app
COPY database ./database
COPY docs ./docs
COPY scripts ./scripts

ENV NODE_ENV=production
ENV PORT=3000

VOLUME ["/app/server/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server/src/index.js"]
