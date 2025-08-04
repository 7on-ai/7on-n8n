FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache curl bash

# Set working directory
WORKDIR /app

# Copy package.json first for better caching
COPY package.json ./

# Install Node.js dependencies
RUN npm install --only=production --no-cache

# Copy scripts and templates
COPY scripts/ ./scripts/
COPY templates/ ./templates/

# Make scripts executable
RUN chmod +x ./scripts/*.sh

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Change ownership of app directory
RUN chown -R nextjs:nodejs /app
USER nextjs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Set the entrypoint
ENTRYPOINT ["/app/scripts/setup.sh"]
