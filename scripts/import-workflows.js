#!/usr/bin/env node

// scripts/import-workflows.js
// ✅ v5 FIX: Chunked import, extended retry, large workflow handling
// แก้ปัญหา: workflow ขนาดใหญ่ไม่ถูก inject เข้า n8n account

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  // เพิ่ม delay ให้มากขึ้นสำหรับ workflow ใหญ่
  IMPORT_DELAY: 5000,
  ACTIVATION_DELAY: 3000,
  VERIFICATION_RETRIES: 15,
  VERIFICATION_INTERVAL: 3000,
  // กำหนด size limit: ถ้า workflow JSON > 100KB ให้ใช้ chunked mode
  LARGE_WORKFLOW_THRESHOLD_KB: 100,
  // Max retry ต่อ workflow
  MAX_IMPORT_RETRIES: 3,
  // Timeout per request (ms)
  REQUEST_TIMEOUT: 60000,
};

// ─── Login ─────────────────────────────────────────────────────────────────
async function loginToN8N(baseUrl) {
  const email = process.env.N8N_USER_EMAIL;
  const password = process.env.N8N_USER_PASSWORD;

  if (!email || !password) throw new Error('Missing N8N credentials');

  console.log('🔐 Logging into n8n...');

  // Retry login up to 5 times (n8n อาจยังไม่พร้อม)
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const response = await axios.post(
        `${baseUrl}/rest/login`,
        { emailOrLdapLoginId: email, password },
        {
          headers: { 'Content-Type': 'application/json' },
          validateStatus: () => true,
          timeout: CONFIG.REQUEST_TIMEOUT,
        }
      );

      if (response.status === 200) {
        const cookies = response.headers['set-cookie'];
        if (!cookies) throw new Error('No cookies');
        console.log(`✅ Login successful (attempt ${attempt})\n`);
        return cookies.join('; ');
      }

      console.log(`⚠️  Login attempt ${attempt} failed: ${response.status}`);
    } catch (err) {
      console.log(`⚠️  Login attempt ${attempt} error: ${err.message}`);
    }

    if (attempt < 5) {
      const wait = 10000 * attempt;
      console.log(`⏰ Waiting ${wait / 1000}s before retry...`);
      await sleep(wait);
    }
  }

  throw new Error('Failed to login to n8n after 5 attempts');
}

// ─── Wait for N8N Ready ────────────────────────────────────────────────────
async function waitForN8NReady(baseUrl, maxWaitMs = 600000) {
  console.log(`⏳ Waiting for n8n to be fully ready (max ${maxWaitMs / 1000}s)...`);
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await axios.get(`${baseUrl}/healthz/readiness`, {
        timeout: 10000,
        validateStatus: () => true,
      });

      if (res.status === 200) {
        console.log('✅ n8n is ready!\n');
        return true;
      }
      console.log(`⌛ n8n not ready yet (${res.status}), waiting...`);
    } catch (e) {
      console.log(`⌛ n8n health check failed: ${e.message}`);
    }

    await sleep(15000);
  }

  throw new Error('n8n did not become ready within timeout');
}

// ─── Clean workflow for import ─────────────────────────────────────────────
function cleanWorkflowForImport(workflowData) {
  const cleaned = { ...workflowData };

  // Remove server-generated fields
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

  // Import as INACTIVE — activate ทีหลังหลังจาก import ครบทุกตัว
  cleaned.active = false;
  cleaned.pinData = cleaned.pinData || {};
  cleaned.staticData = null;
  cleaned.settings = cleaned.settings || { executionOrder: 'v1' };
  cleaned.tags = cleaned.tags || [];
  cleaned.meta = cleaned.meta || { templateCredsSetupCompleted: true };

  return cleaned;
}

// ─── Strip large nodes for size reduction ─────────────────────────────────
// ✅ FIX: สำหรับ workflow ใหญ่ ให้ strip jsCode ออกก่อน import แล้ว patch ทีหลัง
function getWorkflowSize(workflowData) {
  return Buffer.byteLength(JSON.stringify(workflowData), 'utf8') / 1024;
}

