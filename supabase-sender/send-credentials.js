#!/usr/bin/env node

// supabase-sender/send-credentials.js
const https = require('https');
const { URL } = require('url');

async function sendCredentialsToSupabase() {
    console.log('=== Starting Supabase Credentials Sender ===');
    
    // Extract environment variables
    const requiredVars = {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
        USER_ID: process.env.USER_ID,
        N8N_URL: process.env.N8N_URL,
        N8N_USER_EMAIL: process.env.N8N_USER_EMAIL,
        N8N_USER_PASSWORD: process.env.N8N_USER_PASSWORD,
        N8N_ENCRYPTION_KEY: process.env.N8N_ENCRYPTION_KEY,
        NORTHFLANK_PROJECT_ID: process.env.NORTHFLANK_PROJECT_ID,
        NORTHFLANK_PROJECT_NAME: process.env.NORTHFLANK_PROJECT_NAME
    };

    // Validate required environment variables
    console.log('Checking environment variables...');
    for (const [key, value] of Object.entries(requiredVars)) {
        if (!value) {
            console.error(`❌ Missing required environment variable: ${key}`);
            process.exit(1);
        }
        console.log(`✅ ${key}: ${key.includes('PASSWORD') || key.includes('KEY') ? '[HIDDEN]' : value}`);
    }

    // Prepare payload
    const payload = {
        id: requiredVars.USER_ID,
        n8n_url: requiredVars.N8N_URL,
        n8n_user_email: requiredVars.N8N_USER_EMAIL, 
        n8n_user_password: requiredVars.N8N_USER_PASSWORD,
        n8n_encryption_key: requiredVars.N8N_ENCRYPTION_KEY,
        northflank_project_id: requiredVars.NORTHFLANK_PROJECT_ID,
        northflank_project_name: requiredVars.NORTHFLANK_PROJECT_NAME,
        northflank_project_status: 'ready',
        template_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    console.log('Payload prepared:', {
        id: payload.id,
        n8n_url: payload.n8n_url,
        n8n_user_email: payload.n8n_user_email,
        northflank_project_id: payload.northflank_project_id,
        status: 'ready'
    });

    // Construct Supabase REST API URL
    const supabaseUrl = new URL(`/rest/v1/launchmvpfast-saas-starterkit_user`, requiredVars.SUPABASE_URL);
    supabaseUrl.searchParams.set('id', `eq.${requiredVars.USER_ID}`);

    console.log('Sending to Supabase URL:', supabaseUrl.href);

    // Prepare request options
    const requestData = JSON.stringify(payload);
    const options = {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${requiredVars.SUPABASE_SERVICE_ROLE_KEY}`,
            'apikey': requiredVars.SUPABASE_SERVICE_ROLE_KEY,
            'Prefer': 'return=representation',
            'Content-Length': Buffer.byteLength(requestData)
        }
    };

    // Send request using native https module
    return new Promise((resolve, reject) => {
        const req = https.request(supabaseUrl, options, (res) => {
            let responseData = '';
            
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            
            res.on('end', () => {
                console.log(`Response status: ${res.statusCode}`);
                console.log(`Response headers:`, res.headers);
                console.log(`Response body:`, responseData);
                
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log('✅ Successfully updated Supabase');
                    resolve(responseData);
                } else {
                    console.error('❌ Supabase update failed');
                    reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
                }
            });
        });

        req.on('error', (error) => {
            console.error('❌ Request failed:', error);
            reject(error);
        });

        req.on('timeout', () => {
            console.error('❌ Request timeout');
            reject(new Error('Request timeout'));
        });

        req.setTimeout(30000); // 30 seconds timeout
        req.write(requestData);
        req.end();
    });
}

async function main() {
    try {
        await sendCredentialsToSupabase();
        console.log('🎉 Credentials sent successfully!');
        process.exit(0);
    } catch (error) {
        console.error('💥 Failed to send credentials:', error);
        process.exit(1);
    }
}

// Run the main function
main();
