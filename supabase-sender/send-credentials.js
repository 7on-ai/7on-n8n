#!/usr/bin/env node

// supabase-sender/send-credentials.js
const { createClient } = require('@supabase/supabase-js');

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

    // Initialize Supabase client
    const supabase = createClient(
        requiredVars.SUPABASE_URL, 
        requiredVars.SUPABASE_SERVICE_ROLE_KEY,
        {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        }
    );

    // Prepare payload
    const payload = {
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
        id: requiredVars.USER_ID,
        n8n_url: payload.n8n_url,
        n8n_user_email: payload.n8n_user_email,
        northflank_project_id: payload.northflank_project_id,
        status: 'ready'
    });

    try {
        // Update user record in Supabase
        const { data, error } = await supabase
            .from('launchmvpfast-saas-starterkit_user')
            .update(payload)
            .eq('id', requiredVars.USER_ID)
            .select();

        if (error) {
            console.error('❌ Supabase update failed:', error);
            throw error;
        }

        console.log('✅ Successfully updated Supabase');
        console.log('Response data:', data);
        return data;

    } catch (error) {
        console.error('❌ Failed to send credentials:', error);
        throw error;
    }
}

async function main() {
    try {
        await sendCredentialsToSupabase();
        console.log('🎉 Credentials sent successfully!');
        process.exit(0);
    } catch (error) {
        console.error('💥 Failed to send credentials:', error.message);
        process.exit(1);
    }
}

// Run the main function
main();
