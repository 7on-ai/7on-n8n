#!/usr/bin/env node

// scripts/import-workflows.js
// ✅ FINAL FIX: ตาม Network Inspector จริง - GET workflow → POST /activate

const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function importWorkflows() {
    const baseUrl = process.env.N8N_EDITOR_BASE_URL || 'http://localhost:5678';
    const templateSet = process.env.WORKFLOW_TEMPLATES || 'default';
    
    console.log('========================================');
    console.log('🔧 N8N Workflow Importer (n8n 2.0 Compatible)');
    console.log('========================================');
    console.log(`N8N URL: ${baseUrl}`);
    console.log(`Template Set: ${templateSet}`);
    console.log('');

    // Determine template directory
    let templateDir;
    if (templateSet === 'default') {
        templateDir = '/templates/default-workflows';
    } else {
        templateDir = '/templates/custom-workflows';
    }

    console.log(`📁 Looking for templates in: ${templateDir}`);

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

    // Login to N8N to get cookies
    console.log('🔐 Logging into N8N...');
    const cookies = await loginToN8N(baseUrl);
    if (!cookies) {
        throw new Error('Failed to login to N8N');
    }
    console.log('✅ Login successful\n');

    let imported = 0;
    let published = 0;

    for (const file of files) {
        try {
            const filePath = path.join(templateDir, file);
            console.log(`\n📄 Processing: ${file}`);
            console.log('─────────────────────────────');

            const workflowData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            const shouldActivate = workflowData.active === true;

            console.log(`   Name: ${workflowData.name || 'Untitled'}`);
            console.log(`   Should activate: ${shouldActivate ? 'Yes' : 'No'}`);

            // Step 1: Import workflow (always as inactive/draft first)
            console.log('   ⏳ Step 1: Importing workflow...');
            const importPayload = {
                ...workflowData,
                active: false  // ✅ Always import as inactive first
            };

            const importResponse = await axios.post(
                `${baseUrl}/rest/workflows`,
                importPayload,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Cookie': cookies
                    },
                    validateStatus: () => true
                }
            );

            if (importResponse.status !== 200 && importResponse.status !== 201) {
                throw new Error(`Import failed: ${importResponse.status} ${JSON.stringify(importResponse.data)}`);
            }

            const workflowId = importResponse.data?.data?.id || importResponse.data?.id;
            if (!workflowId) {
                throw new Error('No workflow ID returned from import');
            }

            console.log(`   ✅ Imported successfully (ID: ${workflowId})`);
            imported++;

            // Step 2: If should activate, wait then activate
            if (shouldActivate) {
                console.log('   ⏳ Step 2: Waiting 3 seconds for workflow to be ready...');
                await new Promise(resolve => setTimeout(resolve, 3000));

                console.log('   ⏳ Step 3: Verifying workflow exists...');
                // ✅ GET workflow first (like Network Inspector shows)
                const getResponse = await axios.get(
                    `${baseUrl}/rest/workflows/${workflowId}`,
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'Cookie': cookies
                        },
                        validateStatus: () => true
                    }
                );

                if (getResponse.status !== 200) {
                    throw new Error(`Workflow verification failed: ${getResponse.status}`);
                }

                console.log('   ✅ Workflow verified');
                console.log('   ⏳ Step 4: Publishing workflow...');

                // ✅ POST to /activate (like Network Inspector shows)
                const activateResponse = await axios.post(
                    `${baseUrl}/rest/workflows/${workflowId}/activate`,
                    {},  // Empty body
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'Cookie': cookies
                        },
                        validateStatus: () => true
                    }
                );

                if (activateResponse.status === 200) {
                    console.log('   ✅ Published successfully!');
                    published++;
                } else {
                    console.log(`   ⚠️  Publish failed: ${activateResponse.status}`);
                    console.log(`   Response:`, JSON.stringify(activateResponse.data, null, 2));
                }
            } else {
                console.log('   ℹ️  Workflow imported as draft (not set to activate)');
            }

        } catch (error) {
            console.error(`   ❌ Error processing ${file}:`, error.message);
            if (error.response) {
                console.error('   Response data:', JSON.stringify(error.response.data, null, 2));
            }
        }
    }

    console.log('\n========================================');
    console.log('📊 Import Summary');
    console.log('========================================');
    console.log(`Total files processed: ${files.length}`);
    console.log(`Successfully imported: ${imported}`);
    console.log(`Successfully published: ${published}`);
    console.log('========================================\n');

    return { success: true, imported, published };
}

async function loginToN8N(baseUrl) {
    const email = process.env.N8N_USER_EMAIL;
    const password = process.env.N8N_USER_PASSWORD;

    if (!email || !password) {
        console.error('❌ Missing N8N credentials (N8N_USER_EMAIL or N8N_USER_PASSWORD)');
        return null;
    }

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
                maxRedirects: 0
            }
        );

        if (response.status !== 200) {
            console.error('❌ Login failed:', response.status);
            return null;
        }

        const cookies = response.headers['set-cookie'];
        if (!cookies || cookies.length === 0) {
            console.error('❌ No cookies received from login');
            return null;
        }

        // Join cookies properly
        return cookies.join('; ');
    } catch (error) {
        console.error('❌ Login error:', error.message);
        return null;
    }
}

// Main execution
if (require.main === module) {
    importWorkflows()
        .then(result => {
            if (result.success) {
                console.log('✅ Workflow import completed successfully');
                process.exit(0);
            } else {
                console.error('❌ Workflow import failed');
                process.exit(1);
            }
        })
        .catch(error => {
            console.error('💥 Fatal error:', error);
            process.exit(1);
        });
}

module.exports = { importWorkflows };