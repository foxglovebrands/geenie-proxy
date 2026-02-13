import { supabase } from './supabase.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

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
 */
export async function getValidAccessToken(
  userId: string,
  profileId?: string
): Promise<ValidToken> {
  // Fetch user's Amazon accounts
  let query = supabase
    .from('amazon_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('connection_status', 'connected');

  // If profileId specified, filter by it
  if (profileId) {
    query = query.eq('amazon_profile_id', profileId);
  }

  const { data: accounts, error } = await query;

  if (error || !accounts || accounts.length === 0) {
    throw new Error('NO_CONNECTED_ACCOUNTS');
  }

  // Use first account (or the one matching profileId)
  const account = accounts[0] as AmazonAccount;

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
