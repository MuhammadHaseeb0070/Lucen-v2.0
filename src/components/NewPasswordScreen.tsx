import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Eye, EyeOff, ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import Logo from './Logo';

const NewPasswordScreen: React.FC = () => {
    const navigate = useNavigate();
    const { updatePassword, error, isLoading, otpVerified, clearError, clearOtpVerified } = useAuthStore();
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [localError, setLocalError] = useState('');
    const [success, setSuccess] = useState(false);

    // Guard: if OTP wasn't verified, send back to verify screen
    useEffect(() => {
        if (!otpVerified) {
            navigate('/auth/verify-otp?type=recovery', { replace: true });
        }
    }, [otpVerified, navigate]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLocalError('');
        clearError();

        if (!password) {
            setLocalError('Password is required');
            return;
        }
        if (password.length < 8) {
            setLocalError('Password must be at least 8 characters');
            return;
        }
        if (password !== confirmPassword) {
            setLocalError('Passwords do not match');
            return;
        }

        const err = await updatePassword(password);
        if (!err) {
            setSuccess(true);
            clearOtpVerified();
            // Give user a moment to read the success message, then redirect
            setTimeout(() => navigate('/chat'), 2000);
        }
    };

    const displayError = localError || error;

    if (success) {
        return (
            <div className="auth-screen">
                <div className="auth-container" style={{ textAlign: 'center' }}>
                    <div className="auth-brand">
                        <div className="auth-logo" style={{ background: 'var(--success, #22c55e)', color: 'white' }}>
                            <ShieldCheck size={28} />
                        </div>
                        <h1 className="auth-title">Password Updated</h1>
                        <p className="auth-subtitle">
                            Your password has been changed and all other devices have been signed out. Redirecting you now…
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="auth-screen">
            <div className="auth-container">
                {/* Branding */}
                <div className="auth-brand">
                    <div className="auth-logo">
                        <Logo size={28} />
                    </div>
                    <h1 className="auth-title">Set New Password</h1>
                    <p className="auth-subtitle">
                        Choose a strong password. All other devices will be signed out.
                    </p>
                </div>

                {/* Form */}
                <form className="auth-form" onSubmit={handleSubmit}>
                    {/* New Password */}
                    <div className="auth-field">
                        <label className="auth-label" htmlFor="new-password">New Password</label>
                        <div className="auth-input-wrapper">
                            <Lock size={16} className="auth-input-icon" />
                            <input
                                id="new-password"
                                type={showPassword ? 'text' : 'password'}
                                className="auth-input"
                                placeholder="Min. 8 characters"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoComplete="new-password"
                                autoFocus
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

                    {/* Confirm Password */}
                    <div className="auth-field">
                        <label className="auth-label" htmlFor="confirm-new-password">Confirm Password</label>
                        <div className="auth-input-wrapper">
                            <Lock size={16} className="auth-input-icon" />
                            <input
                                id="confirm-new-password"
                                type={showPassword ? 'text' : 'password'}
                                className="auth-input"
                                placeholder="••••••••"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                autoComplete="new-password"
                            />
                        </div>
                    </div>

                    {/* Password strength hint */}
                    {password.length > 0 && password.length < 8 && (
                        <p style={{ fontSize: '12px', color: 'var(--danger, #ef4444)', margin: '-4px 0 8px' }}>
                            Password is too short
                        </p>
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
                                Update Password
                                <ArrowRight size={16} />
                            </>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default NewPasswordScreen;
