#!/usr/bin/env node

// scripts/import-workflows.js
// ✅ IMPROVED: Enhanced import with robust activation logic

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ===== CONFIGURATION =====
const CONFIG = {
    MAX_WORKFLOW_READY_RETRIES: 15,
    WORKFLOW_READY_CHECK_INTERVAL: 2000,
    MAX_ACTIVATION_RETRIES: 5,
    ACTIVATION_RETRY_DELAY: 3000,
    WEBHOOK_REGISTRATION_DELAY: 8000,
    POST_IMPORT_STABILIZATION_DELAY: 5000
};

// ===== HELPER FUNCTIONS =====

/**
 * Login to n8n and get session cookies
 */
async function loginToN8N(baseUrl) {
    const email = process.env.N8N_USER_EMAIL;
    const password = process.env.N8N_USER_PASSWORD;

    if (!email || !password) {
        throw new Error('Missing N8N credentials (N8N_USER_EMAIL or N8N_USER_PASSWORD)');
    }

    console.log('🔐 Logging into n8n...');
    
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

/**
 * Wait for workflow to be ready after import
 */
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
                
                // ตรวจสอบว่า workflow มีข้อมูลครบถ้วน
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

/**
 * Check if workflow has webhook nodes
 */
function hasWebhookNodes(workflowData) {
    if (!workflowData.nodes) return false;
    
    return workflowData.nodes.some(node => 
        node.type === 'n8n-nodes-base.webhook' ||
        node.type === 'n8n-nodes-base.formtrigger' ||
        node.type === 'n8n-nodes-base.respondtowebhook'
    );
}

/**
 * Activate workflow with retry logic
 */
async function activateWorkflow(baseUrl, workflowId, cookies, hasWebhooks = false) {
    console.log('   🔄 Activating workflow...');
    
    // ถ้ามี webhook ให้รอนานขึ้นเพื่อให้ลงทะเบียนเสร็จ
    if (hasWebhooks) {
        console.log('   ⏰ Workflow has webhooks - waiting for registration...');
        await new Promise(resolve => setTimeout(resolve, CONFIG.WEBHOOK_REGISTRATION_DELAY));
    }
    
    for (let attempt = 1; attempt <= CONFIG.MAX_ACTIVATION_RETRIES; attempt++) {
        try {
            // Method 1: Try POST /activate endpoint
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
                console.log('   ✅ Activated successfully via /activate endpoint!');
                return { success: true, method: 'activate' };
            }
            
            // Method 2: If /activate fails, try PATCH
            console.log(`   ⚠️  /activate returned ${activateResponse.status}, trying PATCH...`);
            
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
                console.log('   ✅ Activated successfully via PATCH!');
                return { success: true, method: 'patch' };
            }
            
            console.log(`   ❌ Attempt ${attempt} failed: ${patchResponse.status}`);
            
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

/**
 * Verify workflow is actually active
 */
async function verifyWorkflowActive(baseUrl, workflowId, cookies) {
    console.log('   🔍 Verifying activation...');
    
    try {
        const response = await axios.get(
            `${baseUrl}/rest/workflows/${workflowId}`,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Cookie': cookies
                },
                timeout: 15000
            }
        );

        if (response.status === 200 && response.data?.data?.active === true) {
            console.log('   ✅ Activation verified!');
            return true;
        }
        
        console.log('   ⚠️  Workflow not active after activation attempt');
        return false;
    } catch (error) {
        console.log(`   ⚠️  Verification failed: ${error.message}`);
        return false;
    }
}

/**
 * Clean workflow JSON for import
 */
