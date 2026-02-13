/**
 * Tool filtering service for tier-based restrictions
 */

export interface PlanDetails {
  name: string;
  price: string;
}

export const PLAN_DETAILS: Record<string, PlanDetails> = {
  starter: { name: 'Starter', price: '$49/mo' },
  professional: { name: 'Professional', price: '$149/mo' },
  agency: { name: 'Agency', price: '$249/mo' }
};

/**
 * Check if a tool is allowed for a given plan
 */
export function isToolAllowed(toolName: string, userPlan: string): boolean {
  const normalizedTool = toolName.toLowerCase();

  if (userPlan === 'starter') {
    // Starter: Only SP write access
    // Block SB/SD write operations
    const starterBlockedPatterns = [
      'create_sponsored_brands',
      'update_sponsored_brands',
      'pause_sponsored_brands',
      'resume_sponsored_brands',
      'create_sponsored_display',
      'update_sponsored_display',
      'pause_sponsored_display',
      'resume_sponsored_display',
      'set_budget', // For SB/SD campaigns
      'dsp' // All DSP operations
    ];

    return !starterBlockedPatterns.some(pattern => normalizedTool.includes(pattern));
  }

  if (userPlan === 'professional') {
    // Professional: SP, SB, SD full access
    // Block only DSP
    return !normalizedTool.includes('dsp');
  }

  // Agency: All tools allowed (except global blacklist)
  return true;
}

/**
 * Get the required plan for a blocked tool
 */
export function getRequiredPlan(toolName: string): 'professional' | 'agency' {
  const normalizedTool = toolName.toLowerCase();

  // DSP requires Agency
  if (normalizedTool.includes('dsp')) {
    return 'agency';
  }

  // SB/SD write operations require Professional
  if (
    normalizedTool.includes('sponsored_brands') ||
    normalizedTool.includes('sponsored_display')
  ) {
    return 'professional';
  }

  return 'professional'; // Default
}

/**
 * Generate upgrade message for a blocked tool
 */
export function getUpgradeMessage(toolName: string, currentPlan: string): string {
  const current = PLAN_DETAILS[currentPlan];
  const requiredTier = getRequiredPlan(toolName);
  const required = PLAN_DETAILS[requiredTier];

  const featureName = toolName.toLowerCase().includes('dsp')
    ? 'DSP (Demand-Side Platform) features'
    : 'Sponsored Brands and Display campaign management';

  return `You're currently on the ${current.name} plan (${current.price}). ${featureName} require${requiredTier === 'agency' ? 's' : ''} ${required.name} (${required.price}). Upgrade at https://app.geenie.io/dashboard/billing to unlock this feature.`;
}
