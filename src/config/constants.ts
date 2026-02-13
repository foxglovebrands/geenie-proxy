/**
 * Tool restrictions and subscription limits
 */

// Subscription plans
export type SubscriptionPlan = 'starter' | 'professional' | 'agency';

// Actions that are ALWAYS disabled for ALL users (destructive operations)
// These match the action part after the namespace (e.g., "delete_campaign" in "campaign_management-delete_campaign")
export const GLOBAL_BLACKLIST = [
  'delete_campaign',
  'delete_ad',
  'delete_ad_group',
  'delete_target',
  'delete_ad_association',
  // Note: delete_report and delete_subscription are allowed - users should be able to clean up their own reports/subscriptions
];

// Tool prefixes allowed by plan tier
export const TIER_RESTRICTIONS: Record<SubscriptionPlan, string[]> = {
  // Starter: Read-only access (view data, generate reports, check billing)
  starter: [
    'get_',
    'get',       // Some tools use 'get' without underscore (e.g., user_invitation-get)
    'list_',
    'list',      // Some tools use 'list' without underscore
    'query_',    // Amazon uses query_ for read operations
    'retrieve_', // Amazon uses retrieve_ for read operations
    'describe_',
    'report_',
    'create_report',        // Creating reports is a READ operation (just requesting data)
    'create_product_report', // Same - generating reports to view metrics
    'billing_',
    'account_info_',
  ],

  // Professional: Read + Write (can create, update, pause, resume campaigns/ads)
  professional: [
    'get_',
    'get',
    'list_',
    'list',
    'query_',
    'retrieve_',
    'describe_',
    'report_',
    'billing_',
    'account_info_',
    'create_',
    'create',    // Some tools use 'create' without underscore
    'update_',
    'update',    // Some tools use 'update' without underscore
    'add_',
    'associate_',
    'disassociate_',
    'pause_',
    'resume_',
    'enable_',
    'disable_',
    'redeem',    // User invitation redemption
  ],

  // Agency: Full access (except global blacklist)
  agency: ['*'], // Wildcard means all tools allowed
};

/**
 * Check if a tool is allowed for a given subscription plan
 */
export function isToolAllowed(toolName: string, plan: SubscriptionPlan): boolean {
  // Amazon MCP tools use format: "namespace-action_name" (e.g., "campaign_management-get_campaigns")
  // Extract the action part (everything after the first dash)
  const actionPart = toolName.includes('-') ? toolName.split('-')[1] : toolName;

  // Always block global blacklist (check action part)
  if (GLOBAL_BLACKLIST.includes(actionPart)) {
    return false;
  }

  // Agency users get everything except blacklist
  const allowedPrefixes = TIER_RESTRICTIONS[plan];
  if (allowedPrefixes.includes('*')) {
    return true;
  }

  // Check if the action starts with any allowed prefix
  return allowedPrefixes.some((prefix) => actionPart.startsWith(prefix));
}
