#!/usr/bin/env node

// scripts/import-workflows.js
// ✅ FINAL VERSION - Verified and tested

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ===== CONFIGURATION =====
const CONFIG = {
    MAX_WORKFLOW_READY_RETRIES: 20,
    WORKFLOW_READY_CHECK_INTERVAL: 2000,
    MAX_ACTIVATION_RETRIES: 5,
    ACTIVATION_RETRY_DELAY: 3000,
    WEBHOOK_REGISTRATION_DELAY: 12000,  // 12 seconds for webhook registration
    POST_IMPORT_STABILIZATION_DELAY: 5000,
    POST_ACTIVATION_WAIT: 10000,  // 10 seconds after activation
    FINAL_VERIFICATION_RETRIES: 10,
    FINAL_VERIFICATION_INTERVAL: 3000
};

// ===== HELPER FUNCTIONS =====

async function loginToN8N(baseUrl) {
    const email = process.env.N8N_USER_EMAIL;
    const password = process.env.N8N_USER_PASSWORD;

    if (!email || !password) {
        throw new Error('Missing N8N credentials (N8N_USER_EMAIL or N8N_USER_PASSWORD)');
    }

    console.log('🔐 Logging into n8n...');
    console.log(`   Email: ${email}`);
    
    try {
        const response = await axios.post(
            `${baseUrl}/rest/login`,
            {
                emailOrLdapLoginId: email,
                password: password
            },
            {
                headers: { 'Content-Type': 'application/json' },
                validateStatus: () => true,
                maxRedirects: 0,
                timeout: 30000
            }
        );

        if (response.status !== 200) {
            throw new Error(`Login failed with status: ${response.status}`);
        }

        const cookies = response.headers['set-cookie'];
        if (!cookies || cookies.length === 0) {
            throw new Error('No cookies received from login');
        }

        console.log('✅ Login successful\n');
        return cookies.join('; ');
    } catch (error) {
        throw new Error(`Login error: ${error.message}`);
    }
}

