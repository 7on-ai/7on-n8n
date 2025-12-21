// scripts/activate-workflows.js
// ✅ Force activate ALL workflows that should be active

const axios = require('axios');

async function activateAllWorkflows() {
    const baseUrl = process.env.N8N_EDITOR_BASE_URL;
    const email = process.env.N8N_USER_EMAIL;
    const password = process.env.N8N_USER_PASSWORD;

    console.log('🔐 Logging in to N8N...');
    console.log(`📧 Email: ${email}`);
    console.log(`🔗 Base URL: ${baseUrl}`);

    if (!baseUrl || !email || !password) {
        throw new Error('Missing required environment variables');
    }

    try {
        // Login to N8N
        const loginResponse = await axios.post(`${baseUrl}/rest/login`, {
            emailOrLdapLoginId: email,
            password: password
        }, {
            timeout: 30000,
            headers: { 'Content-Type': 'application/json' }
        });

        if (loginResponse.status !== 200) {
            throw new Error(`Login failed with status: ${loginResponse.status}`);
        }

        const cookies = loginResponse.headers['set-cookie'];
        const cookieHeader = cookies?.join('; ') || '';
        
        console.log('✅ Successfully logged in to N8N\n');

        // Get all workflows
        console.log('📋 Fetching all workflows...');
        const workflowsResponse = await axios.get(`${baseUrl}/rest/workflows`, {
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cookieHeader
            },
            timeout: 30000
        });

        if (workflowsResponse.status !== 200) {
            throw new Error(`Failed to fetch workflows: ${workflowsResponse.status}`);
        }

        const workflows = workflowsResponse.data.data || workflowsResponse.data || [];
        console.log(`✅ Found ${workflows.length} workflows\n`);

        if (workflows.length === 0) {
            console.log('⚠️  No workflows found to activate');
            return;
        }

        let activatedCount = 0;
        let alreadyActiveCount = 0;
        let failedCount = 0;

        // Activate each workflow
        for (const workflow of workflows) {
            try {
                console.log(`🔍 Checking: ${workflow.name} (ID: ${workflow.id})`);
                
                // Check current status
                if (workflow.active === true) {
                    console.log(`   ✅ Already active\n`);
                    alreadyActiveCount++;
                    continue;
                }

                // ✅ Activate workflow
                console.log(`   🔄 Activating...`);
                const activateResponse = await axios.patch(
                    `${baseUrl}/rest/workflows/${workflow.id}`,
                    { active: true },
                    {
                        timeout: 30000,
                        headers: {
                            'Content-Type': 'application/json',
                            'Cookie': cookieHeader
                        }
                    }
                );

                if (activateResponse.status === 200) {
                    console.log(`   ✅ Successfully activated!\n`);
                    activatedCount++;
                } else {
                    console.log(`   ⚠️  Activation returned: ${activateResponse.status}\n`);
                    failedCount++;
                }
                
                // Small delay between activations
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (activateError) {
                console.error(`   ❌ Failed to activate:`, activateError.message);
                console.error(`      ${activateError.response?.data || ''}\n`);
                failedCount++;
            }
        }

        console.log('\n========================================');
        console.log('📊 Activation Summary:');
        console.log(`   ✅ Activated: ${activatedCount}`);
        console.log(`   ℹ️  Already active: ${alreadyActiveCount}`);
        console.log(`   ❌ Failed: ${failedCount}`);
        console.log(`   📋 Total: ${workflows.length}`);
        console.log('========================================\n');

        if (activatedCount > 0) {
            console.log('🎉 Workflows activated successfully!');
            console.log('   All active workflows are now published and ready to use.');
        }

    } catch (error) {
        console.error('❌ Error in activation process:', error.message);
        if (error.response) {
            console.error('📊 Response status:', error.response.status);
            console.error('📋 Response data:', JSON.stringify(error.response.data, null, 2));
        }
        throw error;
    }
}

// Main execution
activateAllWorkflows()
    .then(() => {
        console.log('🎉 Activation process completed');
        process.exit(0);
    })
    .catch(error => {
        console.error('💥 Failed to activate workflows:', error.message);
        process.exit(1);
    });