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
 * Filter tools based on disabled list
 * Instead of just listing disabled tools, we REMOVE them from the tools array
 * This ensures Claude Desktop never sees tools the user can't access
 */
export function injectDisabledTools(
  response: any,
  disabledTools: string[]
): any {
  // Clone the response to avoid mutation
  const modifiedResponse = { ...response };

  // Create a Set for faster lookup
  const disabledSet = new Set(disabledTools);

  // Filter out disabled tools from the tools array
  if (modifiedResponse.tools && Array.isArray(modifiedResponse.tools)) {
    modifiedResponse.tools = modifiedResponse.tools.filter(
      (tool: MCPTool) => !disabledSet.has(tool.name)
    );
  }

  // Also include the disabledTools array for transparency/debugging
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
