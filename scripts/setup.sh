#!/bin/bash
set -e

echo "=========================================="
echo "Starting N8N Setup Process"
echo "=========================================="
echo "N8N Base URL: $N8N_BASE_URL"
echo "User Email: $N8N_USER_EMAIL"
echo "User Name: $N8N_USER_NAME"
echo "Workflow Templates: $WORKFLOW_TEMPLATES"
echo "=========================================="

# Wait for N8N to be fully ready
echo "⏳ Waiting for N8N to be ready..."
timeout=300
counter=0
while [ $counter -lt $timeout ]; do
    if curl -f -s "$N8N_BASE_URL/healthz" > /dev/null 2>&1; then
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

# Additional wait for database initialization
echo "⏳ Waiting for database initialization..."
sleep 30

# Create N8N user
echo "👤 Creating N8N user..."
if node /app/scripts/create-user.js; then
    echo "✅ N8N user created successfully"
else
    echo "❌ Failed to create N8N user"
    exit 1
fi

# Import workflow templates
echo "📋 Importing workflow templates..."
if node /app/scripts/import-workflows.js; then
    echo "✅ Workflow templates imported successfully"
else
    echo "❌ Failed to import workflow templates"
    exit 1
fi

# Send success notification
echo "📬 Sending success notification..."
node /app/scripts/webhook-notify.js

echo "=========================================="
echo "�� N8N Setup Completed Successfully!"
echo "=========================================="
echo "N8N URL: $N8N_BASE_URL"
echo "Email: $N8N_USER_EMAIL"
echo "Password: $N8N_USER_PASSWORD"
echo "=========================================="
