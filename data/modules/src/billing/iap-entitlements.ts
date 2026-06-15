/**
 * IAP Entitlements RPC - Grants and checks entitlements for web purchases
 * 
 * Called by:
 *   - /api/billing/success (after Stripe payment)
 *   - /api/billing/entitlements (to check user's current entitlements)
 */

const COLLECTION = 'library_entitlements';

interface Entitlement {
  id: string;
  is_active: boolean;
  product_id: string;
  granted_at: string;
  expires_at?: string;
  is_subscription: boolean;
  source: 'stripe_web' | 'apple' | 'google' | 'admin';
}

interface GrantRequest {
  user_id: string;
  product_id: string;
  entitlements: string[];
  purchase_info: {
    sessionId: string;
    placement: string;
    examSlug?: string;
    amount: number;
    currency: string;
  };
  source: 'stripe_web' | 'apple' | 'google' | 'admin';
  timestamp: number;
}

interface GetEntitlementsRequest {
  user_id: string;
}

/**
 * RPC: iap_grant_entitlement
 * Grants entitlements to a user after successful payment
 */
export function rpcIapGrantEntitlement(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  const request: GrantRequest = JSON.parse(payload);
  const { user_id, product_id, entitlements, purchase_info, source, timestamp } = request;

  if (!user_id || !product_id || !entitlements?.length) {
    throw new Error('Missing required fields: user_id, product_id, entitlements');
  }

  logger.info(`[IAP] Granting entitlements to ${user_id}: ${entitlements.join(', ')}`);

  // Determine if subscription or one-time
  const isSubscription = product_id.includes('_w_') || product_id.includes('_m_') || product_id.includes('_y_');
  
  // Calculate expiry for subscriptions
  let expiresAt: string | undefined;
  if (isSubscription && !product_id.includes('lifetime')) {
    const now = new Date();
    if (product_id.includes('_w_')) {
      now.setDate(now.getDate() + 7);
    } else if (product_id.includes('_m_')) {
      now.setMonth(now.getMonth() + 1);
    } else if (product_id.includes('_y_')) {
      now.setFullYear(now.getFullYear() + 1);
    }
    expiresAt = now.toISOString();
  }

  // Read existing entitlements
  let existing: Record<string, Entitlement> = {};
  try {
    const records = nk.storageRead([{ collection: COLLECTION, key: user_id, userId: user_id }]);
    if (records.length > 0 && records[0].value) {
      existing = records[0].value as Record<string, Entitlement>;
    }
  } catch (e) {
    // No existing record, start fresh
  }

  // Add/update entitlements
  const now = new Date().toISOString();
  for (const entId of entitlements) {
    existing[entId] = {
      id: entId,
      is_active: true,
      product_id,
      granted_at: now,
      expires_at: expiresAt,
      is_subscription: isSubscription,
      source,
    };
  }

  // Store updated entitlements
  nk.storageWrite([{
    collection: COLLECTION,
    key: user_id,
    userId: user_id,
    value: existing,
    permissionRead: 2,  // Owner + server
    permissionWrite: 0, // Server only
  }]);

  // Log purchase event
  try {
    nk.event('iap_purchased', {
      user_id,
      product_id,
      entitlements: entitlements.join(','),
      amount: purchase_info.amount,
      currency: purchase_info.currency,
      source,
      placement: purchase_info.placement,
      exam_slug: purchase_info.examSlug || '',
    });
  } catch (e) {
    logger.warn(`[IAP] Failed to log event: ${e}`);
  }

  logger.info(`[IAP] Successfully granted ${entitlements.length} entitlements to ${user_id}`);

  return JSON.stringify({ 
    ok: true, 
    entitlements: Object.keys(existing),
    tier: determineTier(existing),
  });
}

/**
 * RPC: user_get_entitlements
 * Returns user's current entitlements
 */
export function rpcUserGetEntitlements(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  const request: GetEntitlementsRequest = JSON.parse(payload);
  const { user_id } = request;

  if (!user_id) {
    throw new Error('Missing user_id');
  }

  // Read entitlements
  let entitlements: Record<string, Entitlement> = {};
  try {
    const records = nk.storageRead([{ collection: COLLECTION, key: user_id, userId: user_id }]);
    if (records.length > 0 && records[0].value) {
      entitlements = records[0].value as Record<string, Entitlement>;
    }
  } catch (e) {
    // No entitlements
  }

  // Check expiry and deactivate expired
  const now = new Date();
  for (const [key, ent] of Object.entries(entitlements)) {
    if (ent.expires_at && new Date(ent.expires_at) < now) {
      ent.is_active = false;
    }
  }

  // Get usage quotas for today
  const today = new Date().toISOString().split('T')[0];
  let quotas = { chat_turns_used_today: 0, animations_used_today: 0 };
  try {
    const quotaRecords = nk.storageRead([{ 
      collection: 'user_quotas', 
      key: `${user_id}_${today}`, 
      userId: user_id 
    }]);
    if (quotaRecords.length > 0) {
      quotas = quotaRecords[0].value as any;
    }
  } catch (e) {}

  return JSON.stringify({
    entitlements,
    tier: determineTier(entitlements),
    quotas,
  });
}

/**
 * Determine user tier based on active entitlements
 */
function determineTier(entitlements: Record<string, Entitlement>): 'free' | 'plus' | 'pro' {
  const active = Object.values(entitlements).filter(e => e.is_active);
  
  // Pro entitlements
  if (active.some(e => e.id === 'tutor_unlimited' || e.id === 'kb_full' || e.id === 'avatar_access')) {
    return 'pro';
  }
  
  // Plus entitlements
  if (active.some(e => e.id === 'quiz_vip' || e.id === 'tutor_basic' || e.id === 'quiz_categories')) {
    return 'plus';
  }
  
  return 'free';
}

/**
 * Register RPCs
 */
export function register(
  initializer: nkruntime.Initializer,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama
): void {
  initializer.registerRpc('iap_grant_entitlement', rpcIapGrantEntitlement);
  initializer.registerRpc('user_get_entitlements', rpcUserGetEntitlements);
  
  logger.info('[IAP] Entitlements RPCs registered');
}