function cleanWorkflowForImport(workflowData) {
    const cleaned = { ...workflowData };
    
    // ลบ fields ที่ไม่ควรมีตอน import
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
    
    // ตั้งค่า fields ที่จำเป็น
    cleaned.active = false;  // สำคัญ! ต้อง import เป็น draft ก่อน
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
    console.log('🔧 n8n Workflow Importer (Enhanced)');
    console.log('========================================');
    console.log(`n8n URL: ${baseUrl}`);
    console.log(`Template Set: ${templateSet}`);
    console.log('');

    // Determine template directory
    const templateDir = templateSet === 'default' 
        ? '/templates/default-workflows'
        : '/templates/custom-workflows';

    console.log(`📁 Template directory: ${templateDir}`);

    if (!fs.existsSync(templateDir)) {
        console.log('⚠️  Template directory not found, skipping workflow import');
        return { success: true, imported: 0, published: 0 };
    }

    const files = fs.readdirSync(templateDir).filter(f => f.endsWith('.json'));
    
    if (files.length === 0) {
        console.log('⚠️  No workflow templates found');
        return { success: true, imported: 0, published: 0 };
    }

    console.log(`📦 Found ${files.length} workflow template(s)\n`);

    // Login to n8n
    const cookies = await loginToN8N(baseUrl);

    let imported = 0;
    let published = 0;
    let failed = 0;

    // Process each workflow
    for (const file of files) {
        try {
            const filePath = path.join(templateDir, file);
            console.log(`\n${'='.repeat(60)}`);
            console.log(`📄 Processing: ${file}`);
            console.log('─'.repeat(60));

            // Read and parse workflow
            const rawData = fs.readFileSync(filePath, 'utf-8');
            const workflowData = JSON.parse(rawData);
            
            // Check if should activate
            const shouldActivate = workflowData.active === true || 
                                 workflowData.meta?.autoActivate === true;
            
            const hasWebhooks = hasWebhookNodes(workflowData);

            console.log(`   Name: ${workflowData.name || 'Untitled'}`);
            console.log(`   Should activate: ${shouldActivate ? 'Yes' : 'No'}`);
            console.log(`   Has webhooks: ${hasWebhooks ? 'Yes' : 'No'}`);

            // ===== STEP 1: Import workflow =====
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
                throw new Error(`Import failed: ${importResponse.status} - ${JSON.stringify(importResponse.data)}`);
            }

            const workflowId = importResponse.data?.data?.id || importResponse.data?.id;
            if (!workflowId) {
                throw new Error('No workflow ID returned from import');
            }

            console.log(`   ✅ Imported successfully (ID: ${workflowId})`);
            imported++;

            // ===== STEP 2: Stabilization delay =====
            console.log(`\n   ⏰ Step 2: Stabilization delay (${CONFIG.POST_IMPORT_STABILIZATION_DELAY/1000}s)...`);
            await new Promise(resolve => setTimeout(resolve, CONFIG.POST_IMPORT_STABILIZATION_DELAY));

            // ===== STEP 3: Wait for workflow ready =====
            console.log('\n   🔄 Step 3: Checking workflow readiness...');
            const { ready, workflow } = await waitForWorkflowReady(baseUrl, workflowId, cookies);
            
            if (!ready) {
                console.log('   ⚠️  Workflow not ready, but imported as draft');
                continue;
            }

            // ===== STEP 4: Activate if needed =====
            if (shouldActivate) {
                console.log('\n   🚀 Step 4: Activating workflow...');
                
                const activationResult = await activateWorkflow(
                    baseUrl, 
                    workflowId, 
                    cookies, 
                    hasWebhooks
                );

                if (activationResult.success) {
                    // Verify activation
                    const isActive = await verifyWorkflowActive(baseUrl, workflowId, cookies);
                    
                    if (isActive) {
                        console.log('   🎉 Workflow published successfully!');
                        published++;
                    } else {
                        console.log('   ⚠️  Activation may have failed - please check manually');
                    }
                } else {
                    console.log('   ❌ Activation failed - workflow imported as draft');
                }
            } else {
                console.log('\n   ℹ️  Workflow imported as draft (activation not requested)');
            }

        } catch (error) {
            console.error(`\n   ❌ Error processing ${file}:`, error.message);
            if (error.response) {
                console.error('   Response:', JSON.stringify(error.response.data, null, 2));
            }
            failed++;
        }
    }

    // ===== SUMMARY =====
    console.log('\n' + '='.repeat(60));
    console.log('📊 Import Summary');
    console.log('='.repeat(60));
    console.log(`Total files processed: ${files.length}`);
    console.log(`✅ Successfully imported: ${imported}`);
    console.log(`🚀 Successfully published: ${published}`);
    console.log(`❌ Failed: ${failed}`);
    console.log('='.repeat(60) + '\n');

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
            if (result.success) {
                console.log('✅ Workflow import completed successfully');
                process.exit(0);
            } else {
                console.error('⚠️  Workflow import completed with errors');
                process.exit(1);
            }
        })
        .catch(error => {
            console.error('💥 Fatal error:', error.message);
            console.error(error.stack);
            process.exit(1);
        });
}

module.exports = { importWorkflows };