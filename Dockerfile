# Dockerfile - แก้ไข paths และ structure
FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache curl bash

# Create app directory
WORKDIR /app

# Copy package.json first for better caching
COPY package.json ./

# Install Node.js dependencies
RUN npm install --only=production --no-cache

# Copy scripts and templates to correct paths
COPY scripts/ /scripts/
COPY templates/ /templates/

# Make scripts executable
RUN chmod +x /scripts/*.sh
RUN chmod +x /scripts/*.js

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S n8nsetup -u 1001

# Change ownership of directories
RUN chown -R n8nsetup:nodejs /scripts && \
    chown -R n8nsetup:nodejs /templates && \
    chown -R n8nsetup:nodejs /app

# Switch to non-root user
USER n8nsetup

# Set environment variables for Node.js scripts
ENV NODE_PATH=/app/node_modules

# Set the entrypoint to the correct path
ENTRYPOINT ["/scripts/setup.sh"]
