import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const LC_PER_USD = 400;
export const WEBSEARCH_USD_PER_1K_RESULTS = 4;
export const CREDITS_PER_1K_TOKENS = 1;
export const CREDITS_PER_IMAGE = 2;

export function computeWebSearchCredits(maxResults: number): number {
  const usd = (Math.max(0, maxResults) / 1000) * WEBSEARCH_USD_PER_1K_RESULTS;
  return usd * LC_PER_USD;
}

export async function deductCredits(
  supabaseAdmin: SupabaseClient,
  userId: string,
  totalCost: number,
  subscriptionStatus: string,
  actualWebSearchHappened: boolean,
  freeSearchesUsed: number
): Promise<void> {
  await supabaseAdmin.rpc('deduct_user_credits', {
    p_user_id: userId,
    p_amount: totalCost,
  });

  if (subscriptionStatus === 'free' && actualWebSearchHappened) {
    await supabaseAdmin
      .from('user_credits')
      .update({ free_searches_used: freeSearchesUsed + 1 })
      .eq('user_id', userId);
  }
}
