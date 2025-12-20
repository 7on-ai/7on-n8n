// scripts/import-workflows.js
// ✅ FIXED: Inject userId into staticData instead of URL

const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function importWorkflows() {
    const baseUrl = process.env.N8N_EDITOR_BASE_URL;
    const email = process.env.N8N_USER_EMAIL;
    const password = process.env.N8N_USER_PASSWORD;
    const userId = process.env.USER_ID; // ✅ Get userId from env
    const workflowTemplates = process.env.WORKFLOW_TEMPLATES?.split(',') || ['default'];

    console.log('🔐 Logging in to N8N...');
    console.log(`📧 Using email: ${email}`);
    console.log(`🔗 Base URL: ${baseUrl}`);
    console.log(`👤 User ID: ${userId || 'NOT SET'}`); // ✅ Log userId
    console.log(`📋 Templates to import: ${workflowTemplates.join(', ')}`);

    if (!baseUrl || !email || !password) {
        throw new Error('Missing required environment variables');
    }

    if (!userId) {
        throw new Error('Missing USER_ID environment variable');
    }

    try {
        const loginPayload = {
            emailOrLdapLoginId: email,
            password: password
        };

        // Login to get session cookie
        const loginResponse = await axios.post(`${baseUrl}/rest/login`, loginPayload, {
            timeout: 30000,
            headers: { 'Content-Type': 'application/json' }
        });

        if (loginResponse.status !== 200) {
            throw new Error(`Login failed with status: ${loginResponse.status}`);
        }

        const cookies = loginResponse.headers['set-cookie'];
        const cookieHeader = cookies?.join('; ') || '';
        
        console.log('✅ Successfully logged in to N8N');

        // Import each template category
        let totalImported = 0;
        const workflowIdMap = {};
        
        for (const template of workflowTemplates) {
            console.log(`📂 Processing template category: ${template}`);
            const result = await importWorkflowTemplate(baseUrl, template, cookieHeader, userId);
            totalImported += result.count;
            Object.assign(workflowIdMap, result.workflowIds);
        }

        console.log(`🎉 Successfully imported ${totalImported} workflows`);
        
        if (Object.keys(workflowIdMap).length > 0) {
            console.log('\n📋 Workflow IDs for credential injection:');
            console.log(JSON.stringify(workflowIdMap, null, 2));
        }

    } catch (error) {
        console.error('❌ Error in workflow import process:', error.message);
        if (error.response) {
            console.error('📊 Response status:', error.response.status);
            console.error('📋 Response data:', JSON.stringify(error.response.data, null, 2));
        }
        throw error;
    }
}

