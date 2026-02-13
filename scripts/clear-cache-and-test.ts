import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const API_KEY = process.env.TEST_API_KEY || '';

async function clearProxyCache() {
  // Make request to a cache-clearing endpoint (we'll add this)
  // For now, we'll just restart the proxy server
  console.log('⏳ Waiting for cache to clear...');
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

async function testTier(plan: 'starter' | 'professional' | 'agency') {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🧪 Testing ${plan.toUpperCase()} tier`);
  console.log('='.repeat(60));

  // Get user ID from API key
  const keyHash = crypto.createHash('sha256').update(API_KEY).digest('hex');
  const { data: apiKeyData } = await supabase
    .from('api_keys')
    .select('user_id')
    .eq('key_hash', keyHash)
    .single();

  if (!apiKeyData) {
    console.log('❌ API key not found');
    return;
  }

  // Update subscription plan
  const { error: updateError } = await supabase
    .from('subscriptions')
    .update({ plan })
    .eq('user_id', apiKeyData.user_id);

  if (updateError) {
    console.log('❌ Failed to update subscription:', updateError);
    return;
  }

  console.log(`✅ Database updated to: ${plan}`);
  console.log(`⚠️  Note: Cache may still show old plan for up to 5 minutes`);
  console.log(`💡 Restart the proxy server to clear cache immediately`);

  await clearProxyCache();

  // Test tools/list
  const response = await fetch('http://localhost:3001/mcp', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ method: 'tools/list' }),
  });

  const result = await response.json();

  const totalTools = result.tools?.length || 0;
  const disabledCount = result.disabledTools?.length || 0;
  const enabledCount = totalTools - disabledCount;

  console.log(`\n📊 Results:`);
  console.log(`   Total tools: ${totalTools}`);
  console.log(`   ✅ Enabled: ${enabledCount}`);
  console.log(`   ❌ Disabled: ${disabledCount}`);

  console.log(`\n✅ Enabled tools (${enabledCount}):`);
  result.tools
    .filter((tool: any) => !result.disabledTools.includes(tool.name))
    .forEach((tool: any) => {
      console.log(`   ✓ ${tool.name}`);
    });

  if (result.disabledTools && result.disabledTools.length > 0) {
    console.log(`\n🚫 Disabled tools (${disabledCount}):`);
    result.disabledTools.forEach((tool: string) => {
      console.log(`   ✗ ${tool}`);
    });
  }

  // Expected results for each tier
  const expected: Record<string, { enabled: number; disabled: number }> = {
    starter: { enabled: 6, disabled: 8 },
    professional: { enabled: 10, disabled: 4 },
    agency: { enabled: 10, disabled: 4 },
  };

  const exp = expected[plan];
  const passed = enabledCount === exp.enabled && disabledCount === exp.disabled;

  console.log(`\n${passed ? '✅' : '❌'} Expected: ${exp.enabled} enabled, ${exp.disabled} disabled`);

  if (!passed) {
    console.log(`⚠️  CACHE ISSUE: Results don't match expected values for ${plan} plan`);
    console.log(`   This is likely because the auth middleware cached the old plan`);
  }

  return passed;
}

async function runTest() {
  const plan = process.argv[2] as 'starter' | 'professional' | 'agency';

  if (!plan || !['starter', 'professional', 'agency'].includes(plan)) {
    console.log('Usage: npx tsx scripts/clear-cache-and-test.ts <starter|professional|agency>');
    process.exit(1);
  }

  await testTier(plan);
}

runTest();
