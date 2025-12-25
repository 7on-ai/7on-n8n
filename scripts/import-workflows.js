#!/usr/bin/env node

// scripts/import-workflows.js
// ✅ CORRECT FIX: Use /activate endpoint (n8n v2.0 compatible)

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const CONFIG = {
    IMPORT_DELAY: 3000,
    ACTIVATION_DELAY: 2000,
    VERIFICATION_RETRIES: 10,
    VERIFICATION_INTERVAL: 2000,
};

async function loginToN8N(baseUrl) {
    const email = process.env.N8N_USER_EMAIL;
    const password = process.env.N8N_USER_PASSWORD;

    if (!email || !password) {
        throw new Error('Missing N8N credentials');
    }

    console.log('🔐 Logging into n8n...');
    
    const response = await axios.post(
        `${baseUrl}/rest/login`,
        { emailOrLdapLoginId: email, password },
        { 
            headers: { 'Content-Type': 'application/json' },
            validateStatus: () => true,
            timeout: 30000
        }
    );

    if (response.status !== 200) {
        throw new Error(`Login failed: ${response.status}`);
    }

    const cookies = response.headers['set-cookie'];
    if (!cookies) throw new Error('No cookies');

    console.log('✅ Login successful\n');
    return cookies.join('; ');
}

function cleanWorkflowForImport(workflowData) {
    const cleaned = { ...workflowData };
    
    // Remove fields that shouldn't be in import
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
    
    // ✅ Import as INACTIVE first (will activate later)
    cleaned.active = false;
    cleaned.pinData = cleaned.pinData || {};
    cleaned.staticData = null;
    cleaned.settings = cleaned.settings || { executionOrder: 'v1' };
    cleaned.tags = cleaned.tags || [];
    cleaned.meta = cleaned.meta || { templateCredsSetupCompleted: true };
    
    return cleaned;
}

async function activateWorkflow(baseUrl, workflowId, cookies) {
    console.log('   🚀 Activating workflow...');
    
    try {
        // ✅ STEP 1: Get workflow to extract versionId
        console.log('   📄 Getting workflow details...');
        const getResponse = await axios.get(
            `${baseUrl}/rest/workflows/${workflowId}`,
            {
                headers: { Cookie: cookies },
                timeout: 15000,
                validateStatus: () => true
            }
        );

        if (getResponse.status !== 200 || !getResponse.data?.data) {
            console.log('   ⚠️ Failed to get workflow details');
            return false;
        }

        const versionId = getResponse.data.data.versionId;
        if (!versionId) {
            console.log('   ⚠️ No versionId found');
            return false;
        }

        console.log(`   📌 Found versionId: ${versionId.substring(0, 8)}...`);

        // ✅ STEP 2: Activate with versionId
        const response = await axios.post(
            `${baseUrl}/rest/workflows/${workflowId}/activate`,
            { versionId },
            {
                headers: {
                    'Content-Type': 'application/json',
                    Cookie: cookies
                },
                timeout: 30000,
                validateStatus: () => true
            }
        );

        if (response.status === 200 || response.status === 201) {
            console.log('   ✅ Activation successful');
            return true;
        } else {
            console.log(`   ⚠️ Activation returned ${response.status}`);
            console.log(`   Response: ${JSON.stringify(response.data)}`);
            return false;
        }
    } catch (error) {
        console.log(`   ❌ Activation error: ${error.message}`);
        return false;
    }
}

async function verifyWorkflowActive(baseUrl, workflowId, cookies) {
    console.log('   🔍 Verifying activation...');
    
    for (let attempt = 1; attempt <= CONFIG.VERIFICATION_RETRIES; attempt++) {
        try {
            const response = await axios.get(
                `${baseUrl}/rest/workflows/${workflowId}`,
                {
                    headers: { Cookie: cookies },
                    timeout: 15000,
                    validateStatus: () => true
                }
            );

            if (response.status === 200 && response.data?.data) {
                const isActive = response.data.data.active === true;
                
                if (isActive) {
                    console.log(`   ✅ VERIFIED ACTIVE (attempt ${attempt})`);
                    return true;
                }
                console.log(`   ⌛ Still inactive (attempt ${attempt})`);
            }
        } catch (error) {
            console.log(`   ⚠️ Verification error: ${error.message}`);
        }
        
        if (attempt < CONFIG.VERIFICATION_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, CONFIG.VERIFICATION_INTERVAL));
        }
    }
    
    return false;
}

