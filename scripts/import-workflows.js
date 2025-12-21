// scripts/import-workflows.js
// ✅ FIXED: Import workflows with active: true directly

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
        
        // Import workflows from templates
        for (const template of workflowTemplates) {
            console.log(`📂 Processing template category: ${template}`);
            const result = await importWorkflowTemplate(baseUrl, template, cookieHeader, userId);
            totalImported += result.count;
            Object.assign(workflowIdMap, result.workflowIds);
        }

        console.log(`\n🎉 Successfully imported ${totalImported} workflows`);
        
        if (Object.keys(workflowIdMap).length > 0) {
            console.log('\n📋 Workflow Summary:');
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
                
                if (!workflowData.nodes || !Array.isArray(workflowData.nodes)) {
                    console.log(`⚠️  Invalid workflow structure in ${file}, skipping...`);
                    continue;
                }
                
                const isCronWorkflow = file.includes('cron') || 
                                     workflowData.tags?.includes('cron') ||
                                     workflowData.tags?.includes('session-processing');
                
                // ✅ FIX: Get original active status from template
                const shouldBeActive = workflowData.active === true;
                
                if (isCronWorkflow) {
                    console.log(`🔧 Processing cron workflow: ${file}`);
                    console.log(`   📌 Will be imported as: ${shouldBeActive ? 'ACTIVE' : 'INACTIVE'}`);
                    
                    // Remove credentials
                    workflowData.nodes = workflowData.nodes.map(node => {
                        if (node.credentials) {
                            console.log(`   ⚠️  Removing credentials from node: ${node.name}`);
                            const { credentials, ...nodeWithoutCreds } = node;
                            return nodeWithoutCreds;
                        }
                        return node;
                    });
                    
                    // Inject userId into staticData
                    if (workflowData.staticData) {
                        if (workflowData.staticData.userId === "PLACEHOLDER_WILL_BE_REPLACED") {
                            workflowData.staticData.userId = userId;
                            console.log(`   ✅ Injected userId into staticData: ${userId}`);
                        }
                    } else {
                        workflowData.staticData = { userId: userId };
                        console.log(`   ✅ Created staticData with userId: ${userId}`);
                    }
                }
                
                console.log(`📥 Importing workflow: ${file}`);
                
                // ✅ KEY FIX: Import with correct active status from template
                const workflowPayload = {
                    name: workflowData.name || file.replace('.json', ''),
                    nodes: workflowData.nodes,
                    connections: workflowData.connections || {},
                    active: shouldBeActive, // ✅ Use original active status
                    settings: workflowData.settings || {},
                    staticData: workflowData.staticData || {},
                    tags: workflowData.tags || []
                };

                console.log(`   📌 Importing as: ${shouldBeActive ? 'ACTIVE ✅' : 'INACTIVE ⏸️'}`);

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
                    console.log(`   📍 Status: ${shouldBeActive ? 'ACTIVE ✅' : 'INACTIVE ⏸️'}`);
                    
                    workflowIds[file] = {
                        id: workflowId,
                        name: workflowData.name,
                        needsCredentials: isCronWorkflow,
                        active: shouldBeActive,
                        originalActiveStatus: workflowData.active,
                        hasUserId: !!workflowData.staticData?.userId
                    };
                    
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
        console.log('\n📌 Workflows imported with their original active status!');
        console.log('   ℹ️  Active workflows will run automatically');
        console.log('   ℹ️  Inactive workflows can be activated via API or UI later');
        process.exit(0);
    })
    .catch(error => {
        console.error('💥 Failed to import workflows:', error.message);
        process.exit(1);
    });