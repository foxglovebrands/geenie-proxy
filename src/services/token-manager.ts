import { supabase } from './supabase.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getActiveAccount } from './account-switcher.js';

// Amazon account interface
export interface AmazonAccount {
  id: string;
  user_id: string;
  account_name: string | null;
  amazon_profile_id: string;
  amazon_advertiser_account_id: string | null;
  marketplace: string;
  region: 'na' | 'eu' | 'fe';
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: string;
  connection_status: string;
}

export interface ValidToken {
  accessToken: string;
  account: AmazonAccount;
}

/**
 * Get a valid Amazon access token for the user
 * Automatically refreshes if token is expired
 *
 * @param userId - The user's ID
 * @param profileId - Optional specific profile ID to use
 * @param requestContext - Optional request context for smart account selection
 */
export async function getValidAccessToken(
  userId: string,
  profileId?: string,
  requestContext?: any
): Promise<ValidToken> {
  // Fetch user's Amazon accounts
  let query = supabase
    .from('amazon_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('connection_status', 'connected')
    .order('created_at', { ascending: true }); // Consistent ordering

  const { data: accounts, error } = await query;

  if (error || !accounts || accounts.length === 0) {
    throw new Error('NO_CONNECTED_ACCOUNTS');
  }

  let account: AmazonAccount | undefined;

  // Strategy 0: User's active account preference (set via account switcher)
  const activeAccount = await getActiveAccount(userId);
  if (activeAccount && !profileId) {
    // Only use active account if no explicit profileId was requested
    const matched = accounts.find((a) => a.id === activeAccount.id);
    if (matched) {
      account = matched as AmazonAccount;
      logger.info(
        { accountName: account.account_name, profileId: account.amazon_profile_id },
        'Using active account preference'
      );
    } else {
      // Active account is no longer connected, fall through to other strategies
      logger.warn(
        { activeAccountId: activeAccount.id },
        'Active account no longer connected, using fallback selection'
      );
    }
  }

  // If no account selected yet, try other strategies
  if (!account) {
    // Strategy 1: Explicit profileId provided
    if (profileId) {
    const matched = accounts.find((a) => a.amazon_profile_id === profileId);
    if (matched) {
      account = matched as AmazonAccount;
      logger.info({ profileId, marketplace: account.marketplace }, 'Selected account by profileId');
    } else {
      logger.warn({ profileId }, 'ProfileId not found, using first account');
      account = accounts[0] as AmazonAccount;
    }
  }
  // Strategy 2: Smart selection based on request context
  else if (requestContext && accounts.length > 1) {
    const contextString = JSON.stringify(requestContext).toLowerCase();

    // Try to match by advertiser account ID, account name, or marketplace
    const marketplaceMatches = accounts.filter((a) => {
      const marketplace = a.marketplace.toLowerCase();
      const accountName = (a.account_name || '').toLowerCase();
      const advertiserId = (a.amazon_advertiser_account_id || '').toLowerCase();
      const profileId = a.amazon_profile_id.toLowerCase();

      // Priority 1: Check for advertiser account ID (most specific)
      if (advertiserId && contextString.includes(advertiserId)) {
        logger.info({ advertiserId }, 'Matched by advertiser account ID');
        return true;
      }

      // Priority 2: Check for profile ID
      if (contextString.includes(profileId)) {
        logger.info({ profileId }, 'Matched by profile ID');
        return true;
      }

      // Priority 3: Check for account name (if user named their accounts)
      if (accountName && contextString.includes(accountName)) {
        logger.info({ accountName }, 'Matched by account name');
        return true;
      }

      // Priority 4: Check for marketplace references
      if (contextString.includes(marketplace)) {
        logger.info({ marketplace }, 'Matched by marketplace URL');
        return true;
      }

      // Priority 5: Common marketplace aliases
      const matchesAlias = (
        (marketplace.includes('amazon.com') && (contextString.includes('us') || contextString.includes('usa') || contextString.includes('united states'))) ||
        (marketplace.includes('amazon.co.uk') && (contextString.includes('uk') || contextString.includes('britain'))) ||
        (marketplace.includes('amazon.de') && (contextString.includes('germany') || contextString.includes('de'))) ||
        (marketplace.includes('amazon.fr') && (contextString.includes('france') || contextString.includes('fr'))) ||
        (marketplace.includes('amazon.ca') && (contextString.includes('canada') || contextString.includes('ca')))
      );

      if (matchesAlias) {
        logger.info({ marketplace, hint: 'alias' }, 'Matched by marketplace alias');
        return true;
      }

      return false;
    });

    if (marketplaceMatches.length === 1) {
      account = marketplaceMatches[0] as AmazonAccount;
      logger.info(
        { marketplace: account.marketplace, hint: 'context' },
        'Smart-selected account based on request context'
      );
    } else if (marketplaceMatches.length > 1) {
      // Multiple matches - use first one but log warning
      account = marketplaceMatches[0] as AmazonAccount;
      logger.warn(
        { matchCount: marketplaceMatches.length, selected: account.marketplace },
        'Multiple accounts matched context, using first'
      );
    } else {
      // No matches - default to first account
      account = accounts[0] as AmazonAccount;
      logger.info({ marketplace: account.marketplace }, 'No context match, using first account');
    }
  }
    // Strategy 3: Default to first account
    else {
      account = accounts[0] as AmazonAccount;
      logger.info(
        { marketplace: account.marketplace, totalAccounts: accounts.length },
        'Using first account (default)'
      );
    }
  } // End of: if (!account)

  // At this point, account should always be defined
  if (!account) {
    throw new Error('Failed to select Amazon account');
  }

  logger.info(
    {
      userId,
      profileId: account.amazon_profile_id,
      marketplace: account.marketplace,
    },
    'Fetched Amazon account'
  );

  // Check if token is still valid (with 5-minute buffer)
  const expiresAt = new Date(account.token_expires_at);
  const now = new Date();
  const bufferMs = 5 * 60 * 1000; // 5 minutes

  if (expiresAt.getTime() > now.getTime() + bufferMs) {
    // Token still valid
    logger.debug('Access token still valid');
    return {
      accessToken: account.access_token_encrypted,
      account,
    };
  }

  // Token expired or about to expire - refresh it
  logger.info(
    { profileId: account.amazon_profile_id, expiresAt },
    'Access token expired, refreshing...'
  );

  try {
    const newToken = await refreshAmazonToken(account);

    return {
      accessToken: newToken,
      account: { ...account, access_token_encrypted: newToken },
    };
  } catch (error) {
    logger.error(
      { error, userId, profileId: account.amazon_profile_id },
      'Failed to refresh Amazon token'
    );

    // Mark account as expired
    await supabase
      .from('amazon_accounts')
      .update({ connection_status: 'expired' })
      .eq('id', account.id);

    throw new Error('TOKEN_REFRESH_FAILED');
  }
}

/**
 * Refresh an Amazon OAuth token using the refresh_token
 */
async function refreshAmazonToken(account: AmazonAccount): Promise<string> {
  const tokenEndpoint = 'https://api.amazon.com/auth/o2/token';

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: account.refresh_token_encrypted,
    client_id: config.lwa.clientId,
    client_secret: config.lwa.clientSecret,
  });

  logger.debug({ endpoint: tokenEndpoint }, 'Calling Amazon token refresh');

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(
      { status: response.status, error: errorText },
      'Amazon token refresh failed'
    );
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  const tokens = await response.json() as { access_token: string; expires_in: number };

  // Calculate new expiry time (Amazon tokens expire in 3600 seconds = 1 hour)
  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  // Update database with new token
  const { error: updateError } = await supabase
    .from('amazon_accounts')
    .update({
      access_token_encrypted: tokens.access_token,
      token_expires_at: newExpiresAt.toISOString(),
      connection_status: 'connected',
    })
    .eq('id', account.id);

  if (updateError) {
    logger.error({ error: updateError }, 'Failed to update token in database');
    throw new Error('Failed to update token');
  }

  logger.info(
    { profileId: account.amazon_profile_id, expiresAt: newExpiresAt },
    'Successfully refreshed Amazon token'
  );

  return tokens.access_token;
}
