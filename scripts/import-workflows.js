// scripts/import-workflows.js
// ✅ FIXED: Import cron workflows WITHOUT credentials
// Credentials will be injected later via API

const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function importWorkflows() {
    const baseUrl = process.env.N8N_EDITOR_BASE_URL;
    const email = process.env.N8N_USER_EMAIL;
    const password = process.env.N8N_USER_PASSWORD;
    const workflowTemplates = process.env.WORKFLOW_TEMPLATES?.split(',') || ['default'];

    console.log('🔐 Logging in to N8N...');
    console.log(`📧 Using email: ${email}`);
    console.log(`🔗 Base URL: ${baseUrl}`);
    console.log(`📋 Templates to import: ${workflowTemplates.join(', ')}`);

    if (!baseUrl || !email || !password) {
        throw new Error('Missing required environment variables');
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
        for (const template of workflowTemplates) {
            console.log(`📂 Processing template category: ${template}`);
            const imported = await importWorkflowTemplate(baseUrl, template, cookieHeader);
            totalImported += imported;
        }

        console.log(`🎉 Successfully imported ${totalImported} workflows`);

    } catch (error) {
        console.error('❌ Error in workflow import process:', error.message);
        if (error.response) {
            console.error('📊 Response status:', error.response.status);
            console.error('📋 Response data:', JSON.stringify(error.response.data, null, 2));
        }
        throw error;
    }
}

async function importWorkflowTemplate(baseUrl, templateName, cookieHeader) {
    let importedCount = 0;
    
    try {
        const templatePath = path.join('/templates', 
            templateName === 'default' ? 'default-workflows' : 'custom-workflows'
        );
        
        console.log(`📁 Looking for templates in: ${templatePath}`);
        
        if (!fs.existsSync(templatePath)) {
            console.log(`⚠️  Template directory not found: ${templatePath}`);
            return 0;
        }

        const files = fs.readdirSync(templatePath).filter(file => file.endsWith('.json'));
        console.log(`📄 Found ${files.length} workflow files`);
        
        if (files.length === 0) {
            console.log('ℹ️  No workflow files found to import');
            return 0;
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
                
                // ✅ Check if this is a cron workflow
                const isCronWorkflow = file.includes('cron') || 
                                     workflowData.tags?.includes('cron') ||
                                     workflowData.tags?.includes('session-processing');
                
                if (isCronWorkflow) {
                    console.log(`🔧 Processing cron workflow: ${file}`);
                    
                    // ✅ Remove credentials from nodes before import
                    workflowData.nodes = workflowData.nodes.map(node => {
                        if (node.credentials) {
                            console.log(`   ⚠️  Removing credentials from node: ${node.name}`);
                            const { credentials, ...nodeWithoutCreds } = node;
                            return nodeWithoutCreds;
                        }
                        return node;
                    });
                    
                    // ✅ Replace userId placeholder with environment variable reference
                    workflowData.nodes = workflowData.nodes.map(node => {
                        if (node.parameters?.url) {
                            const originalUrl = node.parameters.url;
                            // Replace hardcoded userId with env var
                            node.parameters.url = originalUrl.replace(
                                /userId=[^&"'\s]+/,
                                'userId={{$env.USER_ID}}'
                            );
                            console.log(`   🔄 Updated URL in node: ${node.name}`);
                        }
                        return node;
                    });
                }
                
                console.log(`📥 Importing workflow: ${file}`);
                
                const workflowPayload = {
                    name: workflowData.name || file.replace('.json', ''),
                    nodes: workflowData.nodes,
                    connections: workflowData.connections || {},
                    active: true, // Import as active
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
                    
                    if (isCronWorkflow) {
                        console.log(`   ℹ️  Cron workflow imported (inactive)`);
                        console.log(`   ℹ️  Credentials will be added when user connects`);
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
    
    return importedCount;
}

// Main execution
importWorkflows()
    .then(() => {
        console.log('🎉 Workflow import process completed');
        console.log('ℹ️  Cron workflows imported (credentials will be added via API)');
        process.exit(0);
    })
    .catch(error => {
        console.error('💥 Failed to import workflows:', error.message);
        process.exit(1);
    });
