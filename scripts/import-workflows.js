#!/usr/bin/env node

// scripts/import-workflows.js
// ✅ ULTIMATE FIX: Proper n8n v2.0 workflow activation

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const CONFIG = {
    IMPORT_DELAY: 3000,
    SAVE_DELAY: 2000,
    ACTIVATION_DELAY: 3000,
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
    
    // ✅ CRITICAL: Import as ACTIVE
    cleaned.active = true;
    cleaned.pinData = cleaned.pinData || {};
    cleaned.staticData = null;
    cleaned.settings = cleaned.settings || { executionOrder: 'v1' };
    cleaned.tags = cleaned.tags || [];
    cleaned.meta = cleaned.meta || { templateCredsSetupCompleted: true };
    
    return cleaned;
}

// ✅ NEW: Re-save workflow to register triggers properly
async function resaveWorkflow(baseUrl, workflowId, cookies) {
    console.log('   📝 Re-saving workflow to register triggers...');
    
    try {
        // Get current workflow
        const getResp = await axios.get(
            `${baseUrl}/rest/workflows/${workflowId}`,
            {
                headers: { Cookie: cookies },
                timeout: 15000,
                validateStatus: () => true
            }
        );

        if (getResp.status !== 200) {
            console.log('   ⚠️ Failed to get workflow');
            return false;
        }

        const workflow = getResp.data.data;
        
        // Save it back (this registers webhooks/triggers)
        const saveResp = await axios.put(
            `${baseUrl}/rest/workflows/${workflowId}`,
            {
                ...workflow,
                active: true // Keep active during save
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    Cookie: cookies
                },
                timeout: 30000,
                validateStatus: () => true
            }
        );

        if (saveResp.status === 200) {
            console.log('   ✅ Workflow re-saved successfully');
            return true;
        } else {
            console.log(`   ⚠️ Save returned ${saveResp.status}`);
            return false;
        }
    } catch (error) {
        console.log(`   ❌ Re-save error: ${error.message}`);
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
    console.log('🔧 n8n Workflow Importer v3.0 (ULTIMATE)');
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

            // ===== STEP 1: Import with active=true =====
            console.log('\n   📥 Step 1: Importing workflow as ACTIVE...');
            
            const cleanedWorkflow = cleanWorkflowForImport(workflowData);
            // Force active if needed
            if (shouldActivate) {
                cleanedWorkflow.active = true;
            }
            
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
                throw new Error(`Import failed: ${importResponse.status}`);
            }

            const workflowId = importResponse.data?.data?.id || importResponse.data?.id;
            if (!workflowId) {
                throw new Error('No workflow ID');
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

            // ===== STEP 3: Re-save to register triggers =====
            console.log('\n   🔄 Step 3: Re-saving to register triggers...');
            const saveSuccess = await resaveWorkflow(baseUrl, workflowId, cookies);
            
            if (!saveSuccess) {
                console.log('   ⚠️ Re-save failed, but continuing...');
            }

            await new Promise(resolve => setTimeout(resolve, CONFIG.SAVE_DELAY));

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
    console.log(`🚀 Published: ${published}`);
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