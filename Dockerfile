FROM node:20-slim

# ffmpeg-static bundles its own binary so no system ffmpeg needed
# but we need some libs for native Node modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev=false

COPY . .
RUN npm run build

# Make sure ffmpeg-static binary is executable
RUN chmod +x /app/node_modules/ffmpeg-static/ffmpeg || true
RUN chmod +x /app/node_modules/ffprobe-static/bin/linux/x64/ffprobe || true

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000

CMD ["npm", "start"]
