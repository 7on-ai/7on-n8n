#!/bin/bash
set -e

echo "=========================================="
echo "Starting N8N Setup Process (Enhanced)"
echo "=========================================="
echo "N8N Host: $N8N_HOST"
echo "N8N Base URL: $N8N_EDITOR_BASE_URL"
echo "User Email: $N8N_USER_EMAIL"
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
    echo "❌ Timeout waiting for N8N"
    exit 1
fi

# Additional stability wait
echo "⏳ Waiting 15s for N8N to stabilize..."
sleep 15

# ===== Get Database Connection =====
echo ""
echo "=== STEP 0: GET DATABASE CONNECTION ==="

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
    exit 1
fi

SAFE_URI=$(echo "$POSTGRES_URI" | sed 's/:\/\/[^:]*:[^@]*@/:\/\/***:***@/')
echo "📝 Database: $SAFE_URI"

# ===== Initialize Database Schema =====
echo ""
echo "=== STEP 1: INITIALIZE DATABASE SCHEMA ==="
if bash /scripts/init-db.sh "$POSTGRES_URI"; then
    echo "✅ Database schema initialized"
else
    echo "⚠️  Database initialization failed"
fi

echo "⏳ Waiting for database to settle..."
sleep 10

# ===== Create N8N User =====
echo ""
echo "=== STEP 2: CREATE N8N USER ==="
if node /scripts/create-user.js; then
    echo "✅ N8N user created"
else
    echo "❌ Failed to create N8N user"
    exit 1
fi

# ✅ สำคัญ: รอให้ user account พร้อมก่อน import
echo "⏳ Waiting 10s for user account to be ready..."
sleep 10

# ===== Import & Activate Workflow Templates =====
echo ""
echo "=== STEP 3: IMPORT & ACTIVATE WORKFLOWS (ENHANCED) ==="
echo "📦 Using enhanced import script with:"
echo "   - Intelligent activation"
echo "   - Webhook detection"
echo "   - Robust retry logic"
echo "   - Verification system"
echo ""

if node /scripts/import-workflows.js; then
    echo "✅ Workflows imported and activated successfully"
else
    echo "⚠️  Some workflows may need manual activation"
    echo "ℹ️  Check logs above for details"
fi

# ===== Store to Neon =====
echo ""
echo "=== STEP 4: STORE CREDENTIALS TO NEON ==="
if node /scripts/neon-store.js; then
    echo "✅ Credentials stored in Neon database"
else
    echo "❌ Failed to store credentials"
    exit 1
fi

echo ""
echo "=========================================="
echo "🎉 N8N Setup Completed!"
echo "=========================================="
echo "N8N URL: $N8N_EDITOR_BASE_URL"
echo "Email: $N8N_USER_EMAIL"
echo "Password: $N8N_USER_PASSWORD"
echo ""
echo "📊 Workflow Status:"
echo "   Check logs above for import details"
echo "=========================================="