FROM node:18-alpine

# Install system dependencies including debugging tools
RUN apk add --no-cache \
    curl \
    bash \
    netcat-openbsd \
    postgresql-client \
    ca-certificates

# Set working directory
WORKDIR /

# Copy package.json first for better caching
COPY package.json ./

# Install Node.js dependencies
RUN npm install --only=production --no-cache

# Copy scripts and templates to correct locations
COPY scripts/ /scripts/
COPY templates/ /templates/

# Make scripts executable
RUN chmod +x /scripts/*.sh
RUN chmod +x /scripts/*.js

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Change ownership of directories
RUN chown -R nextjs:nodejs /scripts && \
    chown -R nextjs:nodejs /templates && \
    chown -R nextjs:nodejs /node_modules

# Switch to non-root user
USER nextjs

# Set the entrypoint
ENTRYPOINT ["/scripts/setup.sh"]
