import { useEffect, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, ArrowRight, Loader2 } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import Logo from './Logo';

type AuthMode = 'signin' | 'signup' | 'forgot_password';

function AuthScreen() {
    const navigate = useNavigate();
    const { signIn, signUp, resetPasswordForEmail, error, isLoading, clearError } = useAuthStore();
    const [searchParams] = useSearchParams();
    const initialMode = ((): AuthMode => {
        const mode = searchParams.get('mode');
        if (mode === 'signup' || mode === 'forgot_password') return mode;
        if (mode === 'login') return 'signin';
        return 'signin';
    })();
    const [mode, setMode] = useState<AuthMode>(initialMode);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [localError, setLocalError] = useState('');

    const toggleMode = (newMode: AuthMode) => {
        setMode(newMode);
        setLocalError('');
        clearError();
        setConfirmPassword('');
    };

    useEffect(() => {
        setMode(initialMode);
    }, [initialMode]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLocalError('');
        clearError();

        // Validation
        if (!email.trim()) {
            setLocalError('Email is required');
            return;
        }

        if (mode === 'forgot_password') {
            const err = await resetPasswordForEmail(email.trim());
            if (!err) {
                // Navigate to OTP verify screen for password recovery
                navigate(`/auth/verify-otp?type=recovery&email=${encodeURIComponent(email.trim())}`);
            }
            return;
        }

        if (!password) {
            setLocalError('Password is required');
            return;
        }
        if (password.length < 6) {
            setLocalError('Password must be at least 6 characters');
            return;
        }
        if (mode === 'signup' && password !== confirmPassword) {
            setLocalError('Passwords do not match');
            return;
        }

        if (mode === 'signin') {
            await signIn(email.trim(), password);
            // authStore will set user → Layout will unmount AuthScreen automatically
        } else if (mode === 'signup') {
            const err = await signUp(email.trim(), password);
            if (!err && !useAuthStore.getState().user) {
                // OTP email was sent — navigate to verify screen
                navigate(`/auth/verify-otp?type=signup&email=${encodeURIComponent(email.trim())}`);
            }
        }
    };

    const displayError = localError || error;

    return (
        <div className="auth-screen">
            <div className="auth-container">
                {/* Branding */}
                <div className="auth-brand">
                    <div className="auth-logo">
                        <Logo size={28} />
                    </div>
                    <h1 className="auth-title">Lucen</h1>
                    <p className="auth-subtitle">
                        {mode === 'signin' && 'Welcome back'}
                        {mode === 'signup' && 'Create your account'}
                        {mode === 'forgot_password' && 'Reset Password'}
                    </p>
                </div>

                {/* Form */}
                <form className="auth-form" onSubmit={handleSubmit}>
                    {/* Email */}
                    <div className="auth-field">
                        <label className="auth-label" htmlFor="auth-email">Email</label>
                        <div className="auth-input-wrapper">
                            <Mail size={16} className="auth-input-icon" />
                            <input
                                id="auth-email"
                                type="email"
                                className="auth-input"
                                placeholder="you@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                autoComplete="email"
                                autoFocus
                            />
                        </div>
                    </div>

                    {/* Password */}
                    {mode !== 'forgot_password' && (
                        <div className="auth-field">
                            <div className="auth-label-row">
                                <label className="auth-label" htmlFor="auth-password">Password</label>
                                {mode === 'signin' && (
                                    <button
                                        type="button"
                                        className="auth-forgot-link"
                                        onClick={() => toggleMode('forgot_password')}
                                    >
                                        Forgot?
                                    </button>
                                )}
                            </div>
                            <div className="auth-input-wrapper">
                                <Lock size={16} className="auth-input-icon" />
                                <input
                                    id="auth-password"
                                    type={showPassword ? 'text' : 'password'}
                                    className="auth-input"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                                />
                                <button
                                    type="button"
                                    className="auth-toggle-pass"
                                    onClick={() => setShowPassword(!showPassword)}
                                    tabIndex={-1}
                                >
                                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Confirm Password (signup only) */}
                    {mode === 'signup' && (
                        <div className="auth-field">
                            <label className="auth-label" htmlFor="auth-confirm">Confirm Password</label>
                            <div className="auth-input-wrapper">
                                <Lock size={16} className="auth-input-icon" />
                                <input
                                    id="auth-confirm"
                                    type={showPassword ? 'text' : 'password'}
                                    className="auth-input"
                                    placeholder="••••••••"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    autoComplete="new-password"
                                />
                            </div>
                        </div>
                    )}

                    {/* Error */}
                    {displayError && (
                        <div className="auth-error">
                            {displayError}
                        </div>
                    )}

                    {/* Submit */}
                    <button type="submit" className="auth-submit" disabled={isLoading}>
                        {isLoading ? (
                            <Loader2 size={18} className="auth-spinner" />
                        ) : (
                            <>
                                {mode === 'signin' && 'Sign In'}
                                {mode === 'signup' && 'Create Account'}
                                {mode === 'forgot_password' && 'Send Reset Code'}
                                <ArrowRight size={16} />
                            </>
                        )}
                    </button>
                </form>

                {/* Toggle */}
                {mode !== 'forgot_password' ? (
                    <div className="auth-toggle">
                        <span>
                            {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}
                        </span>
                        <button type="button" className="auth-toggle-btn" onClick={() => toggleMode(mode === 'signin' ? 'signup' : 'signin')}>
                            {mode === 'signin' ? 'Sign Up' : 'Sign In'}
                        </button>
                    </div>
                ) : (
                    <div className="auth-toggle">
                        <button type="button" className="auth-toggle-btn" onClick={() => toggleMode('signin')}>
                            Back to Sign In
                        </button>
                    </div>
                )}

                <Link className="auth-home-link" to="/">
                    Back to the public landing page
                </Link>
            </div>
        </div>
    );
}

export default AuthScreen;
