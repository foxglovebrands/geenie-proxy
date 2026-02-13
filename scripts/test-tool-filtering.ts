import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const API_KEY = process.env.TEST_API_KEY || '';

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

  console.log(`✅ Subscription updated to: ${plan}`);

  // Wait for cache to clear (5 seconds - cache TTL is 5 minutes but we'll test anyway)
  await new Promise((resolve) => setTimeout(resolve, 1000));

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

  if (result.disabledTools && result.disabledTools.length > 0) {
    console.log(`\n🚫 Disabled tools:`);
    result.disabledTools.forEach((tool: string) => {
      console.log(`   - ${tool}`);
    });
  }

  console.log(`\n✅ Enabled tools:`);
  result.tools
    .filter((tool: any) => !result.disabledTools.includes(tool.name))
    .forEach((tool: any) => {
      console.log(`   - ${tool.name}`);
    });
}

async function runTests() {
  console.log('\n🔬 Tool Filtering Test Suite');
  console.log('Testing all three subscription tiers\n');

  // Test each tier
  await testTier('starter');
  await testTier('professional');
  await testTier('agency');

  // Reset to original plan (starter)
  console.log(`\n${'='.repeat(60)}`);
  console.log('🔄 Resetting to original plan (starter)');
  console.log('='.repeat(60));
  await testTier('starter');

  console.log('\n✅ All tests complete!\n');
}

runTests();
