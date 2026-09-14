FROM node:20-slim

# better-sqlite3 için derleme araçları (prebuild yoksa)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Not: SQLite kalıcı depolaması Railway Volumes ile /data'ya mount edilir
# (Dockerfile VOLUME komutu Railway'de desteklenmez).

# HTTP dashboard (HTTP_PORT) ve Modbus TCP (PORT) portları
EXPOSE 8080
EXPOSE 5020

CMD ["npm", "start"]