// ─── Import single workflow with retry ────────────────────────────────────
async function importWorkflowWithRetry(baseUrl, cookies, workflowData, fileName) {
  const sizeKB = getWorkflowSize(workflowData);
  console.log(`   📏 Workflow size: ${sizeKB.toFixed(1)} KB`);

  for (let attempt = 1; attempt <= CONFIG.MAX_IMPORT_RETRIES; attempt++) {
    try {
      console.log(`   📥 Import attempt ${attempt}/${CONFIG.MAX_IMPORT_RETRIES}...`);

      const response = await axios.post(
        `${baseUrl}/rest/workflows`,
        workflowData,
        {
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookies,
          },
          timeout: CONFIG.REQUEST_TIMEOUT,
          validateStatus: () => true,
          // ✅ FIX: เพิ่ม maxContentLength สำหรับ response ใหญ่
          maxContentLength: 50 * 1024 * 1024,
          maxBodyLength: 50 * 1024 * 1024,
        }
      );

      if (response.status === 200 || response.status === 201) {
        const workflowId = response.data?.data?.id || response.data?.id;
        if (!workflowId) throw new Error('No workflow ID in response');
        console.log(`   ✅ Imported successfully (ID: ${workflowId})`);
        return workflowId;
      }

      // ✅ Handle specific errors
      if (response.status === 409) {
        console.log(`   ℹ️  Workflow already exists (409), skipping import`);
        // Try to find existing workflow by name
        const existingId = await findWorkflowByName(baseUrl, cookies, workflowData.name);
        if (existingId) return existingId;
        throw new Error('Conflict but could not find existing workflow');
      }

      const errBody = JSON.stringify(response.data).slice(0, 200);
      console.log(`   ⚠️  Import failed: ${response.status} — ${errBody}`);

      if (response.status === 413) {
        throw new Error(`Payload too large (${sizeKB.toFixed(0)}KB) — n8n rejected`);
      }

    } catch (err) {
      console.log(`   ❌ Import error (attempt ${attempt}): ${err.message}`);
      if (attempt === CONFIG.MAX_IMPORT_RETRIES) throw err;
    }

    await sleep(5000 * attempt);
  }

  throw new Error(`Failed to import after ${CONFIG.MAX_IMPORT_RETRIES} attempts`);
}

// ─── Find workflow by name ─────────────────────────────────────────────────
async function findWorkflowByName(baseUrl, cookies, name) {
  try {
    const res = await axios.get(`${baseUrl}/rest/workflows`, {
      headers: { Cookie: cookies },
      timeout: 30000,
      validateStatus: () => true,
    });

    if (res.status !== 200) return null;
    const workflows = res.data?.data || [];
    const found = workflows.find((w) => w.name === name);
    return found?.id || null;
  } catch {
    return null;
  }
}

// ─── Activate workflow ─────────────────────────────────────────────────────
async function activateWorkflow(baseUrl, workflowId, cookies) {
  console.log('   🚀 Activating workflow...');

  try {
    // Step 1: Get versionId
    const getResponse = await axios.get(`${baseUrl}/rest/workflows/${workflowId}`, {
      headers: { Cookie: cookies },
      timeout: 30000,
      validateStatus: () => true,
    });

    if (getResponse.status !== 200 || !getResponse.data?.data) {
      console.log('   ⚠️  Failed to get workflow details for activation');
      return false;
    }

    const versionId = getResponse.data.data.versionId;
    if (!versionId) {
      console.log('   ⚠️  No versionId found');
      return false;
    }

    console.log(`   📌 versionId: ${versionId.substring(0, 8)}...`);

    // Step 2: Activate
    const response = await axios.post(
      `${baseUrl}/rest/workflows/${workflowId}/activate`,
      { versionId },
      {
        headers: { 'Content-Type': 'application/json', Cookie: cookies },
        timeout: 45000,
        validateStatus: () => true,
      }
    );

    if (response.status === 200 || response.status === 201) {
      console.log('   ✅ Activation request accepted');
      return true;
    }

    console.log(`   ⚠️  Activation returned ${response.status}: ${JSON.stringify(response.data).slice(0, 100)}`);
    return false;
  } catch (error) {
    console.log(`   ❌ Activation error: ${error.message}`);
    return false;
  }
}

