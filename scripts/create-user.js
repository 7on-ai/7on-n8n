const axios = require('axios');

async function createN8NUser() {
    const baseUrl = process.env.N8N_BASE_URL;
    const email = process.env.N8N_USER_EMAIL;
    const password = process.env.N8N_USER_PASSWORD;
    const firstName = process.env.N8N_USER_NAME?.split(' ')[0] || 'User';
    const lastName = process.env.N8N_USER_NAME?.split(' ').slice(1).join(' ') || '';

    console.log('🔧 Initializing N8N user creation...');
    console.log(`📧 Email: ${email}`);
    console.log(`👤 Name: ${firstName} ${lastName}`);

    try {
        // Check if owner exists first
        console.log('🔍 Checking if owner already exists...');
        
        let ownerResponse;
        try {
            ownerResponse = await axios.get(`${baseUrl}/rest/owner`, {
                timeout: 30000,
                validateStatus: function (status) {
                    return status < 500; // Accept 4xx errors
                }
            });
        } catch (error) {
            console.log('⚠️  Owner endpoint not accessible, proceeding with setup...');
        }

        if (ownerResponse && ownerResponse.data?.hasOwner) {
            console.log('ℹ️  Owner already exists, skipping user creation');
            
            // Try to verify login works
            try {
                const loginTest = await axios.post(`${baseUrl}/rest/login`, {
                    email,
                    password
                }, {
                    timeout: 15000,
                    validateStatus: function (status) {
                        return status < 500;
                    }
                });
                
                if (loginTest.status === 200) {
                    console.log('✅ Existing user credentials verified');
                    return;
                } else {
                    console.log('⚠️  Existing user found but credentials may be different');
                    return;
                }
            } catch (loginError) {
                console.log('⚠️  Could not verify existing credentials, but owner exists');
                return;
            }
        }

        // Create owner account
        console.log('🆕 Creating new owner account...');
        const setupResponse = await axios.post(`${baseUrl}/rest/owner/setup`, {
            email,
            password,
            firstName,
            lastName,
            agreedToLicense: true
        }, {
            timeout: 60000,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });

        if (setupResponse.status === 200 || setupResponse.status === 201) {
            console.log('✅ N8N owner account created successfully');
            console.log(`📧 Email: ${email}`);
            console.log(`🔑 Password: ${password}`);
            
            // Verify the account by trying to login
            console.log('🔐 Verifying account by testing login...');
            const loginVerify = await axios.post(`${baseUrl}/rest/login`, {
                email,
                password
            }, {
                timeout: 30000
            });
            
            if (loginVerify.status === 200) {
                console.log('✅ Account verification successful');
            }
        } else {
            throw new Error(`Setup failed with status: ${setupResponse.status}`);
        }

    } catch (error) {
        console.error('❌ Error creating N8N user:', error.message);
        
        if (error.response) {
            console.error('📊 Response status:', error.response.status);
            console.error('📋 Response data:', JSON.stringify(error.response.data, null, 2));
            
            // Check if it's a "already exists" type error
            if (error.response.status === 400 && 
                error.response.data?.message?.includes('owner')) {
                console.log('ℹ️  Owner might already exist, continuing...');
                return;
            }
        }
        
        if (error.code === 'ECONNREFUSED') {
            console.error('🔌 Connection refused - N8N might not be ready yet');
        } else if (error.code === 'ETIMEDOUT') {
            console.error('⏰ Request timed out - N8N might be starting up');
        }
        
        throw error;
    }
}

// Main execution
createN8NUser()
    .then(() => {
        console.log('🎉 User creation process completed');
        process.exit(0);
    })
    .catch(error => {
        console.error('💥 Failed to create N8N user:', error.message);
        process.exit(1);
    });