async function importWorkflowTemplate(baseUrl, templateName, cookieHeader, userId) {
    let importedCount = 0;
    const workflowIds = {};
    
    try {
        const templatePath = path.join('/templates', 
            templateName === 'default' ? 'default-workflows' : 'custom-workflows'
        );
        
        console.log(`📁 Looking for templates in: ${templatePath}`);
        
        if (!fs.existsSync(templatePath)) {
            console.log(`⚠️  Template directory not found: ${templatePath}`);
            return { count: 0, workflowIds: {} };
        }

        const files = fs.readdirSync(templatePath).filter(file => file.endsWith('.json'));
        console.log(`📄 Found ${files.length} workflow files`);
        
        if (files.length === 0) {
            console.log('ℹ️  No workflow files found to import');
            return { count: 0, workflowIds: {} };
        }
        
        for (const file of files) {
            try {
                const workflowPath = path.join(templatePath, file);
                console.log(`📄 Reading workflow file: ${workflowPath}`);
                
                const workflowData = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
                
                // Validate workflow structure
                if (!workflowData.nodes || !Array.isArray(workflowData.nodes)) {
                    console.log(`⚠️  Invalid workflow structure in ${file}, skipping...`);
                    continue;
                }
                
                // ✅ Check if this is a cron workflow or chat webhook
                const isCronWorkflow = file.includes('cron') || 
                                     workflowData.tags?.includes('cron') ||
                                     workflowData.tags?.includes('session-processing');
                
                const isChatWebhook = file.includes('chat-webhook');
                
                // ✅ Store original active status from template
                const shouldBeActive = workflowData.active === true;
                
                if (isCronWorkflow) {
                    console.log(`🔧 Processing cron workflow: ${file}`);
                    console.log(`   📌 Template active status: ${shouldBeActive}`);
                    
                    // ✅ Remove credentials from nodes before import
                    workflowData.nodes = workflowData.nodes.map(node => {
                        if (node.credentials) {
                            console.log(`   ⚠️  Removing credentials from node: ${node.name}`);
                            const { credentials, ...nodeWithoutCreds } = node;
                            return nodeWithoutCreds;
                        }
                        return node;
                    });
                    
                    // ✅ NEW: Inject userId into staticData
                    if (workflowData.staticData) {
                        if (workflowData.staticData.userId === "PLACEHOLDER_WILL_BE_REPLACED") {
                            workflowData.staticData.userId = userId;
                            console.log(`   ✅ Injected userId into staticData: ${userId}`);
                        }
                    } else {
                        // Create staticData if it doesn't exist
                        workflowData.staticData = { userId: userId };
                        console.log(`   ✅ Created staticData with userId: ${userId}`);
                    }
                    
                    // ✅ REMOVED: Old URL replacement code (no longer needed)
                    // The workflow now uses {{$workflow.staticData.userId}} which reads from staticData
                }
                
                console.log(`📥 Importing workflow: ${file}`);
                
                // ✅ IMPORTANT: Import as INACTIVE first (even if template says active)
                // We'll activate it after credential injection
                const workflowPayload = {
                    name: workflowData.name || file.replace('.json', ''),
                    nodes: workflowData.nodes,
                    connections: workflowData.connections || {},
                    active: false, // Always import as inactive first
                    settings: workflowData.settings || {},
                    staticData: workflowData.staticData || {}, // ✅ Include staticData
                    tags: workflowData.tags || []
                };

                const response = await axios.post(`${baseUrl}/rest/workflows`, workflowPayload, {
                    timeout: 30000,
                    headers: {
                        'Content-Type': 'application/json',
                        'Cookie': cookieHeader
                    }
                });

                if (response.status === 200 || response.status === 201) {
                    const workflowId = response.data.data?.id || response.data.id;
                    console.log(`✅ Successfully imported: ${file} (ID: ${workflowId})`);
                    
                    // Store workflow info for later credential injection
                    workflowIds[file] = {
                        id: workflowId,
                        name: workflowData.name,
                        needsCredentials: isCronWorkflow,
                        shouldBeActive: shouldBeActive,
                        originalActiveStatus: workflowData.active,
                        hasUserId: !!workflowData.staticData?.userId // ✅ Track if userId is set
                    };
                    
                    if (isCronWorkflow) {
                        console.log(`   ℹ️  Cron workflow imported (inactive)`);
                        console.log(`   📌 Will be activated after credentials are connected`);
                        console.log(`   📌 Original template active status: ${shouldBeActive}`);
                        console.log(`   📌 Static data userId: ${workflowData.staticData?.userId || 'NOT SET'}`);
                    } else if (shouldBeActive) {
                        // ✅ For non-cron workflows that should be active, activate immediately
                        try {
                            console.log(`   🔄 Activating workflow: ${file}`);
                            await axios.patch(
                                `${baseUrl}/rest/workflows/${workflowId}`,
                                { active: true },
                                {
                                    timeout: 30000,
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Cookie': cookieHeader
                                    }
                                }
                            );
                            console.log(`   ✅ Workflow activated successfully`);
                            
                            // ✅ NEW: Verify Chat Webhook activation
                            if (isChatWebhook) {
                                console.log('🔍 Verifying Chat Webhook activation...');
                                
                                // Wait 5 seconds for workflow to fully activate
                                await new Promise(resolve => setTimeout(resolve, 5000));
                                
                                const verifyResponse = await axios.get(
                                    `${baseUrl}/rest/workflows/${workflowId}`,
                                    {
                                        timeout: 30000,
                                        headers: {
                                            'Content-Type': 'application/json',
                                            'Cookie': cookieHeader
                                        }
                                    }
                                );
                                
                                if (verifyResponse.status === 200) {
                                    const verifiedWorkflow = verifyResponse.data.data || verifyResponse.data;
                                    if (verifiedWorkflow.active === true) {
                                        console.log('   ✅ Chat Webhook is ACTIVE and verified');
                                    } else {
                                        console.warn('   ⚠️  Chat Webhook imported but NOT ACTIVE after verification');
                                        console.warn('   📋 Verification response:', JSON.stringify(verifiedWorkflow, null, 2));
                                    }
                                } else {
                                    console.warn('   ⚠️  Could not verify Chat Webhook status');
                                }
                            }
                            
                        } catch (activateError) {
                            console.log(`   ⚠️  Could not activate workflow: ${activateError.message}`);
                            if (activateError.response) {
                                console.error('   📊 Response status:', activateError.response.status);
                                console.error('   📋 Response data:', activateError.response.data);
                            }
                        }
                    }
                    
                    importedCount++;
                } else {
                    console.log(`⚠️  Unexpected response for ${file}: ${response.status}`);
                }
                
                // Small delay between imports
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (fileError) {
                console.error(`❌ Error importing ${file}:`, fileError.message);
                if (fileError.response) {
                    console.error(`📊 Response status:`, fileError.response.status);
                    console.error(`📋 Response data:`, fileError.response.data);
                }
                // Continue with other files
            }
        }
    } catch (error) {
        console.error(`❌ Error processing template ${templateName}:`, error.message);
    }
    
    return { count: importedCount, workflowIds };
}

// Main execution
importWorkflows()
    .then(() => {
        console.log('🎉 Workflow import process completed');
        console.log('\n📌 Next Steps:');
        console.log('   1. User will create HTTP credentials via UI');
        console.log('   2. Call API to inject credentials into cron workflows');
        console.log('   3. Call API to activate cron workflows');
        process.exit(0);
    })
    .catch(error => {
        console.error('💥 Failed to import workflows:', error.message);
        process.exit(1);
    });