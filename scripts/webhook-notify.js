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

    console.log('📬 Preparing success notification...');
    console.log(`🔗 Webhook URL: ${webhookUrl ? 'Configured' : 'Not provided'}`);
    console.log(`👤 User: ${fullName} (${email})`);
    console.log(`🔗 N8N URL: ${n8nUrl}`);

    if (!webhookUrl) {
        console.log('ℹ️  No webhook URL provided, skipping notification');
        return;
    }

    const notificationData = {
        status: 'success',
        message: 'N8N setup completed successfully',
        timestamp: new Date().toISOString(),
        data: {
            email,
            firstName,
            lastName,
            fullName,
            password,
            n8nUrl,
            projectId,
            projectName,
            setupCompletedAt: new Date().toISOString(),
            n8nVersion: '1.103.2'
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
        console.error('❌ Notification process failed:', error.message);
        // Don't exit with error code for notification failures
        process.exit(0);
    });
