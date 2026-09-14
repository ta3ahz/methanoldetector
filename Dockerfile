FROM node:20-slim

# better-sqlite3 için derleme araçları (prebuild yoksa)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# SQLite volume mount noktası
VOLUME ["/data"]

# HTTP portu (Railway PORT env ile override eder)
EXPOSE 3000

CMD ["npm", "start"]
