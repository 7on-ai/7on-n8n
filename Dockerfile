FROM node:18-alpine
# Install system dependencies
RUN apk add --no-cache curl bash
# Copy package.json first for better caching
COPY package.json ./
# Install Node.js dependencies
RUN npm install --only=production --no-cache
# Copy scripts and templates
COPY scripts/ /scripts/
COPY templates/ /templates/
# Make scripts executable
RUN chmod +x /scripts/*.sh
# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001
# Change ownership
RUN chown -R nextjs:nodejs /scripts && \
    chown -R nextjs:nodejs /templates
USER nextjs
# Set the entrypoint
ENTRYPOINT ["/scripts/setup.sh"]
