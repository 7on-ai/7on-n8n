// scripts/import-workflows.js
// Northflank Job script — runs once on first provision
//
// Phase 1   — Import all missing workflows from filesystem templates
// Phase 1.5A — Patch WF1 → inject real WF2 ID
// Phase 1.5B — Patch openRouterApi credential ID in all LLM nodes  ← ADDED
// Phase 1.5C — Patch errorWorkflow name → real WF0 ID              ← ADDED
// Phase 2   — Activate all workflows
//
// Auth: X-N8N-API-KEY header + /api/v1/... endpoint
// (different from route.ts which uses cookie-based /rest/... endpoint)

const fs   = require('fs');
const path = require('path');

const N8N_BASE_URL = (process.env.N8N_BASE_URL || 'http://localhost:5678').replace(/\/$/, '');
const N8N_API_KEY  = process.env.N8N_API_KEY  || '';

// ── WF name → filename mapping ───────────────────────────────────────────────
// Key   = the "name" field inside the JSON template (must match exactly)
// Value = template filename (relative to templates/default-workflows/)
// ⚠️  WF3C: JSON name is "Coach", not "Career Coach"
// ⚠️  WF5A: JSON name is "Memory Builder" (after v3 fix)
const WF_NAME_TO_FILE = {
  'Error Handler':  'WF0-Error-Handler.json',
  'Intake Gateway': 'WF1-Intake-Gateway.json',
  'Brain Router':   'WF2-Brain-Router.json',
  'Secretary':      'WF3A-Secretary.json',
  'Soul':           'WF3B-Soul.json',
  'Coach':          'WF3C-Career.json',        // ⚠️ JSON name ≠ filename
  'Explorer':       'WF3D-Explorer.json',
  'Creator':        'WF3E-Creator.json',
  'HomeMate':       'WF3F-HomeMate.json',
  'HealthMate':     'WF3G-Health.json',
  'Secretary Plus': 'WF4-SecretaryPlus.json',
  'Memory Builder': 'WF5A-Memory.json',        // ⚠️ name changed in v3 fix
  'Insight Engine': 'WF5B-Background.json', // JSON "name" = "Insight Engine" (ไม่ใช่ "Background")
  'DB Proxy':       'WF-DB-Proxy.json',
};

// ── WFs with lmChatOpenRouter nodes (need openRouterApi credential patch) ────
const WFS_WITH_OPENROUTER_LLM = [
  'Secretary',      // WF3A
  'Soul',           // WF3B
  'Coach',          // WF3C
  'Explorer',       // WF3D
  'Creator',        // WF3E
  'HomeMate',       // WF3F
  'HealthMate',     // WF3G
  'Secretary Plus', // WF4
  'Memory Builder', // WF5A ← ADDED (has LLM Memory Extractor Haiku node)
];

// ── WFs with settings.errorWorkflow (need WF0 ID patch) ─────────────────────
const WFS_WITH_ERROR_WORKFLOW = [
  'Brain Router',   // WF2
  'Secretary',      // WF3A
  'Soul',           // WF3B
  'Coach',          // WF3C
  'Explorer',       // WF3D
  'Creator',        // WF3E
  'HomeMate',       // WF3F
  'HealthMate',     // WF3G
  'Secretary Plus', // WF4
  'Database Proxy', // WF-DB-Proxy ← JSON "name" = "Database Proxy"
];

const HARDCODED_OR_CRED_ID  = 'FUm3Fg9B8euy8cH3';
const ERROR_WF_PLACEHOLDER  = 'WF0-Error-Handler';
const TEMPLATE_DIR          = path.join(__dirname, '..', 'templates', 'default-workflows');

// ── n8n API helpers (API key auth) ───────────────────────────────────────────
const n8nHeaders = {
  'Content-Type': 'application/json',
  'X-N8N-API-KEY': N8N_API_KEY,
};

