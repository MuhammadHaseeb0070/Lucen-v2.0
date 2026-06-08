import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCreditsStore } from './creditsStore';
import * as db from '../services/database';
import { hasActiveSessionSync } from '../lib/supabase';

vi.mock('../services/database', () => ({
  fetchCredits: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  hasActiveSessionSync: vi.fn(),
}));

describe('creditsStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useCreditsStore.setState({
      remainingCredits: 4000,
      totalUsed: 0,
      subscriptionStatus: 'free',
      subscriptionPlan: 'free',
      customerPortalUrl: null,
      renewsAt: null,
      billingCycleUsage: 0,
      ledgers: [],
      isSynced: false,
      isLoading: false,
    });
  });

  it('should verify hasEnoughCredits returns correct boolean', () => {
    const store = useCreditsStore.getState();
    expect(store.hasEnoughCredits()).toBe(true);

    useCreditsStore.setState({ remainingCredits: 0 });
    expect(useCreditsStore.getState().hasEnoughCredits()).toBe(false);

    useCreditsStore.setState({ remainingCredits: -10 });
    expect(useCreditsStore.getState().hasEnoughCredits()).toBe(false);
  });

  it('should sync credits from server when active session exists', async () => {
    vi.mocked(hasActiveSessionSync).mockReturnValue(true);
    const mockResult = {
      remaining: 5000,
      used: 150,
      billingCycleUsage: 100,
      subscriptionStatus: 'active',
      subscriptionPlan: 'regular' as const,
      customerPortalUrl: 'https://billing.portal',
      renewsAt: '2026-07-08T00:00:00Z',
      ledgers: [],
    };
    vi.mocked(db.fetchCredits).mockResolvedValue(mockResult);

    const store = useCreditsStore.getState();
    await store.syncFromServer();

    const updatedState = useCreditsStore.getState();
    expect(updatedState.remainingCredits).toBe(5000);
    expect(updatedState.subscriptionPlan).toBe('regular');
    expect(updatedState.isSynced).toBe(true);
  });

  it('should not sync credits from server if session does not exist', async () => {
    vi.mocked(hasActiveSessionSync).mockReturnValue(false);
    const store = useCreditsStore.getState();
    await store.syncFromServer();

    expect(useCreditsStore.getState().isSynced).toBe(false);
  });
});
