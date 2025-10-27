#!/usr/bin/env node
// scripts/neon-store.js - Store N8N credentials to Neon Database

const { Client } = require('pg');

async function storeToNeon() {
    const DATABASE_URL = process.env.DATABASE_URL;
    const CLERK_USER_ID = process.env.CLERK_USER_ID;
    const USER_EMAIL = process.env.USER_EMAIL;
    const N8N_EDITOR_BASE_URL = process.env.N8N_EDITOR_BASE_URL;
    const N8N_USER_EMAIL = process.env.N8N_USER_EMAIL;
    const N8N_USER_PASSWORD = process.env.N8N_USER_PASSWORD;
    const N8N_ENCRYPTION_KEY = process.env.N8N_ENCRYPTION_KEY;
    const NORTHFLANK_PROJECT_ID = process.env.NORTHFLANK_PROJECT_ID;
    const NORTHFLANK_PROJECT_NAME = process.env.NORTHFLANK_PROJECT_NAME;

    console.log('🗄️  Connecting to Neon Database...');
    console.log(`📧 User: ${USER_EMAIL}`);
    console.log(`🔗 N8N URL: ${N8N_EDITOR_BASE_URL}`);
    console.log(`🆔 Clerk ID: ${CLERK_USER_ID}`);
    console.log(`🏗️  Project: ${NORTHFLANK_PROJECT_NAME} (${NORTHFLANK_PROJECT_ID})`);

    // Validate required variables
    const required = {
        DATABASE_URL,
        CLERK_USER_ID,
        USER_EMAIL,
        N8N_EDITOR_BASE_URL,
        N8N_USER_EMAIL,
        N8N_USER_PASSWORD,
        N8N_ENCRYPTION_KEY,
        NORTHFLANK_PROJECT_ID
    };

    const missing = Object.entries(required)
        .filter(([, value]) => !value)
        .map(([key]) => key);

    if (missing.length > 0) {
        console.error('❌ Missing required environment variables:', missing);
        throw new Error(`Missing: ${missing.join(', ')}`);
    }

    let client;

    try {
        // Connect to Neon
        client = new Client({
            connectionString: DATABASE_URL,
            ssl: {
                rejectUnauthorized: false
            },
            connectionTimeoutMillis: 30000
        });

        await client.connect();
        console.log('✅ Connected to Neon database');

        // Check if user exists
        console.log('🔍 Checking for existing user...');
        const checkQuery = `
            SELECT * FROM "User" 
            WHERE "clerkId" = $1 
            LIMIT 1
        `;
        const checkResult = await client.query(checkQuery, [CLERK_USER_ID]);

        const now = new Date();

        if (checkResult.rows.length > 0) {
            // Update existing user
            console.log('📝 Updating existing user...');
            const updateQuery = `
                UPDATE "User" 
                SET 
                    email = $2,
                    "n8nUrl" = $3,
                    "n8nUserEmail" = $4,
                    "n8nEncryptionKey" = $5,
                    "northflankProjectId" = $6,
                    "northflankProjectName" = $7,
                    "northflankProjectStatus" = $8,
                    "northflankCreatedAt" = $9,
                    "templateCompletedAt" = $10,
                    "updatedAt" = $11,
                    "n8nSetupError" = NULL
                WHERE "clerkId" = $1
                RETURNING *
            `;

            const updateValues = [
                CLERK_USER_ID,
                USER_EMAIL,
                N8N_EDITOR_BASE_URL,
                N8N_USER_EMAIL,
                N8N_ENCRYPTION_KEY,
                NORTHFLANK_PROJECT_ID,
                NORTHFLANK_PROJECT_NAME,
                'ready',
                now,
                now,
                now
            ];

            await client.query(updateQuery, updateValues);
            console.log('✅ User updated successfully');

        } else {
            // Create new user
            console.log('📝 Creating new user...');
            const generateId = () => {
                const timestamp = Date.now().toString(36);
                const randomStr = Math.random().toString(36).substring(2, 15);
                return `c${timestamp}${randomStr}`;
            };

            const insertQuery = `
                INSERT INTO "User" (
                    id,
                    "clerkId",
                    email,
                    "subscriptionTier",
                    "apiCallsCount",
                    "usageResetAt",
                    "n8nUrl",
                    "n8nUserEmail",
                    "n8nEncryptionKey",
                    "northflankProjectId",
                    "northflankProjectName",
                    "northflankProjectStatus",
                    "northflankCreatedAt",
                    "templateCompletedAt",
                    "createdAt",
                    "updatedAt"
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                RETURNING *
            `;

            const userId = generateId();
            const insertValues = [
                userId,
                CLERK_USER_ID,
                USER_EMAIL,
                'FREE',
                0,
                now,
                N8N_EDITOR_BASE_URL,
                N8N_USER_EMAIL,
                N8N_ENCRYPTION_KEY,
                NORTHFLANK_PROJECT_ID,
                NORTHFLANK_PROJECT_NAME,
                'ready',
                now,
                now,
                now,
                now
            ];

            await client.query(insertQuery, insertValues);
            console.log(`✅ User created successfully (ID: ${userId})`);
        }

        console.log('\n=== SUCCESS ===');
        console.log(`🎉 N8N credentials stored in Neon database`);
        console.log(`📧 Email: ${N8N_USER_EMAIL}`);
        console.log(`🔗 N8N URL: ${N8N_EDITOR_BASE_URL}`);
        console.log(`🏗️  Project: ${NORTHFLANK_PROJECT_NAME}`);

    } catch (error) {
        console.error('❌ Failed to store credentials:', error.message);
        console.error('Stack trace:', error.stack);
        
        // Try to update error status
        try {
            if (client) {
                const errorQuery = `
                    UPDATE "User" 
                    SET "northflankProjectStatus" = $1, 
                        "n8nSetupError" = $2,
                        "updatedAt" = $3
                    WHERE "clerkId" = $4
                `;
                await client.query(errorQuery, [
                    'failed',
                    error.message.substring(0, 500),
                    new Date(),
                    CLERK_USER_ID
                ]);
                console.log('📝 Error status updated in database');
            }
        } catch (updateError) {
            console.error('⚠️  Could not update error status:', updateError.message);
        }
        
        throw error;
    } finally {
        if (client) {
            await client.end();
            console.log('🔌 Database connection closed');
        }
    }
}

// Main execution
storeToNeon()
    .then(() => {
        console.log('✅ Neon storage completed');
        process.exit(0);
    })
    .catch(error => {
        console.error('💥 Neon storage failed:', error.message);
        process.exit(1);
    });
