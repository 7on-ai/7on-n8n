# ใน folder: supabase-sender/Dockerfile
FROM node:18-alpine

# Install curl for backup method
RUN apk add --no-cache curl

WORKDIR /app

# Copy package files
COPY supabase-sender/package*.json ./
RUN npm ci --only=production

# Copy application files  
COPY supabase-sender/ ./

# Make script executable
RUN chmod +x ./send-credentials.js

# Set default command
CMD ["node", "send-credentials.js"]
