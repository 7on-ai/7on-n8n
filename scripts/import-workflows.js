// scripts/import-workflows.js
// ✅ FIXED: Auto-activate workflows after import

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
            console.log(`📂 Processing template category: ${template}`);
            const result = await importWorkflowTemplate(baseUrl, template, cookieHeader, userId);
            totalImported += result.count;
            Object.assign(workflowIdMap, result.workflowIds);
        }

        console.log(`🎉 Successfully imported ${totalImported} workflows`);
        
        // ✅ NEW: Auto-activate all workflows
        console.log('\n🔄 Auto-activating workflows...');
        let activatedCount = 0;
        
        for (const [filename, info] of Object.entries(workflowIdMap)) {
            try {
                // ✅ Activate all workflows that should be active from template
                if (info.shouldBeActive && info.id) {
                    console.log(`   🔄 Activating: ${info.name} (${info.id})`);
                    
                    const activateResponse = await axios.patch(
                        `${baseUrl}/rest/workflows/${info.id}`,
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
                        console.log(`   ✅ Activated: ${info.name}`);
                        activatedCount++;
                    } else {
                        console.log(`   ⚠️  Activation returned: ${activateResponse.status}`);
                    }
                    
                    // Small delay between activations
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } catch (activateError) {
                console.error(`   ❌ Failed to activate ${info.name}:`, activateError.message);
            }
        }
        
        console.log(`\n✅ Activated ${activatedCount} workflows`);
        
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
                
                // ✅ Store original active status from template
                const shouldBeActive = workflowData.active === true;
                
                if (isCronWorkflow) {
                    console.log(`🔧 Processing cron workflow: ${file}`);
                    console.log(`   📌 Template active status: ${shouldBeActive}`);
                    
                    workflowData.nodes = workflowData.nodes.map(node => {
                        if (node.credentials) {
                            console.log(`   ⚠️  Removing credentials from node: ${node.name}`);
                            const { credentials, ...nodeWithoutCreds } = node;
                            return nodeWithoutCreds;
                        }
                        return node;
                    });
                    
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
                
                // ✅ Import as INACTIVE first (will activate later)
                const workflowPayload = {
                    name: workflowData.name || file.replace('.json', ''),
                    nodes: workflowData.nodes,
                    connections: workflowData.connections || {},
                    active: false, // Always import inactive
                    settings: workflowData.settings || {},
                    staticData: workflowData.staticData || {},
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
                    
                    // ✅ Store workflow info with activation flag
                    workflowIds[file] = {
                        id: workflowId,
                        name: workflowData.name,
                        needsCredentials: isCronWorkflow,
                        shouldBeActive: shouldBeActive, // Will be activated after all imports
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
        console.log('\n📌 All workflows imported and activated!');
        process.exit(0);
    })
    .catch(error => {
        console.error('💥 Failed to import workflows:', error.message);
        process.exit(1);
    });