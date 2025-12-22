// scripts/import-workflows.js
// ✅ FINAL FIX: ใช้ POST /activate เหมือน UI ทำ

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
    console.log(`📧 Email: ${email}`);
    console.log(`🔗 Base URL: ${baseUrl}`);

    if (!baseUrl || !email || !password || !userId) {
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

        let totalImported = 0;
        let totalPublished = 0;
        const workflowIdMap = {};
        
        // Import workflows from templates
        for (const template of workflowTemplates) {
            console.log(`📂 Processing template: ${template}`);
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

    } catch (error) {
        console.error('❌ Error in workflow import:', error.message);
        if (error.response) {
            console.error('Response:', error.response.status, error.response.data);
        }
        throw error;
    }
}

async function importWorkflowTemplate(baseUrl, templateName, cookieHeader, userId) {
    let importedCount = 0;
    let publishedCount = 0;
    const workflowIds = {};
    
    try {
        const templatePath = path.join('/templates', 
            templateName === 'default' ? 'default-workflows' : 'custom-workflows'
        );
        
        console.log(`📁 Template path: ${templatePath}`);
        
        if (!fs.existsSync(templatePath)) {
            console.log(`⚠️  Directory not found: ${templatePath}`);
            return { imported: 0, published: 0, workflowIds: {} };
        }

        const files = fs.readdirSync(templatePath).filter(file => file.endsWith('.json'));
        console.log(`📄 Found ${files.length} workflow files`);
        
        for (const file of files) {
            try {
                const workflowPath = path.join(templatePath, file);
                console.log(`\n📄 Processing: ${file}`);
                
                const workflowData = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
                
                if (!workflowData.nodes || !Array.isArray(workflowData.nodes)) {
                    console.log(`   ⚠️  Invalid workflow, skipping...`);
                    continue;
                }
                
                // Check if workflow should be published
                const shouldPublish = workflowData.active === true;
                
                // Handle cron workflows
                const isCronWorkflow = file.includes('cron') || 
                                     workflowData.tags?.includes('cron');
                
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
                    if (!workflowData.staticData) {
                        workflowData.staticData = {};
                    }
                    workflowData.staticData.userId = userId;
                    console.log(`   ✅ Injected userId`);
                }
                
                // ✅ STEP 1: Import workflow as DRAFT
                console.log(`   📥 Importing workflow...`);
                
                const importPayload = {
                    name: workflowData.name || file.replace('.json', ''),
                    nodes: workflowData.nodes,
                    connections: workflowData.connections || {},
                    active: false, // ✅ Always import as draft
                    settings: workflowData.settings || {},
                    staticData: workflowData.staticData || {},
                    tags: workflowData.tags || []
                };

                const importResponse = await axios.post(
                    `${baseUrl}/rest/workflows`,
                    importPayload,
                    {
                        timeout: 30000,
                        headers: {
                            'Content-Type': 'application/json',
                            'Cookie': cookieHeader
                        }
                    }
                );

                if (importResponse.status !== 200 && importResponse.status !== 201) {
                    console.log(`   ⚠️  Import failed: ${importResponse.status}`);
                    continue;
                }

                const workflowId = importResponse.data.data?.id || importResponse.data.id;
                console.log(`   ✅ Imported (ID: ${workflowId})`);
                importedCount++;
                
                // ✅ STEP 2: PUBLISH using /activate endpoint (exactly like UI)
                if (shouldPublish) {
                    console.log(`   🚀 Publishing workflow...`);
                    
                    // Wait for workflow to be ready
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    
                    try {
                        // ✅ USE POST /activate (same as UI does)
                        const activateResponse = await axios.post(
                            `${baseUrl}/rest/workflows/${workflowId}/activate`,
                            {}, // Empty body
                            {
                                timeout: 15000,
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Cookie': cookieHeader
                                }
                            }
                        );

                        if (activateResponse.status === 200) {
                            console.log(`   ✅ Published successfully!`);
                            publishedCount++;
                            
                            workflowIds[file] = {
                                id: workflowId,
                                name: workflowData.name,
                                published: true,
                                active: true
                            };
                        } else {
                            console.log(`   ⚠️  Publish returned: ${activateResponse.status}`);
                            workflowIds[file] = {
                                id: workflowId,
                                name: workflowData.name,
                                published: false,
                                needsManualPublish: true
                            };
                        }
                    } catch (publishError) {
                        console.error(`   ❌ Publish failed:`, publishError.message);
                        if (publishError.response) {
                            console.error(`      Status:`, publishError.response.status);
                            console.error(`      Data:`, JSON.stringify(publishError.response.data));
                        }
                        workflowIds[file] = {
                            id: workflowId,
                            name: workflowData.name,
                            published: false,
                            error: publishError.message
                        };
                    }
                } else {
                    workflowIds[file] = {
                        id: workflowId,
                        name: workflowData.name,
                        published: false,
                        intentionallyDraft: true
                    };
                }
                
                // Delay between workflows
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (fileError) {
                console.error(`   ❌ Error:`, fileError.message);
            }
        }
    } catch (error) {
        console.error(`❌ Template error:`, error.message);
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
        console.log('🎉 Workflow import completed');
        process.exit(0);
    })
    .catch(error => {
        console.error('💥 Import failed:', error.message);
        process.exit(1);
    });