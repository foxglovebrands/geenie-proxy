import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';
import type { AmazonAccount } from './token-manager.js';

/**
 * List all connected Amazon accounts for a user
 */
export async function listAccounts(userId: string): Promise<AmazonAccount[]> {
  const { data: accounts, error } = await supabase
    .from('amazon_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('connection_status', 'connected')
    .order('created_at', { ascending: true });

  if (error) {
    logger.error({ error, userId }, 'Failed to list Amazon accounts');
    throw new Error('Failed to list accounts');
  }

  return (accounts || []) as AmazonAccount[];
}

/**
 * Get the currently active account for a user
 */
export async function getActiveAccount(userId: string): Promise<AmazonAccount | null> {
  // Get user's active account ID from users table
  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('active_amazon_account_id')
    .eq('id', userId)
    .single();

  if (profileError || !profile || !profile.active_amazon_account_id) {
    return null;
  }

  // Fetch the active account details
  const { data: account, error: accountError } = await supabase
    .from('amazon_accounts')
    .select('*')
    .eq('id', profile.active_amazon_account_id)
    .eq('connection_status', 'connected')
    .single();

  if (accountError || !account) {
    logger.warn({ userId, accountId: profile.active_amazon_account_id }, 'Active account not found or not connected');
    return null;
  }

  return account as AmazonAccount;
}

/**
 * Switch to a different Amazon account
 * @param userId - The user's ID
 * @param accountIdentifier - Account name, profile ID, or advertiser account ID
 */
export async function switchAccount(
  userId: string,
  accountIdentifier: string
): Promise<AmazonAccount> {
  // Fetch all connected accounts
  const accounts = await listAccounts(userId);

  if (accounts.length === 0) {
    throw new Error('NO_CONNECTED_ACCOUNTS');
  }

  const identifier = accountIdentifier.toLowerCase().trim();

  // Try to find account by name, profile ID, or advertiser account ID
  const matchedAccount = accounts.find((account) => {
    const accountName = (account.account_name || '').toLowerCase();
    const profileId = account.amazon_profile_id.toLowerCase();
    const advertiserId = (account.amazon_advertiser_account_id || '').toLowerCase();

    return (
      accountName.includes(identifier) ||
      identifier.includes(accountName) ||
      profileId === identifier ||
      advertiserId === identifier
    );
  });

  if (!matchedAccount) {
    logger.warn({ userId, accountIdentifier, availableAccounts: accounts.length }, 'Account not found');
    throw new Error('ACCOUNT_NOT_FOUND');
  }

  // Update user's active account
  const { error: updateError } = await supabase
    .from('users')
    .update({ active_amazon_account_id: matchedAccount.id })
    .eq('id', userId);

  if (updateError) {
    logger.error({ error: updateError, userId, accountId: matchedAccount.id }, 'Failed to update active account');
    throw new Error('FAILED_TO_SWITCH_ACCOUNT');
  }

  logger.info(
    {
      userId,
      accountId: matchedAccount.id,
      accountName: matchedAccount.account_name,
      profileId: matchedAccount.amazon_profile_id,
    },
    'Successfully switched to account'
  );

  return matchedAccount as AmazonAccount;
}

/**
 * Clear active account selection (revert to default first account)
 */
export async function clearActiveAccount(userId: string): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ active_amazon_account_id: null })
    .eq('id', userId);

  if (error) {
    logger.error({ error, userId }, 'Failed to clear active account');
    throw new Error('FAILED_TO_CLEAR_ACCOUNT');
  }

  logger.info({ userId }, 'Cleared active account selection');
}
