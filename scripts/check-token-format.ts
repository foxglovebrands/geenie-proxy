import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://stavokirrmjoipyyljzf.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN0YXZva2lycm1qb2lweXlsanpmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDkxOTcwOSwiZXhwIjoyMDg2NDk1NzA5fQ.X2R9UW94WQdndHsAhA7fTcV2-jQg65uu__f3-QOSFCE'
);

async function checkTokenFormat() {
  const { data: accounts, error } = await supabase
    .from('amazon_accounts')
    .select('access_token_encrypted, refresh_token_encrypted')
    .eq('amazon_profile_id', '1157108436670296')
    .eq('connection_status', 'connected')
    .limit(1);

  const data = accounts?.[0];

  if (error || !data) {
    console.log('❌ Error fetching account:', error);
    return;
  }

  console.log('\n📊 Token Format Check\n');
  console.log('Access Token:');
  console.log(`  Prefix: "${data.access_token_encrypted.substring(0, 5)}"`);
  console.log(`  Has Atza| prefix: ${data.access_token_encrypted.startsWith('Atza|') ? '✅ YES' : '❌ NO'}`);
  console.log(`  Length: ${data.access_token_encrypted.length} characters`);

  console.log('\nRefresh Token:');
  console.log(`  Prefix: "${data.refresh_token_encrypted.substring(0, 5)}"`);
  console.log(`  Has Atzr| prefix: ${data.refresh_token_encrypted.startsWith('Atzr|') ? '✅ YES' : '❌ NO'}`);
  console.log(`  Length: ${data.refresh_token_encrypted.length} characters\n`);

  if (!data.access_token_encrypted.startsWith('Atza|')) {
    console.log('⚠️  WARNING: Access token does NOT have the required Atza| prefix!');
    console.log('   Amazon requires tokens to start with Atza| for access tokens.');
    console.log('   This is why the MCP server is rejecting the token.\n');
  }
}

checkTokenFormat();
