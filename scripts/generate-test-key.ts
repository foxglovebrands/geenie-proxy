import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://stavokirrmjoipyyljzf.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN0YXZva2lycm1qb2lweXlsanpmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDkxOTcwOSwiZXhwIjoyMDg2NDk1NzA5fQ.X2R9UW94WQdndHsAhA7fTcV2-jQg65uu__f3-QOSFCE';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function generateApiKey() {
  // Get the first user (or most recent user)
  const { data: users, error: userError } = await supabase
    .from('users')
    .select('id, email')
    .order('created_at', { ascending: false })
    .limit(1);

  if (userError || !users || users.length === 0) {
    console.error('Error fetching user:', userError);
    process.exit(1);
  }

  const user = users[0];
  console.log(`\n📧 Generating API key for: ${user.email}`);
  console.log(`👤 User ID: ${user.id}\n`);

  // Check if user already has an active API key
  const { data: existingKey } = await supabase
    .from('api_keys')
    .select('api_key, key_prefix, created_at')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single();

  if (existingKey && existingKey.api_key) {
    console.log('✅ User already has an API key!\n');
    console.log('🔑 API Key:', existingKey.api_key);
    console.log('📝 Prefix:', existingKey.key_prefix);
    console.log('📅 Created:', new Date(existingKey.created_at).toLocaleString());
    console.log('\nUse this key to test authentication!\n');
    process.exit(0);
  }

  // Generate new API key
  console.log('⚙️  Calling generate_api_key() function...\n');

  const { data: generatedKey, error: genError } = await supabase
    .rpc('generate_api_key')
    .single();

  if (genError || !generatedKey) {
    console.error('Error generating key:', genError);
    process.exit(1);
  }

  // Insert the key
  const { error: insertError } = await supabase
    .from('api_keys')
    .insert({
      user_id: user.id,
      api_key: generatedKey.api_key,
      key_hash: generatedKey.key_hash,
      key_prefix: generatedKey.key_prefix,
      is_active: true,
    });

  if (insertError) {
    console.error('Error inserting key:', insertError);
    process.exit(1);
  }

  console.log('✅ API key generated successfully!\n');
  console.log('🔑 API Key:', generatedKey.api_key);
  console.log('📝 Prefix:', generatedKey.key_prefix);
  console.log('\n⚠️  SAVE THIS KEY - You won\'t see it again!\n');
  console.log('Use this key to test authentication:\n');
  console.log(`curl -X POST http://localhost:3001/mcp \\`);
  console.log(`  -H "Authorization: Bearer ${generatedKey.api_key}" \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -d '{"method": "tools/list", "params": {}}'`);
  console.log('');
}

generateApiKey();
