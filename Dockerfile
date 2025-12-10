# Dockerfile - N8N Setup with Neon Database
FROM node:18-alpine

# Install system dependencies (เพิ่ม postgresql-client)
RUN apk add --no-cache curl bash postgresql-client

# Create app directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package.json ./
RUN npm install --omit=dev --no-cache

# Copy scripts and templates
COPY scripts/ /scripts/
COPY templates/ /templates/

# Make scripts executable (รวม init-db.sh)
RUN chmod +x /scripts/*.sh
RUN chmod +x /scripts/*.js

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S n8nsetup -u 1001

# Change ownership
RUN chown -R n8nsetup:nodejs /scripts && \
    chown -R n8nsetup:nodejs /templates && \
    chown -R n8nsetup:nodejs /app

# Switch to non-root user
USER n8nsetup

# Set environment variables
ENV NODE_PATH=/app/node_modules

# Default entrypoint
ENTRYPOINT ["/scripts/setup.sh"]
