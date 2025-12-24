#!/bin/bash
# test-import.sh
# ✅ Script for testing workflow import locally

set -e

echo "=========================================="
echo "🧪 Testing Workflow Import System"
echo "=========================================="

# Check required environment variables
required_vars=(
    "N8N_EDITOR_BASE_URL"
    "N8N_USER_EMAIL"
    "N8N_USER_PASSWORD"
)

missing_vars=()
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        missing_vars+=("$var")
    fi
done

if [ ${#missing_vars[@]} -ne 0 ]; then
    echo "❌ Missing required environment variables:"
    printf '   - %s\n' "${missing_vars[@]}"
    echo ""
    echo "Please set these variables and try again:"
    echo "export N8N_EDITOR_BASE_URL=http://localhost:5678"
    echo "export N8N_USER_EMAIL=test@example.com"
    echo "export N8N_USER_PASSWORD=your-password"
    exit 1
fi

echo "✅ Environment variables checked"
echo ""

# Test n8n connectivity
echo "🔌 Testing n8n connection..."
if curl -f -s "$N8N_EDITOR_BASE_URL/healthz" > /dev/null; then
    echo "✅ n8n is accessible"
else
    echo "❌ Cannot connect to n8n at $N8N_EDITOR_BASE_URL"
    exit 1
fi
echo ""

# Test login
echo "🔐 Testing login..."
login_response=$(curl -s -X POST "$N8N_EDITOR_BASE_URL/rest/login" \
    -H "Content-Type: application/json" \
    -d "{\"emailOrLdapLoginId\":\"$N8N_USER_EMAIL\",\"password\":\"$N8N_USER_PASSWORD\"}")

if echo "$login_response" | grep -q "Set-Cookie"; then
    echo "✅ Login successful"
else
    echo "❌ Login failed"
    echo "Response: $login_response"
    exit 1
fi
echo ""

# List current workflows
echo "📋 Current workflows:"
curl -s "$N8N_EDITOR_BASE_URL/rest/workflows" \
    -H "Content-Type: application/json" \
    -H "Cookie: $(echo "$login_response" | grep -o 'n8n-auth=[^;]*')" \
    | jq -r '.data[] | "   - \(.name) (ID: \(.id), Active: \(.active))"' || echo "   (none)"
echo ""

# Check template files
echo "📁 Checking template files..."
template_dir="templates/default-workflows"
if [ ! -d "$template_dir" ]; then
    echo "❌ Template directory not found: $template_dir"
    exit 1
fi

template_files=$(find "$template_dir" -name "*.json" | wc -l)
echo "✅ Found $template_files template file(s)"
echo ""

# Validate JSON syntax
echo "✅ Validating JSON syntax..."
for file in "$template_dir"/*.json; do
    if [ -f "$file" ]; then
        filename=$(basename "$file")
        if jq empty "$file" 2>/dev/null; then
            echo "   ✅ $filename - Valid JSON"
            
            # Check required fields
            has_name=$(jq -r '.name' "$file")
            has_nodes=$(jq -r '.nodes | length' "$file")
            has_active=$(jq -r '.active' "$file")
            has_meta=$(jq -r '.meta' "$file")
            
            echo "      Name: $has_name"
            echo "      Nodes: $has_nodes"
            echo "      Active: $has_active"
            echo "      Meta: $(echo "$has_meta" | jq -c '.')"
            
            if [ "$has_active" == "false" ]; then
                echo "      ✅ Correctly set to inactive for import"
            else
                echo "      ⚠️  WARNING: active should be false for import"
            fi
        else
            echo "   ❌ $filename - Invalid JSON"
            jq empty "$file"
            exit 1
        fi
    fi
done
echo ""

# Run import
echo "🚀 Running import script..."
echo "=========================================="
echo ""

node scripts/import-workflows.js

echo ""
echo "=========================================="
echo "✅ Test completed!"
echo ""

# List workflows after import
echo "📋 Workflows after import:"
curl -s "$N8N_EDITOR_BASE_URL/rest/workflows" \
    -H "Content-Type: application/json" \
    -H "Cookie: $(echo "$login_response" | grep -o 'n8n-auth=[^;]*')" \
    | jq -r '.data[] | "   - \(.name) (ID: \(.id), Active: \(.active))"'

echo ""
echo "🎉 All tests passed!"