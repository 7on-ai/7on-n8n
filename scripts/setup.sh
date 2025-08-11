#!/bin/bash
set -e

echo "=========================================="
echo "Starting N8N Setup Process"
echo "=========================================="

# Debug: Print all relevant environment variables
echo "🔍 Environment Variables Debug:"
echo "N8N_BASE_URL: $N8N_BASE_URL"
echo "N8N_SERVICE_URL: $N8N_SERVICE_URL"
echo "ACTUAL_N8N_URL: $ACTUAL_N8N_URL"
echo "N8N_EDITOR_BASE_URL: $N8N_EDITOR_BASE_URL"

# Determine the correct N8N URL to use
FINAL_N8N_URL=""

if [ -n "$ACTUAL_N8N_URL" ]; then
    FINAL_N8N_URL="$ACTUAL_N8N_URL"
    echo "✅ Using ACTUAL_N8N_URL: $FINAL_N8N_URL"
elif [ -n "$N8N_SERVICE_URL" ]; then
    FINAL_N8N_URL="$N8N_SERVICE_URL"
    echo "✅ Using N8N_SERVICE_URL: $FINAL_N8N_URL"
elif [ -n "$N8N_BASE_URL" ]; then
    FINAL_N8N_URL="$N8N_BASE_URL"
    echo "⚠️  Using fallback N8N_BASE_URL: $FINAL_N8N_URL"
else
    echo "❌ No N8N URL found in environment variables"
    exit 1
fi

# Override N8N_BASE_URL with the correct URL
export N8N_BASE_URL="$FINAL_N8N_URL"

echo "=========================================="
echo "Final N8N URL: $N8N_BASE_URL"
echo "User Email: $N8N_USER_EMAIL"
echo "User Name: $N8N_USER_NAME"
echo "Workflow Templates: $WORKFLOW_TEMPLATES"
echo "Database Host: $DB_POSTGRESDB_HOST"
echo "=========================================="

# Wait for database to be ready first
echo "🗄️ Waiting for database to be ready..."
timeout=300
counter=0
while [ $counter -lt $timeout ]; do
    if nc -z "${DB_POSTGRESDB_HOST}" "${DB_POSTGRESDB_PORT}" 2>/dev/null; then
        echo "✅ Database is ready!"
        break
    fi
    echo "⌛ Waiting for database... ($counter/$timeout seconds)"
    sleep 10
    counter=$((counter + 10))
done

if [ $counter -ge $timeout ]; then
    echo "❌ Database timeout"
    exit 1
fi

# Wait for N8N service to be ready
echo "⏳ Waiting for N8N service to be ready..."
timeout=900  # 15 minutes
counter=0
health_check_url="$N8N_BASE_URL/healthz"

echo "🔍 Health check URL: $health_check_url"

while [ $counter -lt $timeout ]; do
    echo "⌛ Checking N8N health ($counter/$timeout seconds)"
    
    # Try main health endpoint
    if curl -f -s --connect-timeout 10 --max-time 30 "$health_check_url" > /dev/null 2>&1; then
        echo "✅ N8N health check passed!"
        break
    fi
    
    # Try root endpoint as fallback
    if curl -f -s --connect-timeout 10 --max-time 30 "$N8N_BASE_URL/" > /dev/null 2>&1; then
        echo "✅ N8N root endpoint responding!"
        # Wait a bit more for full initialization
        sleep 30
        break
    fi
    
    # Show detailed curl output every 60 seconds for debugging
    if [ $((counter % 60)) -eq 0 ] && [ $counter -gt 0 ]; then
        echo "🔍 Detailed check at $counter seconds:"
        curl -v --connect-timeout 10 --max-time 30 "$health_check_url" || true
        echo "---"
    fi
    
    sleep 15
    counter=$((counter + 15))
done

if [ $counter -ge $timeout ]; then
    echo "❌ Timeout waiting for N8N to be ready"
    echo "Last attempted URL: $health_check_url"
    echo "🔍 Final debug attempt:"
    curl -v --connect-timeout 10 --max-time 30 "$health_check_url" || true
    exit 1
fi

# Additional wait for full N8N initialization
echo "⏳ Waiting for N8N full initialization..."
sleep 60

# Verify readiness endpoint if available
readiness_url="$N8N_BASE_URL/healthz/readiness"
echo "🔍 Checking readiness endpoint: $readiness_url"
timeout=180
counter=0

while [ $counter -lt $timeout ]; do
    if curl -f -s --connect-timeout 5 --max-time 15 "$readiness_url" > /dev/null 2>&1; then
        echo "✅ N8N readiness check passed!"
        break
    fi
    echo "⌛ Waiting for N8N readiness... ($counter/$timeout seconds)"
    sleep 10
    counter=$((counter + 10))
done

# Create N8N user
echo "👤 Creating N8N user..."
echo "Using credentials: $N8N_USER_EMAIL / $N8N_USER_PASSWORD"

if node /app/scripts/create-user.js; then
    echo "✅ N8N user created successfully"
else
    echo "❌ Failed to create N8N user"
    echo "🔍 Debugging user creation failure..."
    
    # Try to get more info about N8N state
    echo "N8N health status:"
    curl -s "$N8N_BASE_URL/healthz" || echo "Health check failed"
    
    exit 1
fi

# Import workflow templates (non-critical)
echo "📋 Importing workflow templates..."
if node /app/scripts/import-workflows.js; then
    echo "✅ Workflow templates imported successfully"
else
    echo "⚠️  Failed to import workflow templates (continuing anyway)"
fi

# Send success notification
echo "📬 Sending success notification..."
if [ -n "$SETUP_WEBHOOK_URL" ]; then
    if node /app/scripts/webhook-notify.js; then
        echo "✅ Success notification sent"
    else
        echo "⚠️  Failed to send notification (non-critical)"
    fi
else
    echo "⚠️  No webhook URL provided, skipping notification"
fi

echo "=========================================="
echo "🎉 N8N Setup Completed Successfully!"
echo "=========================================="
echo "N8N URL: $N8N_BASE_URL"
echo "Email: $N8N_USER_EMAIL"
echo "Password: $N8N_USER_PASSWORD"
echo "Project ID: $NORTHFLANK_PROJECT_ID"
echo "=========================================="
