// scripts/import-workflows.js
// ✅ IMPROVED: Import AND publish workflows immediately

const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function importWorkflows() {
    const baseUrl = process.env.N8N_EDITOR_BASE_URL;
    const email = process.env.N8N_USER_EMAIL;
    const password = process.env.N8N_USER_PASSWORD;
    const userId = process.env.USER_ID;
    const workflowTemplates = process.env.WORKFLOW_TEMPLATES?.split(',') || ['default'];

    console.log('🔐 Logging in to N8N...');
    console.log(`📧 Using email: ${email}`);
    console.log(`🔗 Base URL: ${baseUrl}`);
    console.log(`👤 User ID: ${userId || 'NOT SET'}`);
    console.log(`📋 Templates to import: ${workflowTemplates.join(', ')}`);

    if (!baseUrl || !email || !password) {
        throw new Error('Missing required environment variables');
    }

    if (!userId) {
        throw new Error('Missing USER_ID environment variable');
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
        
        console.log('✅ Successfully logged in to N8N');

        let totalImported = 0;
        let totalPublished = 0;
        const workflowIdMap = {};
        
        // Import workflows from templates
        for (const template of workflowTemplates) {
            console.log(`📂 Processing template category: ${template}`);
            const result = await importWorkflowTemplate(baseUrl, template, cookieHeader, userId);
            totalImported += result.imported;
            totalPublished += result.published;
            Object.assign(workflowIdMap, result.workflowIds);
        }

        console.log(`\n========================================`);
        console.log(`📊 Import Summary:`);
        console.log(`   ✅ Imported: ${totalImported} workflows`);
        console.log(`   🚀 Published: ${totalPublished} workflows`);
        console.log(`========================================\n`);
        
        if (Object.keys(workflowIdMap).length > 0) {
            console.log('📋 Workflow Details:');
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

async function publishWorkflow(baseUrl, workflowId, cookieHeader) {
    try {
        // ✅ Try /activate endpoint first
        const activateResponse = await axios.post(
            `${baseUrl}/rest/workflows/${workflowId}/activate`,
            {},
            {
                timeout: 15000,
                headers: {
                    'Content-Type': 'application/json',
                    'Cookie': cookieHeader
                },
                validateStatus: (status) => status < 500
            }
        );

        if (activateResponse.status === 200) {
            return { success: true, method: 'activate' };
        }
    } catch (error) {
        // If /activate doesn't exist, continue to PATCH
    }

    // ✅ Fallback to PATCH method
    try {
        const patchResponse = await axios.patch(
            `${baseUrl}/rest/workflows/${workflowId}`,
            { active: true },
            {
                timeout: 15000,
                headers: {
                    'Content-Type': 'application/json',
                    'Cookie': cookieHeader
                }
            }
        );

        if (patchResponse.status === 200) {
            return { success: true, method: 'patch' };
        }
    } catch (error) {
        console.error(`Failed to publish: ${error.message}`);
        return { success: false, error: error.message };
    }

    return { success: false, error: 'All methods failed' };
}

async function importWorkflowTemplate(baseUrl, templateName, cookieHeader, userId) {
    let importedCount = 0;
    let publishedCount = 0;
    const workflowIds = {};
    
    try {
        const templatePath = path.join('/templates', 
            templateName === 'default' ? 'default-workflows' : 'custom-workflows'
        );
        
        console.log(`📁 Looking for templates in: ${templatePath}`);
        
        if (!fs.existsSync(templatePath)) {
            console.log(`⚠️  Template directory not found: ${templatePath}`);
            return { imported: 0, published: 0, workflowIds: {} };
        }

        const files = fs.readdirSync(templatePath).filter(file => file.endsWith('.json'));
        console.log(`📄 Found ${files.length} workflow files`);
        
        if (files.length === 0) {
            console.log('ℹ️  No workflow files found to import');
            return { imported: 0, published: 0, workflowIds: {} };
        }
        
        for (const file of files) {
            try {
                const workflowPath = path.join(templatePath, file);
                console.log(`\n📄 Processing: ${file}`);
                
                const workflowData = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
                
                if (!workflowData.nodes || !Array.isArray(workflowData.nodes)) {
                    console.log(`   ⚠️  Invalid workflow structure, skipping...`);
                    continue;
                }
                
                const isCronWorkflow = file.includes('cron') || 
                                     workflowData.tags?.includes('cron') ||
                                     workflowData.tags?.includes('session-processing');
                
                const shouldPublish = workflowData.active === true;
                
                if (isCronWorkflow) {
                    console.log(`   🔧 Cron workflow detected`);
                    
                    // Remove credentials
                    workflowData.nodes = workflowData.nodes.map(node => {
                        if (node.credentials) {
                            const { credentials, ...nodeWithoutCreds } = node;
                            return nodeWithoutCreds;
                        }
                        return node;
                    });
                    
                    // Inject userId
                    if (workflowData.staticData) {
                        if (workflowData.staticData.userId === "PLACEHOLDER_WILL_BE_REPLACED") {
                            workflowData.staticData.userId = userId;
                            console.log(`   ✅ Injected userId: ${userId}`);
                        }
                    } else {
                        workflowData.staticData = { userId: userId };
                        console.log(`   ✅ Created staticData with userId`);
                    }
                }
                
                // ✅ Import workflow (always as inactive first)
                console.log(`   📥 Importing...`);
                
                const workflowPayload = {
                    name: workflowData.name || file.replace('.json', ''),
                    nodes: workflowData.nodes,
                    connections: workflowData.connections || {},
                    active: false, // ✅ Import as inactive first
                    settings: workflowData.settings || {},
                    staticData: workflowData.staticData || {},
                    tags: workflowData.tags || []
                };

                const importResponse = await axios.post(
                    `${baseUrl}/rest/workflows`,
                    workflowPayload,
                    {
                        timeout: 30000,
                        headers: {
                            'Content-Type': 'application/json',
                            'Cookie': cookieHeader
                        }
                    }
                );

                if (importResponse.status === 200 || importResponse.status === 201) {
                    const workflowId = importResponse.data.data?.id || importResponse.data.id;
                    console.log(`   ✅ Imported successfully (ID: ${workflowId})`);
                    importedCount++;
                    
                    // ✅ Now publish if needed
                    if (shouldPublish) {
                        console.log(`   🚀 Publishing workflow...`);
                        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait before publish
                        
                        const publishResult = await publishWorkflow(baseUrl, workflowId, cookieHeader);
                        
                        if (publishResult.success) {
                            console.log(`   ✅ Published via ${publishResult.method}!`);
                            publishedCount++;
                            
                            workflowIds[file] = {
                                id: workflowId,
                                name: workflowData.name,
                                active: true,
                                published: true,
                                publishMethod: publishResult.method
                            };
                        } else {
                            console.warn(`   ⚠️  Failed to publish: ${publishResult.error}`);
                            workflowIds[file] = {
                                id: workflowId,
                                name: workflowData.name,
                                active: false,
                                published: false,
                                needsManualPublish: true
                            };
                        }
                    } else {
                        workflowIds[file] = {
                            id: workflowId,
                            name: workflowData.name,
                            active: false,
                            published: false,
                            intentionallyInactive: true
                        };
                    }
                } else {
                    console.log(`   ⚠️  Unexpected response: ${importResponse.status}`);
                }
                
                // Delay between imports
                await new Promise(resolve => setTimeout(resolve, 1500));
                
            } catch (fileError) {
                console.error(`   ❌ Error: ${fileError.message}`);
                if (fileError.response) {
                    console.error(`      Status:`, fileError.response.status);
                    console.error(`      Data:`, fileError.response.data);
                }
            }
        }
    } catch (error) {
        console.error(`❌ Error processing template ${templateName}:`, error.message);
    }
    
    return { 
        imported: importedCount, 
        published: publishedCount,
        workflowIds 
    };
}

// Main execution
importWorkflows()
    .then(() => {
        console.log('🎉 Workflow import & publish process completed');
        process.exit(0);
    })
    .catch(error => {
        console.error('💥 Process failed:', error.message);
        process.exit(1);
    });