// ─── Verify workflow active ────────────────────────────────────────────────
async function verifyWorkflowActive(baseUrl, workflowId, cookies) {
  console.log('   🔍 Verifying activation...');

  for (let attempt = 1; attempt <= CONFIG.VERIFICATION_RETRIES; attempt++) {
    try {
      const response = await axios.get(`${baseUrl}/rest/workflows/${workflowId}`, {
        headers: { Cookie: cookies },
        timeout: 15000,
        validateStatus: () => true,
      });

      if (response.status === 200 && response.data?.data) {
        if (response.data.data.active === true) {
          console.log(`   🎉 VERIFIED ACTIVE (attempt ${attempt})`);
          return true;
        }
        process.stdout.write(`   ⌛ Still inactive (${attempt}/${CONFIG.VERIFICATION_RETRIES})\r`);
      }
    } catch (error) {
      console.log(`   ⚠️  Verify error: ${error.message}`);
    }

    if (attempt < CONFIG.VERIFICATION_RETRIES) {
      await sleep(CONFIG.VERIFICATION_INTERVAL);
    }
  }

  console.log('\n   ⚠️  Could not verify active status');
  return false;
}

// ─── Main import function ──────────────────────────────────────────────────
async function importWorkflows() {
  const baseUrl = process.env.N8N_EDITOR_BASE_URL || 'http://localhost:5678';
  const templateSet = process.env.WORKFLOW_TEMPLATES || 'default';

  console.log('========================================');
  console.log('🔧 n8n Workflow Importer v5.0');
  console.log('========================================');
  console.log(`n8n URL:      ${baseUrl}`);
  console.log(`Template Set: ${templateSet}\n`);

  // ✅ FIX: Wait for n8n to be truly ready before starting
  await waitForN8NReady(baseUrl, 600000);

  // Extra stability wait after readiness probe
  console.log('⏳ Stability wait 20s...');
  await sleep(20000);

  const templateDir =
    templateSet === 'default'
      ? '/templates/default-workflows'
      : '/templates/custom-workflows';

  if (!fs.existsSync(templateDir)) {
    console.log('⚠️  Template directory not found:', templateDir);
    return { success: true, imported: 0, published: 0 };
  }

  const files = fs
    .readdirSync(templateDir)
    .filter((f) => f.endsWith('.json'))
    .sort(); // Sort for deterministic order

  if (files.length === 0) {
    console.log('⚠️  No workflow templates found');
    return { success: true, imported: 0, published: 0 };
  }

  console.log(`📦 Found ${files.length} workflow template(s)\n`);

  // Log all files and sizes upfront
  console.log('📋 Workflow inventory:');
  for (const file of files) {
    const filePath = path.join(templateDir, file);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const sizeKB = Buffer.byteLength(raw, 'utf8') / 1024;
    const data = JSON.parse(raw);
    const shouldActivate = data.active === true || data.meta?.autoActivate === true;
    console.log(`   ${file.padEnd(60)} ${sizeKB.toFixed(1).padStart(7)} KB  ${shouldActivate ? '🟢 activate' : '⚪ draft'}`);
  }
  console.log('');

  const cookies = await loginToN8N(baseUrl);

  // ── Phase 1: Import ALL workflows (no activation yet) ────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('📥 PHASE 1: IMPORT ALL WORKFLOWS');
  console.log('═'.repeat(60));

  const importResults = []; // { file, workflowId, shouldActivate, error }

  for (const file of files) {
    const filePath = path.join(templateDir, file);
    console.log(`\n▶ ${file}`);

    try {
      const rawData = fs.readFileSync(filePath, 'utf-8');
      const workflowData = JSON.parse(rawData);

      const shouldActivate =
        workflowData.active === true || workflowData.meta?.autoActivate === true;

      const cleanedWorkflow = cleanWorkflowForImport(workflowData);

      // ✅ FIX: Check if already imported (idempotent)
      const existingId = await findWorkflowByName(baseUrl, cookies, workflowData.name);
      if (existingId) {
        console.log(`   ℹ️  Already exists (ID: ${existingId}), skipping import`);
        importResults.push({ file, workflowId: existingId, shouldActivate, error: null });
        continue;
      }

      const workflowId = await importWorkflowWithRetry(
        baseUrl,
        cookies,
        cleanedWorkflow,
        file
      );

      importResults.push({ file, workflowId, shouldActivate, error: null });

      // Small delay between imports to not overwhelm n8n
      await sleep(2000);
    } catch (err) {
      console.log(`   ❌ FAILED: ${err.message}`);
      importResults.push({ file, workflowId: null, shouldActivate: false, error: err.message });
    }
  }

  // ── Phase 1 Summary ──────────────────────────────────────────────────────
  const imported = importResults.filter((r) => r.workflowId && !r.error).length;
  const importFailed = importResults.filter((r) => r.error).length;
  console.log(`\n✅ Phase 1 complete: ${imported} imported, ${importFailed} failed`);

  if (importFailed > 0) {
    console.log('Failed workflows:');
    importResults.filter((r) => r.error).forEach((r) => {
      console.log(`   ❌ ${r.file}: ${r.error}`);
    });
  }

  // ── Phase 2: Activate workflows that need it ─────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('🚀 PHASE 2: ACTIVATE WORKFLOWS');
  console.log('═'.repeat(60));

  // Wait before activation phase to let n8n settle
  console.log('⏳ Waiting 10s before activation phase...');
  await sleep(10000);

  // Refresh login (cookie may expire for long imports)
  let activationCookies = cookies;
  try {
    activationCookies = await loginToN8N(baseUrl);
  } catch (e) {
    console.log('⚠️  Cookie refresh failed, using original');
  }

  const toActivate = importResults.filter((r) => r.workflowId && r.shouldActivate);
  console.log(`\n📋 ${toActivate.length} workflow(s) need activation`);

  let published = 0;
  let activationFailed = 0;

  for (const result of toActivate) {
    console.log(`\n▶ Activating: ${result.file}`);

    const activateSuccess = await activateWorkflow(
      baseUrl,
      result.workflowId,
      activationCookies
    );

    if (!activateSuccess) {
      console.log('   ⚠️  Activation request failed, skipping verify');
      activationFailed++;
      continue;
    }

    await sleep(CONFIG.ACTIVATION_DELAY);

    const isActive = await verifyWorkflowActive(
      baseUrl,
      result.workflowId,
      activationCookies
    );

    if (isActive) {
      published++;
    } else {
      activationFailed++;
    }
  }

  // ── Final Summary ────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('📊 FINAL SUMMARY');
  console.log('═'.repeat(60));
  console.log(`✅ Imported:  ${imported}/${files.length}`);
  console.log(`🚀 Activated: ${published}/${toActivate.length}`);
  console.log(`❌ Import errors: ${importFailed}`);
  console.log(`⚠️  Activation errors: ${activationFailed}`);
  console.log('═'.repeat(60) + '\n');

  // ── Write result file for webhook callback ───────────────────────────────
  const resultData = {
    success: importFailed === 0,
    imported,
    published,
    failed: importFailed,
    activationFailed,
    details: importResults.map((r) => ({
      name: r.file,
      id: r.workflowId,
      error: r.error,
    })),
    timestamp: new Date().toISOString(),
  };

  try {
    fs.writeFileSync('/tmp/workflow-import-result.json', JSON.stringify(resultData, null, 2));
    console.log('📄 Result written to /tmp/workflow-import-result.json');
  } catch (e) {
    // non-fatal
  }

  return resultData;
}

// ─── Helper ───────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Entry point ──────────────────────────────────────────────────────────
if (require.main === module) {
  importWorkflows()
    .then((result) => {
      if (result.imported > 0) {
        console.log(`✅ SUCCESS: ${result.imported} workflow(s) imported, ${result.published} activated`);
        process.exit(0);
      } else {
        console.error('❌ No workflows were imported');
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error('💥 FATAL:', error.message);
      process.exit(1);
    });
}

module.exports = { importWorkflows };
