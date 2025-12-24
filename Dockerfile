# Dockerfile - N8N Setup with Enhanced Import System
# Base: Node 18 Alpine for lightweight container
FROM node:18-alpine

# ===== Install System Dependencies =====
RUN apk add --no-cache \
    curl \
    bash \
    postgresql-client \
    ca-certificates

# ===== Setup Working Directory =====
WORKDIR /app

# ===== Copy Package Files First (for better caching) =====
COPY package*.json ./

# ===== Install Node Dependencies =====
RUN npm install --omit=dev --no-cache && \
    npm cache clean --force

# ===== Copy Scripts and Templates =====
COPY scripts/ /scripts/
COPY templates/ /templates/

# ===== Make Scripts Executable =====
RUN chmod +x /scripts/*.sh && \
    chmod +x /scripts/*.js

# ===== Create Non-Root User (Security Best Practice) =====
RUN addgroup -g 1001 -S nodejs && \
    adduser -S n8nsetup -u 1001 -G nodejs

# ===== Set Correct Permissions =====
RUN chown -R n8nsetup:nodejs /scripts && \
    chown -R n8nsetup:nodejs /templates && \
    chown -R n8nsetup:nodejs /app

# ===== Switch to Non-Root User =====
USER n8nsetup

# ===== Environment Variables =====
ENV NODE_PATH=/app/node_modules \
    NODE_ENV=production \
    PATH="/app/node_modules/.bin:$PATH"

# Environment variables that will be set at runtime:
# - N8N_EDITOR_BASE_URL
# - N8N_HOST
# - N8N_USER_EMAIL
# - N8N_USER_PASSWORD
# - N8N_ENCRYPTION_KEY
# - DATABASE_URL or POSTGRES_URI_ADMIN
# - WORKFLOW_TEMPLATES (default/custom)

# ===== Health Check =====
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f "${N8N_EDITOR_BASE_URL:-http://localhost:5678}/healthz" || exit 1

# ===== Default Entrypoint =====
ENTRYPOINT ["/scripts/setup.sh"]

# ===== Labels =====
LABEL maintainer="Your Team" \
      version="2.0.0" \
      description="N8N Setup Container with Enhanced Workflow Import" \
      org.opencontainers.image.source="https://github.com/yourusername/n8n-deployment"