const axios = require('axios');

async function sendNotification() {
    const webhookUrl = process.env.WEBHOOK_URL;
    const userId = process.env.N8N_USER_ID;
    const email = process.env.N8N_USER_EMAIL;
    const password = process.env.N8N_USER_PASSWORD;
    const n8nUrl = process.env.N8N_BASE_URL;
    const userName = process.env.N8N_USER_NAME;

    console.log('📬 Preparing success notification...');
    console.log(`🔗 Webhook URL: ${webhookUrl ? 'Configured' : 'Not provided'}`);

    if (!webhookUrl) {
        console.log('ℹ️  No webhook URL provided, skipping notification');
        return;
    }

    const notificationData = {
        status: 'success',
        message: 'N8N setup completed successfully',
        timestamp: new Date().toISOString(),
        data: {
            userId,
            email,
            userName,
            password,
            n8nUrl,
            setupCompletedAt: new Date().toISOString(),
            version: '1.103.2'
        }
    };

    try {
        console.log('📤 Sending success notification...');
        
        const response = await axios.post(webhookUrl, notificationData, {
            timeout: 15000,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'N8N-Setup-Bot/1.0'
            }
        });

        if (response.status >= 200 && response.status < 300) {
            console.log('✅ Success notification sent successfully');
            console.log(`📊 Response status: ${response.status}`);
        } else {
            console.log(`⚠️  Notification sent but got unexpected status: ${response.status}`);
        }

    } catch (error) {
        console.error('❌ Failed to send notification:', error.message);
        
        if (error.response) {
            console.error('📊 Response status:', error.response.status);
            console.error('📋 Response data:', error.response.data);
        } else if (error.code === 'ECONNREFUSED') {
            console.error('🔌 Connection refused to webhook URL');
        } else if (error.code === 'ETIMEDOUT') {
            console.error('⏰ Webhook request timed out');
        }
        
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
        console.error('�� Notification process failed:', error.message);
        // Don't exit with error code for notification failures
        process.exit(0);
    });
