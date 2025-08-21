const axios = require('axios');

async function sendNotification() {
    // ใช้ตัวแปรที่ตรงกับ template n8n-secrets
    const webhookUrl = process.env.SETUP_WEBHOOK_URL;
    const webhookToken = process.env.WEBHOOK_AUTH_TOKEN || 'webhook-secret-token-7on';
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

    console.log('📬 Preparing success notification...');
    console.log(`🔗 Webhook URL: ${webhookUrl ? 'Configured' : 'Not provided'}`);
    console.log(`🔑 Webhook Token: ${webhookToken ? 'Configured' : 'Not provided'}`);
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

        // Add authorization header with webhook token (ไม่ใช่ Bearer format)
        if (webhookToken) {
            headers['Authorization'] = `Bearer ${webhookToken}`;
            console.log('🔑 Using webhook token authentication');
        }

        console.log('📋 Request headers:', JSON.stringify({
            ...headers,
            'Authorization': headers['Authorization'] ? 'Bearer ***' : 'Not set'
        }, null, 2));

        const response = await axios.post(webhookUrl, notificationData, {
            timeout: 30000, // เพิ่ม timeout เป็น 30 วินาที
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
        } else if (response.status === 401) {
            console.log('⚠️  Webhook authentication failed (401)');
            console.log('🔄 Attempting fallback notification...');
            await sendFallbackNotification(webhookUrl, notificationData);
        } else {
            console.log(`⚠️  Notification sent but got unexpected status: ${response.status}`);
            if (response.data) {
                console.log('📋 Response data:', JSON.stringify(response.data, null, 2));
            }
            
            // Try fallback for other 4xx errors
            if (response.status >= 400 && response.status < 500) {
                console.log('🔄 Attempting fallback notification for 4xx error...');
                await sendFallbackNotification(webhookUrl, notificationData);
            }
        }

    } catch (error) {
        console.error('❌ Failed to send notification:', error.message);
        
        if (error.response) {
            console.error('📊 Response status:', error.response.status);
            console.error('📋 Response data:', JSON.stringify(error.response.data, null, 2));
            
            // Try to send a fallback notification
            if (error.response.status === 401 || error.response.status === 403) {
                console.log('🔄 Trying fallback notification without auth...');
                await sendFallbackNotification(webhookUrl, notificationData);
            }
        } else if (error.code === 'ECONNREFUSED') {
            console.error('🔌 Connection refused to webhook URL');
            // Try fallback even for connection errors
            console.log('🔄 Attempting fallback notification despite connection error...');
            await sendFallbackNotification(webhookUrl, notificationData);
        } else if (error.code === 'ETIMEDOUT') {
            console.error('⏰ Webhook request timed out');
            console.log('🔄 Attempting fallback notification after timeout...');
            await sendFallbackNotification(webhookUrl, notificationData);
        }
        
        // Don't fail the entire setup for notification errors
        console.log('ℹ️  Continuing despite notification failure...');
    }
}

// Fallback notification without authentication
async function sendFallbackNotification(webhookUrl, originalData) {
    try {
        console.log('📤 Sending fallback notification...');
        
        // Try with minimal headers first
        const fallbackResponse = await axios.post(webhookUrl, originalData, {
            timeout: 15000,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'N8N-Setup-Bot/1.0'
            },
            validateStatus: function (status) {
                return status < 500;
            }
        });
        
        if (fallbackResponse.status >= 200 && fallbackResponse.status < 300) {
            console.log('✅ Fallback notification sent successfully');
            console.log(`📊 Fallback response status: ${fallbackResponse.status}`);
        } else {
            console.log(`⚠️  Fallback notification also failed: ${fallbackResponse.status}`);
            console.log('📋 Fallback response data:', JSON.stringify(fallbackResponse.data, null, 2));
            
            // Try alternative authentication methods
            if (fallbackResponse.status === 401) {
                console.log('🔄 Trying with alternative authentication...');
                await tryAlternativeAuth(webhookUrl, originalData);
            }
        }
        
    } catch (fallbackError) {
        console.error('❌ Fallback notification also failed:', fallbackError.message);
        
        // Last resort: try alternative authentication
        if (fallbackError.response?.status === 401) {
            console.log('🔄 Trying final alternative authentication...');
            await tryAlternativeAuth(webhookUrl, originalData);
        } else {
            // Log important data for manual processing
            console.log('📝 Setup completed with these details:');
            console.log(`   N8N URL: ${originalData.data.n8nUrl}`);
            console.log(`   User Email: ${originalData.data.email}`);
            console.log(`   Project ID: ${originalData.data.projectId}`);
            console.log(`   User ID: ${originalData.userId}`);
            console.log('   These details should be manually updated in the database if webhook failed');
        }
    }
}

// Try alternative authentication methods
async function tryAlternativeAuth(webhookUrl, originalData) {
    try {
        console.log('🔑 Trying alternative authentication with direct token...');
        const webhookToken = process.env.WEBHOOK_AUTH_TOKEN;
        
        if (!webhookToken) {
            console.log('⚠️  No webhook token available for alternative auth');
            return;
        }
        
        // Try direct token (no Bearer prefix)
        const altResponse = await axios.post(webhookUrl, originalData, {
            timeout: 15000,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'N8N-Setup-Bot/1.0',
                'Authorization': webhookToken, // Direct token without Bearer
                'X-Webhook-Token': webhookToken, // Alternative header
                'X-Auth-Token': webhookToken // Another alternative
            },
            validateStatus: function (status) {
                return status < 500;
            }
        });
        
        if (altResponse.status >= 200 && altResponse.status < 300) {
            console.log('✅ Alternative authentication successful');
            console.log(`📊 Alternative auth response status: ${altResponse.status}`);
        } else {
            console.log(`⚠️  Alternative authentication failed: ${altResponse.status}`);
            console.log('📋 Alt auth response data:', JSON.stringify(altResponse.data, null, 2));
        }
        
    } catch (altError) {
        console.error('❌ Alternative authentication failed:', altError.message);
        console.log('💡 All authentication methods exhausted');
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