async function importWorkflows() {
    const baseUrl = process.env.N8N_EDITOR_BASE_URL || 'http://localhost:5678';
    const templateSet = process.env.WORKFLOW_TEMPLATES || 'default';
    
    console.log('========================================');
    console.log('🔧 n8n Workflow Importer v4.0 (FIXED)');
    console.log('========================================');
    console.log(`n8n URL: ${baseUrl}`);
    console.log(`Template Set: ${templateSet}\n`);

    const templateDir = templateSet === 'default' 
        ? '/templates/default-workflows'
        : '/templates/custom-workflows';

    if (!fs.existsSync(templateDir)) {
        console.log('⚠️ Template directory not found');
        return { success: true, imported: 0, published: 0 };
    }

    const files = fs.readdirSync(templateDir).filter(f => f.endsWith('.json'));
    
    if (files.length === 0) {
        console.log('⚠️ No workflow templates found');
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
            
            const shouldActivate = workflowData.active === true || workflowData.meta?.autoActivate === true;
            
            console.log(`   Name: ${workflowData.name || 'Untitled'}`);
            console.log(`   Should activate: ${shouldActivate ? 'YES' : 'NO'}`);

            // ===== STEP 1: Import as INACTIVE =====
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
                throw new Error('No workflow ID returned');
            }

            console.log(`   ✅ Imported (ID: ${workflowId})`);
            imported++;

            if (!shouldActivate) {
                console.log('   ℹ️ Staying as draft (no activation flag)\n');
                continue;
            }

            // ===== STEP 2: Wait =====
            console.log(`\n   ⏰ Step 2: Waiting ${CONFIG.IMPORT_DELAY/1000}s...`);
            await new Promise(resolve => setTimeout(resolve, CONFIG.IMPORT_DELAY));

            // ===== STEP 3: Activate using /activate endpoint =====
            console.log('\n   🔄 Step 3: Activating workflow...');
            const activateSuccess = await activateWorkflow(baseUrl, workflowId, cookies);
            
            if (!activateSuccess) {
                console.log('   ⚠️ Activation failed, but continuing...');
            }

            await new Promise(resolve => setTimeout(resolve, CONFIG.ACTIVATION_DELAY));

            // ===== STEP 4: Verify =====
            console.log('\n   🎯 Step 4: Verifying activation...');
            const isActive = await verifyWorkflowActive(baseUrl, workflowId, cookies);
            
            if (isActive) {
                console.log('\n   🎉 ✅ WORKFLOW ACTIVE!\n');
                published++;
            } else {
                console.log('\n   ⚠️ Not active after all attempts\n');
            }

        } catch (error) {
            console.error(`\n   ❌ ERROR: ${error.message}\n`);
            failed++;
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 FINAL SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Imported: ${imported}`);
    console.log(`🚀 Activated: ${published}`);
    console.log(`❌ Failed: ${failed}`);
    console.log('='.repeat(60) + '\n');

    if (published > 0) {
        console.log('✅ SUCCESS: Workflows are ACTIVE!\n');
    }

    return { 
        success: failed === 0, 
        imported, 
        published,
        failed 
    };
}

if (require.main === module) {
    importWorkflows()
        .then(result => {
            if (result.published > 0) {
                console.log(`✅ SUCCESS: ${result.published} workflow(s) active!`);
                process.exit(0);
            } else if (result.imported > 0) {
                console.error('⚠️ Workflows imported but not activated');
                process.exit(1);
            } else {
                console.error('❌ Import failed');
                process.exit(1);
            }
        })
        .catch(error => {
            console.error('💥 FATAL:', error.message);
            process.exit(1);
        });
}

module.exports = { importWorkflows };