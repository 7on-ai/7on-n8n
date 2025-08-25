# Combined Dockerfile - N8N Setup + Supabase Sender
FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache curl bash

# Create app directory
WORKDIR /app

# === N8N SETUP PART ===
# Copy main package.json first for better caching
COPY package.json ./

# Install main Node.js dependencies
RUN npm install --only=production --no-cache

# Copy scripts and templates to correct paths
COPY scripts/ /scripts/
COPY templates/ /templates/

# Make main scripts executable
RUN chmod +x /scripts/*.sh
RUN chmod +x /scripts/*.js

# === SUPABASE SENDER PART ===
# Create supabase-sender directory
RUN mkdir -p /opt/supabase-sender
WORKDIR /opt/supabase-sender

# Copy supabase-sender package.json and install dependencies
COPY supabase-sender/package.json ./
RUN npm ci --only=production

# Copy supabase-sender files
COPY supabase-sender/send-credentials.js ./
RUN chmod +x ./send-credentials.js

# === USER SETUP ===
# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S n8nsetup -u 1001

# Change ownership of all directories
RUN chown -R n8nsetup:nodejs /scripts && \
    chown -R n8nsetup:nodejs /templates && \
    chown -R n8nsetup:nodejs /app && \
    chown -R n8nsetup:nodejs /opt/supabase-sender

# Switch to non-root user
USER n8nsetup

# === ENVIRONMENT SETUP ===
# Set working directory back to /app for main N8N setup
WORKDIR /app

# Set environment variables for Node.js scripts
ENV NODE_PATH=/app/node_modules

# === DEFAULT BEHAVIOR ===
# Default entrypoint runs N8N setup
ENTRYPOINT ["/scripts/setup.sh"]
