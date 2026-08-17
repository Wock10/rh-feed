FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY docs ./docs
RUN mkdir -p /app/data
ENV NODE_ENV=production
ENV PORT=8788
ENV CHAIN=robinhood
EXPOSE 8788
VOLUME ["/app/data"]
CMD ["node", "src/server.js"]
