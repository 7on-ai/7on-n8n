// scripts/import-workflows.js
// ✅ ULTIMATE FIX: Activate IMMEDIATELY after each import

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
        const loginPayload = {
            emailOrLdapLoginId: email,
            password: password
        };

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

        let totalImported = 0;
        const workflowIdMap = {};
        
        for (const template of workflowTemplates) {
            console.log(`\n📂 Processing template category: ${template}`);
            const result = await importWorkflowTemplate(baseUrl, template, cookieHeader, userId);
            totalImported += result.count;
            Object.assign(workflowIdMap, result.workflowIds);
        }

        console.log(`\n🎉 Successfully imported ${totalImported} workflows`);
        
        if (Object.keys(workflowIdMap).length > 0) {
            console.log('\n📋 Workflow Summary:');
            for (const [filename, info] of Object.entries(workflowIdMap)) {
                const statusIcon = info.active ? '🟢' : '⏸️';
                console.log(`   ${statusIcon} ${info.name} (${info.id})`);
                console.log(`      - Status: ${info.active ? 'ACTIVE/PUBLISHED' : 'INACTIVE'}`);
                console.log(`      - Needs Credentials: ${info.needsCredentials ? 'Yes' : 'No'}`);
            }
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
                console.log(`\n📄 Processing: ${file}`);
                
                const workflowData = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
                
                if (!workflowData.nodes || !Array.isArray(workflowData.nodes)) {
                    console.log(`⚠️  Invalid workflow structure, skipping...`);
                    continue;
                }
                
                const isCronWorkflow = file.includes('cron') || 
                                     workflowData.tags?.includes('cron') ||
                                     workflowData.tags?.includes('session-processing');
                
                // ✅ Get original active status
                const shouldBeActive = workflowData.active === true;
                
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
                        }
                    } else {
                        workflowData.staticData = { userId: userId };
                    }
                    
                    console.log(`   ✅ Injected userId: ${userId}`);
                }
                
                // ✅ STEP 1: Import as INACTIVE first
                console.log(`   📥 Importing workflow...`);
                
                const workflowPayload = {
                    name: workflowData.name || file.replace('.json', ''),
                    nodes: workflowData.nodes,
                    connections: workflowData.connections || {},
                    active: false, // ← Always import inactive first
                    settings: workflowData.settings || {},
                    staticData: workflowData.staticData || {},
                    tags: workflowData.tags || []
                };

                const importResponse = await axios.post(`${baseUrl}/rest/workflows`, workflowPayload, {
                    timeout: 30000,
                    headers: {
                        'Content-Type': 'application/json',
                        'Cookie': cookieHeader
                    }
                });

                if (importResponse.status !== 200 && importResponse.status !== 201) {
                    console.log(`⚠️  Unexpected response: ${importResponse.status}`);
                    continue;
                }

                const workflowId = importResponse.data.data?.id || importResponse.data.id;
                
                if (!workflowId) {
                    console.log(`❌ No workflow ID returned`);
                    continue;
                }
                
                console.log(`   ✅ Imported: ID ${workflowId}`);

                let isActive = false;

                // ✅ STEP 2: Activate immediately if should be active
                if (shouldBeActive) {
                    console.log(`   🔄 Activating workflow...`);
                    
                    try {
                        // Small delay to ensure workflow is saved
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        
                        const activateResponse = await axios.patch(
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

                        if (activateResponse.status === 200) {
                            console.log(`   ✅ ACTIVATED & PUBLISHED! 🎉`);
                            isActive = true;
                        } else {
                            console.log(`   ⚠️  Activation response: ${activateResponse.status}`);
                        }
                    } catch (activateError) {
                        console.error(`   ❌ Activation failed:`, activateError.message);
                        if (activateError.response) {
                            console.error(`      Status: ${activateError.response.status}`);
                            console.error(`      Data:`, activateError.response.data);
                        }
                    }
                } else {
                    console.log(`   ℹ️  Workflow set to remain inactive`);
                }
                
                workflowIds[file] = {
                    id: workflowId,
                    name: workflowData.name,
                    needsCredentials: isCronWorkflow,
                    active: isActive,
                    originalActiveStatus: workflowData.active,
                    hasUserId: !!workflowData.staticData?.userId
                };
                
                importedCount++;
                
                // Small delay between imports
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (fileError) {
                console.error(`❌ Error with ${file}:`, fileError.message);
                if (fileError.response) {
                    console.error(`   Status:`, fileError.response.status);
                    console.error(`   Data:`, fileError.response.data);
                }
            }
        }
    } catch (error) {
        console.error(`❌ Template processing error:`, error.message);
    }
    
    return { count: importedCount, workflowIds };
}

// Main execution
importWorkflows()
    .then(() => {
        console.log('\n🎉 Workflow import & activation completed!');
        console.log('📌 All workflows with active:true are now PUBLISHED');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n💥 Import failed:', error.message);
        process.exit(1);
    });