async function n8nGet(endpoint) {
  const res = await fetch(`${N8N_BASE_URL}/api/v1${endpoint}`, { headers: n8nHeaders });
  if (!res.ok) throw new Error(`GET ${endpoint} → ${res.status} ${await res.text().catch(() => '')}`);
  return res.json();
}

async function n8nPost(endpoint, body) {
  const res = await fetch(`${N8N_BASE_URL}/api/v1${endpoint}`, {
    method: 'POST',
    headers: n8nHeaders,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${endpoint} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function n8nPut(endpoint, body) {
  const res = await fetch(`${N8N_BASE_URL}/api/v1${endpoint}`, {
    method: 'PUT',
    headers: n8nHeaders,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PUT ${endpoint} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function n8nPatch(endpoint, body) {
  const res = await fetch(`${N8N_BASE_URL}/api/v1${endpoint}`, {
    method: 'PATCH',
    headers: n8nHeaders,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PATCH ${endpoint} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getExistingWorkflows() {
  const data = await n8nGet('/workflows?limit=100');
  const map = {};
  for (const wf of data.data || []) {
    map[wf.name] = { id: wf.id, active: wf.active };
  }
  return map;
}

function loadTemplate(filename) {
  const filePath = path.join(TEMPLATE_DIR, filename);
  if (!fs.existsSync(filePath)) throw new Error(`Template not found: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function cleanWorkflow(wf) {
  const cleaned = { ...wf };
  for (const key of [
    'id', 'createdAt', 'updatedAt', 'versionCounter', 'shared',
    'scopes', 'checksum', 'triggerCount', 'activeVersion', 'parentFolder',
  ]) {
    delete cleaned[key];
  }
  cleaned.active     = false;
  cleaned.pinData    = cleaned.pinData ?? {};
  cleaned.staticData = null;
  cleaned.settings   = cleaned.settings ?? { executionOrder: 'v1' };
  // n8n API expects tags as string[] not object[]
  const rawTags      = cleaned.tags ?? [];
  cleaned.tags       = rawTags
    .map((t) => (typeof t === 'string' ? t : t.name ?? ''))
    .filter(Boolean);
  cleaned.meta       = cleaned.meta ?? { templateCredsSetupCompleted: true };
  return cleaned;
}

// ── patchWorkflow: string-replace in workflow JSON, skip PUT if no change ────
async function patchWorkflow(wfId, wfName, patches) {
  const wfData = await n8nGet(`/workflows/${wfId}`);
  let wfStr    = JSON.stringify(wfData);
  const changes = [];

  for (const { find, replace, description } of patches) {
    if (wfStr.includes(find)) {
      wfStr = wfStr.split(find).join(replace);
      changes.push(description);
    }
  }

  if (changes.length === 0) {
    return { patched: false, changes: [] };
  }

  const updated = JSON.parse(wfStr);
  await n8nPut(`/workflows/${wfId}`, updated);
  console.log(`[import] Patched "${wfName}": ${changes.join(', ')}`);
  return { patched: true, changes };
}

// ── Phase 1.5B: Find openRouterApi credential ID ─────────────────────────────
// NOTE: /api/v1/credentials response shape differs by n8n version.
// Some versions use `type`, some use `typeDisplayName` or omit type entirely.
// We match on name containing "openrouter" as primary strategy (reliable across versions),
// with type-based fallback for versions that do include it.
async function findOpenRouterCredentialId() {
  try {
    const data  = await n8nGet('/credentials?limit=100');
    const creds = data.data || [];

    // Strategy 1: name contains "openrouter" (case-insensitive) — most reliable
    const byName = creds.find((c) => c.name?.toLowerCase().includes('openrouter'));
    if (byName) {
      console.log(`[import] 1.5B: found credential by name: "${byName.name}" (id: ${byName.id})`);
      return byName.id;
    }

    // Strategy 2: type field = "openRouterApi" (present in some n8n versions)
    const byType = creds.find((c) => c.type === 'openRouterApi');
    if (byType) {
      console.log(`[import] 1.5B: found credential by type: "${byType.name}" (id: ${byType.id})`);
      return byType.id;
    }

    console.log('[import] 1.5B: no openRouterApi credential found in list:', creds.map((c) => c.name));
    return null;
  } catch (err) {
    console.warn('[import] Could not list credentials:', err.message);
    return null;
  }
}

async function patchOpenRouterCredentials(importResults) {
  const credId = await findOpenRouterCredentialId();
  if (!credId) {
    console.log('⚠️  [import] Phase 1.5B: openRouterApi credential not found — skip');
    console.log('   LLM calls will fail until credential is manually assigned in n8n');
    return;
  }
  if (credId === HARDCODED_OR_CRED_ID) {
    console.log('ℹ️  [import] Phase 1.5B: credential ID matches template — no patch needed');
    return;
  }

  console.log(`🔧 [import] Phase 1.5B: openRouterApi → ${credId}`);
  let patched = 0;

  for (const wfName of WFS_WITH_OPENROUTER_LLM) {
    const wfId = importResults[wfName];
    if (!wfId) {
      console.log(`   ⚠️  [import] 1.5B: "${wfName}" not imported — skip`);
      continue;
    }
    try {
      const result = await patchWorkflow(wfId, wfName, [
        {
          find: `"openRouterApi":{"id":"${HARDCODED_OR_CRED_ID}"`,
          replace: `"openRouterApi":{"id":"${credId}"`,
          description: `openRouterApi.id → ${credId}`,
        },
      ]);
      if (result.patched) patched++;
      else console.log(`   ✓  [import] 1.5B: "${wfName}" already patched`);
    } catch (err) {
      console.log(`   ❌ [import] 1.5B: "${wfName}" ${err.message}`);
    }
    await sleep(400);
  }

  console.log(`📊 [import] Phase 1.5B: ${patched} patched`);
}

// ── Phase 1.5C: Patch errorWorkflow → real WF0 ID ────────────────────────────
async function patchErrorWorkflow(wf0Id, importResults) {
  if (!wf0Id) {
    console.log('ℹ️  [import] Phase 1.5C: WF0 ID unknown — skip (non-critical)');
    return;
  }

  console.log(`🔧 [import] Phase 1.5C: errorWorkflow → ${wf0Id}`);
  let patched = 0;

  for (const wfName of WFS_WITH_ERROR_WORKFLOW) {
    const wfId = importResults[wfName];
    if (!wfId) {
      console.log(`   ⚠️  [import] 1.5C: "${wfName}" not imported — skip`);
      continue;
    }
    try {
      const result = await patchWorkflow(wfId, wfName, [
        {
          find: `"errorWorkflow":"${ERROR_WF_PLACEHOLDER}"`,
          replace: `"errorWorkflow":"${wf0Id}"`,
          description: `errorWorkflow → ${wf0Id}`,
        },
        // Also handle format with space after colon
        {
          find: `"errorWorkflow": "${ERROR_WF_PLACEHOLDER}"`,
          replace: `"errorWorkflow": "${wf0Id}"`,
          description: `errorWorkflow (spaced) → ${wf0Id}`,
        },
      ]);
      if (result.patched) patched++;
      else console.log(`   ✓  [import] 1.5C: "${wfName}" already correct`);
    } catch (err) {
      console.log(`   ❌ [import] 1.5C: "${wfName}" ${err.message}`);
    }
    await sleep(400);
  }

  console.log(`📊 [import] Phase 1.5C: ${patched} patched`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 [import] Starting workflow import...');
  console.log(`   N8N_BASE_URL: ${N8N_BASE_URL}`);
  console.log(`   API_KEY set: ${N8N_API_KEY ? 'yes' : '⚠️ NO'}`);

  // ════════════════════════════════════════════════════════════════════════════
  // Phase 1: Import missing workflows
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n📋 Phase 1: Importing missing workflows...');

  const existing = await getExistingWorkflows();
  console.log(`   Existing: ${Object.keys(existing).length} — ${Object.keys(existing).join(', ')}`);

  // importResults: name → id (includes pre-existing)
  const importResults = {};
  for (const [name, info] of Object.entries(existing)) {
    importResults[name] = info.id;
  }

  let imported     = 0;
  let skipped      = 0;
  let importFailed = 0;

  for (const [wfName, filename] of Object.entries(WF_NAME_TO_FILE)) {
    if (existing[wfName]) {
      console.log(`   ⏭️  Skip (exists): "${wfName}"`);
      skipped++;
      continue;
    }
    try {
      const template = loadTemplate(filename);
      const cleaned  = cleanWorkflow(template);
      const created  = await n8nPost('/workflows', cleaned);
      importResults[wfName] = created.id;
      console.log(`   ✅ Imported: "${wfName}" → id: ${created.id}`);
      imported++;
    } catch (err) {
      console.error(`   ❌ Failed: "${wfName}" — ${err.message}`);
      importFailed++;
    }
    await sleep(1500);
  }

  console.log(`\n📊 Phase 1: ${imported} imported, ${skipped} skipped, ${importFailed} failed`);

  // ════════════════════════════════════════════════════════════════════════════
  // Phase 1.5A: Patch WF1 → inject real WF2 ID
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n🔧 Phase 1.5A: Patching WF1 → WF2 ID...');

  const wf1Id = importResults['Intake Gateway'];
  const wf2Id = importResults['Brain Router'];

  if (wf1Id && wf2Id) {
    try {
      const result = await patchWorkflow(wf1Id, 'Intake Gateway', [
        {
          find: 'PATCH_WF2_ID_HERE',
          replace: wf2Id,
          description: `WF2 ID → ${wf2Id}`,
        },
      ]);
      console.log(result.patched
        ? `   ✅ WF1: injected WF2 ID (${wf2Id})`
        : `   ✓  WF1: WF2 ID already patched`);
    } catch (err) {
      console.error(`   ❌ WF1 patch failed: ${err.message}`);
    }
  } else {
    console.log(`   ⚠️  Skip — wf1Id=${wf1Id ?? 'missing'}, wf2Id=${wf2Id ?? 'missing'}`);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Phase 1.5B: Patch openRouterApi credential ID
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n🔧 Phase 1.5B: Patching openRouterApi credential...');
  await patchOpenRouterCredentials(importResults);

  // ════════════════════════════════════════════════════════════════════════════
  // Phase 1.5C: Patch errorWorkflow → real WF0 ID
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n🔧 Phase 1.5C: Patching errorWorkflow...');
  const wf0Id = importResults['Error Handler'];
  await patchErrorWorkflow(wf0Id, importResults);

  // ════════════════════════════════════════════════════════════════════════════
  // Phase 2: Activate all workflows
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n⚡ Phase 2: Activating workflows...');
  await sleep(3000);

  const currentWfs = await getExistingWorkflows();
  let activated       = 0;
  let activationFailed = 0;

  for (const [wfName, info] of Object.entries(currentWfs)) {
    if (info.active) {
      console.log(`   ✓  Already active: "${wfName}"`);
      activated++;
      continue;
    }
    try {
      await n8nPatch(`/workflows/${info.id}`, { active: true });
      console.log(`   🚀 Activated: "${wfName}"`);
      activated++;
    } catch (err) {
      // Non-fatal: some WFs may not be activatable (missing credentials)
      console.log(`   ⚠️  Could not activate "${wfName}": ${err.message}`);
      activationFailed++;
    }
    await sleep(800);
  }

  console.log(`\n📊 Phase 2: ${activated} activated, ${activationFailed} failed`);

  // ════════════════════════════════════════════════════════════════════════════
  // Summary
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n✅ [import] Done.');
  console.log(`   Phase 1: ${imported} imported, ${skipped} skipped, ${importFailed} failed`);
  console.log(`   Phase 2: ${activated} active, ${activationFailed} failed`);

  if (importFailed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('💥 [import] Fatal error:', err.message);
  process.exit(1);
});
