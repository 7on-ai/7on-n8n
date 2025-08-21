const axios = require('axios');

async function sendNotification() {
    // ใช้ตัวแปรที่ตรงกับ template n8n-secrets
    const webhookUrl = process.env.SETUP_WEBHOOK_URL;
    const email = process.env.N8N_USER_EMAIL;
    const password = process.env.N8N_USER_PASSWORD;
    const n8nUrl = process.env.N8N_EDITOR_BASE_URL;
    const firstName = process.env.N8N_FIRST_NAME;
    const lastName = process.env.N8N_LAST_NAME;
    const fullName = `${firstName} ${lastName}`.trim();
    const projectId = process.env.NORTHFLANK_PROJECT_ID;
    const projectName = process.env.NORTHFLANK_PROJECT_NAME;
    const userId = process.env.N8N_USER_ID || process.env.USER_ID;
    const encryptionKey = process.env.N8N_ENCRYPTION_KEY;
    
    // ใช้ Supabase Service Role Key แทน webhook token
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    console.log('📬 Preparing success notification...');
    console.log(`🔗 Webhook URL: ${webhookUrl ? 'Configured' : 'Not provided'}`);
    console.log(`🔑 Service Role Key: ${serviceRoleKey ? 'Configured' : 'Not provided'}`);
    console.log(`👤 User: ${fullName} (${email})`);
    console.log(`🔗 N8N URL: ${n8nUrl}`);
    console.log(`🆔 User ID: ${userId}`);
    console.log(`🏗️ Project: ${projectName} (${projectId})`);

    if (!webhookUrl) {
        console.log('ℹ️  No webhook URL provided, skipping notification');
        return;
    }

    const notificationData = {
        status: 'success',
        message: 'N8N setup completed successfully',
        timestamp: new Date().toISOString(),
        userId: userId,
        data: {
            email,
            firstName,
            lastName,
            fullName,
            password,
            n8nUrl,
            projectId,
            projectName,
            encryptionKey,
            setupCompletedAt: new Date().toISOString(),
            n8nVersion: '1.103.2'
        }
    };

    try {
        console.log('📤 Sending success notification...');
        console.log('📋 Notification payload:', JSON.stringify({
            ...notificationData,
            data: {
                ...notificationData.data,
                password: '***' // Hide password in log
            }
        }, null, 2));
        
        const headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'N8N-Setup-Bot/1.0'
        };

        // ใช้ Supabase Service Role Key สำหรับ authentication
        if (serviceRoleKey) {
            headers['Authorization'] = `Bearer ${serviceRoleKey}`;
            headers['apikey'] = serviceRoleKey;
            console.log('🔑 Using Supabase Service Role Key authentication');
        } else {
            console.log('⚠️  No Service Role Key available');
        }

        console.log('📋 Request headers:', JSON.stringify({
            ...headers,
            'Authorization': headers['Authorization'] ? 'Bearer ***' : 'Not set',
            'apikey': headers['apikey'] ? '***' : 'Not set'
        }, null, 2));

        const response = await axios.post(webhookUrl, notificationData, {
            timeout: 30000,
            headers: headers,
            validateStatus: function (status) {
                return status < 500; // Don't throw for 4xx errors
            }
        });

        if (response.status >= 200 && response.status < 300) {
            console.log('✅ Success notification sent successfully');
            console.log(`📊 Response status: ${response.status}`);
            if (response.data) {
                console.log('📋 Response data:', JSON.stringify(response.data, null, 2));
            }
        } else {
            console.log(`⚠️  Notification sent but got unexpected status: ${response.status}`);
            if (response.data) {
                console.log('📋 Response data:', JSON.stringify(response.data, null, 2));
            }
            
            // For debugging - log the full response
            console.log('🐛 Full response for debugging:', {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
                data: response.data
            });
        }

    } catch (error) {
        console.error('❌ Failed to send notification:', error.message);
        
        if (error.response) {
            console.error('📊 Response status:', error.response.status);
            console.error('📋 Response data:', JSON.stringify(error.response.data, null, 2));
            console.error('📋 Response headers:', error.response.headers);
        } else if (error.code === 'ECONNREFUSED') {
            console.error('🔌 Connection refused to webhook URL');
        } else if (error.code === 'ETIMEDOUT') {
            console.error('⏰ Webhook request timed out');
        } else if (error.code === 'ENOTFOUND') {
            console.error('🌐 DNS resolution failed for webhook URL');
        }
        
        // Log important data for manual processing
        console.log('📝 Setup completed with these details:');
        console.log(`   N8N URL: ${n8nUrl}`);
        console.log(`   User Email: ${email}`);
        console.log(`   Project ID: ${projectId}`);
        console.log(`   User ID: ${userId}`);
        console.log('   These details should be manually updated in the database if webhook failed');
        
        // Don't fail the entire setup for notification errors
        console.log('ℹ️  Continuing despite notification failure...');
    }
}

// Main execution
sendNotification()
    .then(() => {
        console.log('📬 Notification process completed');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Notification process failed:', error.message);
        // Don't exit with error code for notification failures
        console.log('ℹ️  Exiting gracefully despite notification failure');
        process.exit(0);
    });
