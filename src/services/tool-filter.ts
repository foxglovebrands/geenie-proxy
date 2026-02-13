import { SubscriptionPlan, isToolAllowed } from '../config/constants.js';
import { logger } from '../utils/logger.js';

/**
 * Tool interface from Amazon MCP
 */
export interface MCPTool {
  name: string;
  description?: string;
  category?: string;
  [key: string]: any;
}

/**
 * Filter tools based on subscription tier
 * Returns an array of disabled tool names
 */
export function getDisabledTools(
  availableTools: MCPTool[],
  plan: SubscriptionPlan
): string[] {
  const disabledTools: string[] = [];

  for (const tool of availableTools) {
    if (!isToolAllowed(tool.name, plan)) {
      disabledTools.push(tool.name);
    }
  }

  logger.debug(
    {
      plan,
      totalTools: availableTools.length,
      disabledCount: disabledTools.length,
      enabledCount: availableTools.length - disabledTools.length,
    },
    'Filtered tools by subscription tier'
  );

  return disabledTools;
}

/**
 * Inject disabledTools into tools/list response
 */
export function injectDisabledTools(
  response: any,
  disabledTools: string[]
): any {
  // Clone the response to avoid mutation
  const modifiedResponse = { ...response };

  // Add disabledTools array to response
  modifiedResponse.disabledTools = disabledTools;

  return modifiedResponse;
}

/**
 * Get human-readable tier explanation
 */
export function getTierExplanation(plan: SubscriptionPlan): string {
  const explanations: Record<SubscriptionPlan, string> = {
    starter:
      'Your Starter plan includes read-only access to view campaigns, ads, and reports.',
    professional:
      'Your Professional plan includes read and write access to create, update, and manage campaigns.',
    agency:
      'Your Agency plan includes full access to all tools except destructive delete operations.',
  };

  return explanations[plan];
}
