#!/bin/bash
set -e

echo "=========================================="
echo "Starting N8N Setup Process (Neon Version)"
echo "=========================================="
echo "N8N Host: $N8N_HOST"
echo "N8N Base URL: $N8N_EDITOR_BASE_URL"
echo "User Email: $N8N_USER_EMAIL"
echo "First Name: $N8N_FIRST_NAME"
echo "Last Name: $N8N_LAST_NAME"
echo "Workflow Templates: $WORKFLOW_TEMPLATES"
echo "Project ID: $NORTHFLANK_PROJECT_ID"
echo "Project Name: $NORTHFLANK_PROJECT_NAME"
echo "Database: Neon PostgreSQL"
echo "=========================================="

# Wait for N8N to be fully ready
echo "⏳ Waiting for N8N to be ready..."
timeout=300
counter=0
while [ $counter -lt $timeout ]; do
    if curl -f -s "$N8N_EDITOR_BASE_URL/healthz" > /dev/null 2>&1; then
        echo "✅ N8N is ready!"
        break
    fi
    echo "⌛ Waiting for N8N... ($counter/$timeout seconds)"
    sleep 10
    counter=$((counter + 10))
done

if [ $counter -ge $timeout ]; then
    echo "❌ Timeout waiting for N8N to be ready"
    exit 1
fi

# ===== ✅ FIX: Get Postgres connection FIRST =====
echo ""
echo "=== STEP 0: GET DATABASE CONNECTION ==="

# Try EXTERNAL_POSTGRES_URI_ADMIN first (from addon credentials)
if [ -n "$EXTERNAL_POSTGRES_URI_ADMIN" ]; then
    POSTGRES_URI="$EXTERNAL_POSTGRES_URI_ADMIN"
    echo "✅ Using EXTERNAL_POSTGRES_URI_ADMIN"
elif [ -n "$POSTGRES_URI_ADMIN" ]; then
    POSTGRES_URI="$POSTGRES_URI_ADMIN"
    echo "✅ Using POSTGRES_URI_ADMIN"
elif [ -n "$DATABASE_URL" ]; then
    POSTGRES_URI="$DATABASE_URL"
    echo "✅ Using DATABASE_URL (Neon)"
else
    echo "❌ No database connection string found!"
    echo "Available env vars:"
    env | grep -i postgres || echo "  (none)"
    env | grep -i database || echo "  (none)"
    exit 1
fi

# Show connection (hide password)
SAFE_URI=$(echo "$POSTGRES_URI" | sed 's/:\/\/[^:]*:[^@]*@/:\/\/***:***@/')
echo "📝 Database: $SAFE_URI"

# ===== Initialize Database Schema =====
echo ""
echo "=== STEP 1: INITIALIZE DATABASE SCHEMA ==="
if bash /scripts/init-db.sh "$POSTGRES_URI"; then
    echo "✅ Database schema initialized successfully"
else
    echo "⚠️  Database initialization failed"
    echo "⚠️  Continuing anyway..."
fi

# Additional wait for database initialization
echo "⏳ Waiting for database to settle..."
sleep 10

# Step 2: Create N8N user
echo ""
echo "=== STEP 2: CREATE N8N USER ==="
if node /scripts/create-user.js; then
    echo "✅ N8N user created successfully"
else
    echo "❌ Failed to create N8N user"
    exit 1
fi

# Step 3: Import workflow templates
echo ""
echo "=== STEP 3: IMPORT WORKFLOW TEMPLATES ==="
if node /scripts/import-workflows.js; then
    echo "✅ Workflow templates imported successfully"
else
    echo "⚠️  Failed to import workflow templates (continuing...)"
fi

# Step 4: Store credentials to Neon
echo ""
echo "=== STEP 4: STORE CREDENTIALS TO NEON ==="
if node /scripts/neon-store.js; then
    echo "✅ Credentials stored in Neon database"
else
    echo "❌ Failed to store credentials in Neon"
    exit 1
fi

echo ""
echo "=========================================="
echo "🎉 N8N Setup Completed Successfully!"
echo "=========================================="
echo "N8N URL: $N8N_EDITOR_BASE_URL"
echo "Email: $N8N_USER_EMAIL"
echo "Password: $N8N_USER_PASSWORD"
echo "Name: $N8N_FIRST_NAME $N8N_LAST_NAME"
echo "Project: $NORTHFLANK_PROJECT_NAME ($NORTHFLANK_PROJECT_ID)"
echo "Database: Neon PostgreSQL"
echo "=========================================="
