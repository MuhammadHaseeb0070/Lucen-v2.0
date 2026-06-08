import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from './authStore';
import { supabase, isSupabaseEnabled } from '../lib/supabase';
import { getUser } from '../services/auth';

vi.mock('../lib/supabase', () => ({
  isSupabaseEnabled: vi.fn(),
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      verifyOtp: vi.fn(),
    },
  },
}));

vi.mock('../services/auth', () => ({
  getUser: vi.fn(),
}));

describe('authStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({
      user: null,
      isLoading: false,
      isInitialized: false,
      otpVerified: false,
      sessionExpired: false,
      error: null,
    });
  });

  it('should initialize with stub user if Supabase is disabled', async () => {
    vi.mocked(isSupabaseEnabled).mockReturnValue(false);
    const mockUser = { id: 'local-user', email: 'user@lucen.app', name: 'Lucen User' };
    vi.mocked(getUser).mockResolvedValue(mockUser);

    const store = useAuthStore.getState();
    await store.initialize();

    const updatedState = useAuthStore.getState();
    expect(updatedState.user).toEqual(mockUser);
    expect(updatedState.isInitialized).toBe(true);
  });

  it('should handle signIn success and user mapping', async () => {
    vi.mocked(isSupabaseEnabled).mockReturnValue(true);
    const mockSession = { access_token: 'valid-token' };
    const mockUser = { id: 'user-id-123', email: 'user@lucen.app', user_metadata: { full_name: 'Test Account' } };

    vi.mocked(supabase!.auth.signInWithPassword).mockResolvedValue({
      data: { session: mockSession as any, user: mockUser as any },
      error: null,
    });

    const store = useAuthStore.getState();
    const result = await store.signIn('user@lucen.app', 'password123');

    expect(result).toBeNull();
    const updatedState = useAuthStore.getState();
    expect(updatedState.user?.id).toBe('user-id-123');
    expect(updatedState.user?.name).toBe('Test Account');
  });

  it('should handle signIn errors correctly', async () => {
    vi.mocked(isSupabaseEnabled).mockReturnValue(true);
    vi.mocked(supabase!.auth.signInWithPassword).mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'Invalid credentials' } as any,
    });

    const store = useAuthStore.getState();
    const result = await store.signIn('user@lucen.app', 'wrongpass');

    expect(result).toBe('Invalid credentials');
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().error).toBe('Invalid credentials');
  });
});
