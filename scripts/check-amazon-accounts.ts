import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://stavokirrmjoipyyljzf.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN0YXZva2lycm1qb2lweXlsanpmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDkxOTcwOSwiZXhwIjoyMDg2NDk1NzA5fQ.X2R9UW94WQdndHsAhA7fTcV2-jQg65uu__f3-QOSFCE';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function checkAccounts() {
  // Get user
  const { data: users } = await supabase
    .from('users')
    .select('id, email')
    .order('created_at', { ascending: false })
    .limit(1);

  if (!users || users.length === 0) {
    console.log('❌ No users found');
    return;
  }

  const user = users[0];
  console.log(`\n👤 User: ${user.email}`);
  console.log(`🆔 User ID: ${user.id}\n`);

  // Check Amazon accounts
  const { data: accounts, error } = await supabase
    .from('amazon_accounts')
    .select('*')
    .eq('user_id', user.id);

  if (error) {
    console.error('❌ Error fetching accounts:', error);
    return;
  }

  if (!accounts || accounts.length === 0) {
    console.log('⚠️  No Amazon accounts connected\n');
    console.log('To test token management, connect an Amazon account at:');
    console.log('http://localhost:3000/dashboard/accounts\n');
    return;
  }

  console.log(`✅ Found ${accounts.length} Amazon account(s)\n`);

  for (const account of accounts) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📝 Account: ${account.account_name || 'Unnamed'}`);
    console.log(`🆔 Profile ID: ${account.amazon_profile_id}`);
    console.log(`🏪 Marketplace: ${account.marketplace}`);
    console.log(`🌍 Region: ${account.region}`);
    console.log(`🔌 Status: ${account.connection_status}`);

    // Check token expiry
    const expiresAt = new Date(account.token_expires_at);
    const now = new Date();
    const isExpired = expiresAt < now;
    const timeUntilExpiry = Math.round((expiresAt.getTime() - now.getTime()) / 1000 / 60);

    if (isExpired) {
      console.log(`⏰ Token: EXPIRED (${Math.abs(timeUntilExpiry)} minutes ago)`);
      console.log(`   → Token will be refreshed automatically on next request`);
    } else {
      console.log(`⏰ Token: Valid (expires in ${timeUntilExpiry} minutes)`);
    }

    console.log(`🔑 Access Token: ${account.access_token_encrypted ? 'Present' : 'MISSING'}`);
    console.log(`🔄 Refresh Token: ${account.refresh_token_encrypted ? 'Present' : 'MISSING'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }

  console.log('✅ Ready to test! Use your API key to make a request:\n');
  console.log('curl -X POST http://localhost:3001/mcp \\');
  console.log('  -H "Authorization: Bearer YOUR_API_KEY_HERE" \\');
  console.log('  -H "Content-Type: application/json" \\');
  console.log(`  -d '{"method": "tools/list"}'\n`);
}

checkAccounts();
