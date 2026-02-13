/**
 * Tool restrictions and subscription limits
 */

// Subscription plans
export type SubscriptionPlan = 'starter' | 'professional' | 'agency';

// Tools that are ALWAYS disabled for ALL users (destructive operations)
export const GLOBAL_BLACKLIST = [
  'delete_campaign',
  'delete_ad',
  'delete_ad_group',
  'delete_target',
  'delete_keyword',
  'delete_product_ad',
];

// Tool prefixes allowed by plan tier
export const TIER_RESTRICTIONS: Record<SubscriptionPlan, string[]> = {
  // Starter: Read-only access (view data, generate reports, check billing)
  starter: [
    'get_',
    'list_',
    'describe_',
    'report_',
    'billing_',
    'account_info_',
  ],

  // Professional: Read + Write (can create, update, pause, resume campaigns/ads)
  professional: [
    'get_',
    'list_',
    'describe_',
    'report_',
    'billing_',
    'account_info_',
    'create_',
    'update_',
    'pause_',
    'resume_',
    'enable_',
    'disable_',
  ],

  // Agency: Full access (except global blacklist)
  agency: ['*'], // Wildcard means all tools allowed
};

/**
 * Check if a tool is allowed for a given subscription plan
 */
export function isToolAllowed(toolName: string, plan: SubscriptionPlan): boolean {
  // Always block global blacklist
  if (GLOBAL_BLACKLIST.includes(toolName)) {
    return false;
  }

  // Agency users get everything except blacklist
  const allowedPrefixes = TIER_RESTRICTIONS[plan];
  if (allowedPrefixes.includes('*')) {
    return true;
  }

  // Check if tool starts with any allowed prefix
  return allowedPrefixes.some((prefix) => toolName.startsWith(prefix));
}
