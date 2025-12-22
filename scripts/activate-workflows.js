// scripts/activate-workflows.js
// ✅ FIXED: Use proper publish endpoint for n8n new version

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

        let publishedCount = 0;
        let alreadyActiveCount = 0;
        let failedCount = 0;

        // ✅ NEW: Publish each workflow using correct endpoint
        for (const workflow of workflows) {
            try {
                console.log(`🔍 Checking: ${workflow.name} (ID: ${workflow.id})`);
                
                // Check if already active (published)
                if (workflow.active === true) {
                    console.log(`   ✅ Already published and active\n`);
                    alreadyActiveCount++;
                    continue;
                }

                // ✅ METHOD 1: Try using /activate endpoint (most direct)
                console.log(`   🔄 Publishing workflow...`);
                
                try {
                    const activateResponse = await axios.post(
                        `${baseUrl}/rest/workflows/${workflow.id}/activate`,
                        {},
                        {
                            timeout: 30000,
                            headers: {
                                'Content-Type': 'application/json',
                                'Cookie': cookieHeader
                            }
                        }
                    );

                    if (activateResponse.status === 200) {
                        console.log(`   ✅ Published via /activate endpoint!\n`);
                        publishedCount++;
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        continue;
                    }
                } catch (activateError) {
                    // If /activate doesn't exist, try PATCH method
                    if (activateError.response?.status === 404) {
                        console.log(`   ⚠️  /activate endpoint not found, trying PATCH...`);
                    } else {
                        throw activateError;
                    }
                }

                // ✅ METHOD 2: Use PATCH with active:true
                const patchResponse = await axios.patch(
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

                if (patchResponse.status === 200) {
                    console.log(`   ✅ Published via PATCH!\n`);
                    publishedCount++;
                } else {
                    console.log(`   ⚠️  PATCH returned: ${patchResponse.status}\n`);
                    failedCount++;
                }
                
                // Small delay between operations
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (workflowError) {
                console.error(`   ❌ Failed to publish:`, workflowError.message);
                if (workflowError.response) {
                    console.error(`      Status: ${workflowError.response.status}`);
                    console.error(`      Data:`, workflowError.response.data);
                }
                console.error('');
                failedCount++;
            }
        }

        console.log('\n========================================');
        console.log('📊 Publish Summary:');
        console.log(`   ✅ Published: ${publishedCount}`);
        console.log(`   ℹ️  Already active: ${alreadyActiveCount}`);
        console.log(`   ❌ Failed: ${failedCount}`);
        console.log(`   📋 Total: ${workflows.length}`);
        console.log('========================================\n');

        if (publishedCount > 0) {
            console.log('🎉 Workflows published successfully!');
            console.log('   All active workflows are now live.');
        }

        if (failedCount > 0) {
            console.warn(`⚠️  ${failedCount} workflows failed to publish`);
            console.warn('   You may need to publish them manually via UI');
        }

    } catch (error) {
        console.error('❌ Error in publish process:', error.message);
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
        console.log('🎉 Publish process completed');
        process.exit(0);
    })
    .catch(error => {
        console.error('💥 Failed to publish workflows:', error.message);
        process.exit(1);
    });