async function waitForWorkflowReady(baseUrl, workflowId, cookies) {
    console.log('   ⏳ Waiting for workflow to be ready...');
    
    for (let attempt = 1; attempt <= CONFIG.MAX_WORKFLOW_READY_RETRIES; attempt++) {
        try {
            const response = await axios.get(
                `${baseUrl}/rest/workflows/${workflowId}`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Cookie': cookies
                    },
                    timeout: 15000,
                    validateStatus: () => true
                }
            );

            if (response.status === 200 && response.data?.data) {
                const workflow = response.data.data;
                
                const hasNodes = workflow.nodes && workflow.nodes.length > 0;
                const hasConnections = workflow.connections && Object.keys(workflow.connections).length > 0;
                const isInactive = workflow.active === false;
                
                if (hasNodes && hasConnections && isInactive) {
                    console.log(`   ✅ Workflow ready (attempt ${attempt}/${CONFIG.MAX_WORKFLOW_READY_RETRIES})`);
                    return { ready: true, workflow };
                }
            }
            
            console.log(`   ⌛ Not ready yet (attempt ${attempt}/${CONFIG.MAX_WORKFLOW_READY_RETRIES})`);
        } catch (error) {
            console.log(`   ⚠️  Check failed (attempt ${attempt}): ${error.message}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, CONFIG.WORKFLOW_READY_CHECK_INTERVAL));
    }
    
    return { ready: false, workflow: null };
}

function hasWebhookNodes(workflowData) {
    if (!workflowData.nodes) return false;
    
    return workflowData.nodes.some(node => 
        node.type === 'n8n-nodes-base.webhook' ||
        node.type === 'n8n-nodes-base.formtrigger' ||
        node.type === 'n8n-nodes-base.respondtowebhook'
    );
}

async function activateWorkflow(baseUrl, workflowId, cookies, hasWebhooks = false) {
    console.log('   🔄 Activating workflow...');
    
    if (hasWebhooks) {
        console.log(`   ⏰ Has webhooks - waiting ${CONFIG.WEBHOOK_REGISTRATION_DELAY/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, CONFIG.WEBHOOK_REGISTRATION_DELAY));
    }
    
    for (let attempt = 1; attempt <= CONFIG.MAX_ACTIVATION_RETRIES; attempt++) {
        try {
            console.log(`   📝 Activation attempt ${attempt}/${CONFIG.MAX_ACTIVATION_RETRIES}...`);
            
            // Method 1: Try PATCH (most reliable)
            const patchResponse = await axios.patch(
                `${baseUrl}/rest/workflows/${workflowId}`,
                { active: true },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Cookie': cookies
                    },
                    timeout: 30000,
                    validateStatus: () => true
                }
            );

            if (patchResponse.status === 200) {
                console.log('   ✅ Activated via PATCH!');
                return { success: true, method: 'patch' };
            }
            
            console.log(`   ⚠️  PATCH returned ${patchResponse.status}, trying POST /activate...`);
            
            // Method 2: Try POST /activate
            const activateResponse = await axios.post(
                `${baseUrl}/rest/workflows/${workflowId}/activate`,
                {},
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Cookie': cookies
                    },
                    timeout: 30000,
                    validateStatus: () => true
                }
            );

            if (activateResponse.status === 200) {
                console.log('   ✅ Activated via POST /activate!');
                return { success: true, method: 'activate' };
            }
            
            console.log(`   ❌ Both methods failed (PATCH: ${patchResponse.status}, POST: ${activateResponse.status})`);
            
        } catch (error) {
            console.log(`   ❌ Attempt ${attempt} error: ${error.message}`);
        }
        
        if (attempt < CONFIG.MAX_ACTIVATION_RETRIES) {
            const delay = CONFIG.ACTIVATION_RETRY_DELAY * attempt;
            console.log(`   ⏳ Retrying in ${delay/1000}s...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    return { success: false, method: null };
}

async function verifyWorkflowActive(baseUrl, workflowId, cookies) {
    console.log('   🔍 Verifying activation...');
    
    console.log(`   ⏰ Waiting ${CONFIG.POST_ACTIVATION_WAIT/1000}s for processing...`);
    await new Promise(resolve => setTimeout(resolve, CONFIG.POST_ACTIVATION_WAIT));
    
    for (let attempt = 1; attempt <= CONFIG.FINAL_VERIFICATION_RETRIES; attempt++) {
        try {
            const response = await axios.get(
                `${baseUrl}/rest/workflows/${workflowId}`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Cookie': cookies
                    },
                    timeout: 15000,
                    validateStatus: () => true
                }
            );

            if (response.status === 200 && response.data?.data) {
                const isActive = response.data.data.active === true;
                
                if (isActive) {
                    console.log(`   ✅ VERIFIED ACTIVE! (attempt ${attempt}/${CONFIG.FINAL_VERIFICATION_RETRIES})`);
                    return true;
                } else {
                    console.log(`   ⌛ Still inactive (attempt ${attempt}/${CONFIG.FINAL_VERIFICATION_RETRIES})`);
                }
            }
        } catch (error) {
            console.log(`   ⚠️  Verification error: ${error.message}`);
        }
        
        if (attempt < CONFIG.FINAL_VERIFICATION_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, CONFIG.FINAL_VERIFICATION_INTERVAL));
        }
    }
    
    console.log('   ❌ VERIFICATION FAILED - workflow not active');
    return false;
}

function cleanWorkflowForImport(workflowData) {
    const cleaned = { ...workflowData };
    
    delete cleaned.id;
    delete cleaned.createdAt;
    delete cleaned.updatedAt;
    delete cleaned.versionCounter;
    delete cleaned.shared;
    delete cleaned.scopes;
    delete cleaned.checksum;
    delete cleaned.triggerCount;
    delete cleaned.activeVersion;
    delete cleaned.parentFolder;
    
    cleaned.active = false;
    cleaned.pinData = cleaned.pinData || {};
    cleaned.staticData = null;
    cleaned.settings = cleaned.settings || { executionOrder: 'v1' };
    cleaned.tags = cleaned.tags || [];
    cleaned.meta = cleaned.meta || { templateCredsSetupCompleted: true };
    
    return cleaned;
}

// ===== MAIN IMPORT FUNCTION =====

async function importWorkflows() {
    const baseUrl = process.env.N8N_EDITOR_BASE_URL || 'http://localhost:5678';
    const templateSet = process.env.WORKFLOW_TEMPLATES || 'default';
    
    console.log('========================================');
    console.log('🔧 n8n Workflow Importer v2.0 (FINAL)');
    console.log('========================================');
    console.log(`n8n URL: ${baseUrl}`);
    console.log(`Template Set: ${templateSet}`);
    console.log('');

    const templateDir = templateSet === 'default' 
        ? '/templates/default-workflows'
        : '/templates/custom-workflows';

    console.log(`📁 Template directory: ${templateDir}`);

    if (!fs.existsSync(templateDir)) {
        console.log('⚠️  Template directory not found');
        return { success: true, imported: 0, published: 0 };
    }

    const files = fs.readdirSync(templateDir).filter(f => f.endsWith('.json'));
    
    if (files.length === 0) {
        console.log('⚠️  No workflow templates found');
        return { success: true, imported: 0, published: 0 };
    }

    console.log(`📦 Found ${files.length} workflow template(s)\n`);

    const cookies = await loginToN8N(baseUrl);

    let imported = 0;
    let published = 0;
    let failed = 0;

    for (const file of files) {
        try {
            const filePath = path.join(templateDir, file);
            console.log(`\n${'='.repeat(60)}`);
            console.log(`📄 Processing: ${file}`);
            console.log('─'.repeat(60));

            const rawData = fs.readFileSync(filePath, 'utf-8');
            const workflowData = JSON.parse(rawData);
            
            // Check activation flags
            const explicitActive = workflowData.active === true;
            const metaAutoActivate = workflowData.meta?.autoActivate === true;
            const shouldActivate = explicitActive || metaAutoActivate;
            
            const hasWebhooks = hasWebhookNodes(workflowData);

            // Debug output
            console.log(`   Name: ${workflowData.name || 'Untitled'}`);
            console.log(`   📋 Activation Analysis:`);
            console.log(`      • workflow.active = ${workflowData.active}`);
            console.log(`      • meta.autoActivate = ${workflowData.meta?.autoActivate}`);
            console.log(`      → Decision: ${shouldActivate ? '✅ WILL ACTIVATE' : '⏸️  STAY DRAFT'}`);
            console.log(`   🔗 Has webhooks: ${hasWebhooks ? 'Yes' : 'No'}`);

            // ===== STEP 1: Import =====
            console.log('\n   📥 Step 1: Importing workflow...');
            
            const cleanedWorkflow = cleanWorkflowForImport(workflowData);
            
            const importResponse = await axios.post(
                `${baseUrl}/rest/workflows`,
                cleanedWorkflow,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Cookie': cookies
                    },
                    timeout: 30000,
                    validateStatus: () => true
                }
            );

            if (importResponse.status !== 200 && importResponse.status !== 201) {
                throw new Error(`Import failed with status ${importResponse.status}`);
            }

            const workflowId = importResponse.data?.data?.id || importResponse.data?.id;
            if (!workflowId) {
                throw new Error('No workflow ID in response');
            }

            console.log(`   ✅ Imported (ID: ${workflowId})`);
            imported++;

            // ===== STEP 2: Stabilization =====
            console.log(`\n   ⏰ Step 2: Stabilization (${CONFIG.POST_IMPORT_STABILIZATION_DELAY/1000}s)...`);
            await new Promise(resolve => setTimeout(resolve, CONFIG.POST_IMPORT_STABILIZATION_DELAY));

            // ===== STEP 3: Check Ready =====
            console.log('\n   🔄 Step 3: Waiting for workflow to be ready...');
            const { ready } = await waitForWorkflowReady(baseUrl, workflowId, cookies);
            
            if (!ready) {
                console.log('   ⚠️  Timeout - imported as draft');
                continue;
            }

            // ===== STEP 4: Activate if needed =====
            if (shouldActivate) {
                console.log('\n   🚀 Step 4: Activating workflow...');
                console.log(`   ℹ️  Reason: ${explicitActive ? 'workflow.active=true' : 'meta.autoActivate=true'}`);
                
                const activationResult = await activateWorkflow(
                    baseUrl, 
                    workflowId, 
                    cookies, 
                    hasWebhooks
                );

                if (activationResult.success) {
                    const isActive = await verifyWorkflowActive(baseUrl, workflowId, cookies);
                    
                    if (isActive) {
                        console.log('\n   🎉 ✅ WORKFLOW PUBLISHED SUCCESSFULLY!\n');
                        published++;
                    } else {
                        console.log('\n   ⚠️  Activation completed but verification uncertain\n');
                    }
                } else {
                    console.log('\n   ❌ Activation failed - imported as draft\n');
                }
            } else {
                console.log('\n   ℹ️  Imported as draft (no activation flag)\n');
            }

        } catch (error) {
            console.error(`\n   ❌ ERROR: ${error.message}\n`);
            failed++;
        }
    }

    // ===== SUMMARY =====
    console.log('\n' + '='.repeat(60));
    console.log('📊 FINAL SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total workflows processed: ${files.length}`);
    console.log(`✅ Successfully imported: ${imported}`);
    console.log(`🚀 Successfully published: ${published}`);
    console.log(`❌ Failed: ${failed}`);
    console.log('='.repeat(60) + '\n');

    if (published > 0) {
        console.log('✅ SUCCESS: Workflows are PUBLISHED and ACTIVE!\n');
    } else if (imported > 0) {
        console.log('⚠️  WARNING: Workflows imported but NOT published\n');
    }

    return { 
        success: failed === 0, 
        imported, 
        published,
        failed 
    };
}

// ===== EXECUTION =====

if (require.main === module) {
    importWorkflows()
        .then(result => {
            if (result.published > 0) {
                console.log(`✅ SUCCESS: ${result.published} workflow(s) published!`);
                process.exit(0);
            } else if (result.imported > 0) {
                console.error('⚠️  Workflows imported but not published');
                process.exit(1);
            } else {
                console.error('❌ Import failed');
                process.exit(1);
            }
        })
        .catch(error => {
            console.error('💥 FATAL ERROR:', error.message);
            process.exit(1);
        });
}

module.exports = { importWorkflows };