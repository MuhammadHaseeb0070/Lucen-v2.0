import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, ArrowRight, Loader2, RotateCcw, ArrowLeft } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import Logo from './Logo';

const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 60; // seconds

function OtpVerifyScreen() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const email = searchParams.get('email') || '';
    const type = (searchParams.get('type') || 'signup') as 'signup' | 'recovery';

    const { verifyOtp, resetPasswordForEmail, error, isLoading, clearError } = useAuthStore();

    const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
    const [localError, setLocalError] = useState('');
    const [resendCooldown, setResendCooldown] = useState(0);
    const [resendMessage, setResendMessage] = useState('');
    const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

    // Auto-focus first input on mount
    useEffect(() => {
        inputRefs.current[0]?.focus();
    }, []);

    // Resend cooldown timer
    useEffect(() => {
        if (resendCooldown <= 0) return;
        const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
        return () => clearTimeout(timer);
    }, [resendCooldown]);

    const handleDigitInput = (index: number, value: string) => {
        // Allow paste of full code
        if (value.length > 1) {
            const cleaned = value.replace(/\D/g, '').slice(0, OTP_LENGTH);
            const newDigits = Array(OTP_LENGTH).fill('');
            cleaned.split('').forEach((ch, i) => { newDigits[i] = ch; });
            setDigits(newDigits);
            const focusIdx = Math.min(cleaned.length, OTP_LENGTH - 1);
            inputRefs.current[focusIdx]?.focus();
            return;
        }

        const digit = value.replace(/\D/g, '');
        const newDigits = [...digits];
        newDigits[index] = digit;
        setDigits(newDigits);
        setLocalError('');
        clearError();

        // Auto-advance
        if (digit && index < OTP_LENGTH - 1) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace' && !digits[index] && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
        if (e.key === 'ArrowLeft' && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
        if (e.key === 'ArrowRight' && index < OTP_LENGTH - 1) {
            inputRefs.current[index + 1]?.focus();
        }
        // Submit on Enter if code is full
        if (e.key === 'Enter') {
            handleVerify();
        }
    };

    const handleVerify = async () => {
        const token = digits.join('');
        if (token.length < OTP_LENGTH) {
            setLocalError('Please enter the complete 6-digit code.');
            return;
        }
        setLocalError('');
        clearError();

        const err = await verifyOtp(email, token, type);
        if (!err) {
            if (type === 'recovery') {
                navigate('/auth/reset-password');
            } else {
                navigate('/chat');
            }
        }
    };

    const handleResend = async () => {
        if (resendCooldown > 0) return;
        setLocalError('');
        setResendMessage('');
        clearError();

        let err: string | null = null;
        if (type === 'signup') {
            // We can't call signUp again without a password — instruct user to go back
            setResendMessage("To resend, go back and click 'Create Account' again.");
            return;
        } else {
            err = await resetPasswordForEmail(email);
        }

        if (!err) {
            setResendMessage('A new code has been sent to your email.');
            setResendCooldown(RESEND_COOLDOWN);
            setDigits(Array(OTP_LENGTH).fill(''));
            inputRefs.current[0]?.focus();
        }
    };

    const displayError = localError || error;
    const isSignup = type === 'signup';

    return (
        <div className="auth-screen">
            <div className="auth-container">
                {/* Branding */}
                <div className="auth-brand">
                    <div className="auth-logo">
                        <Logo size={28} />
                    </div>
                    <h1 className="auth-title">Check your email</h1>
                    <p className="auth-subtitle">
                        {isSignup
                            ? 'Enter the 6-digit code we sent to verify your account.'
                            : 'Enter the 6-digit code we sent to reset your password.'}
                    </p>
                </div>

                {/* Email display */}
                <div className="otp-email-badge">
                    <Mail size={14} />
                    <span>{email || 'your email'}</span>
                </div>

                {/* OTP input boxes */}
                <div className="otp-input-row">
                    {digits.map((digit, i) => (
                        <input
                            key={i}
                            ref={(el) => { inputRefs.current[i] = el; }}
                            id={`otp-digit-${i}`}
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxLength={6} /* allow paste */
                            className={`otp-digit-input ${digit ? 'otp-digit-input--filled' : ''}`}
                            value={digit}
                            onChange={(e) => handleDigitInput(i, e.target.value)}
                            onKeyDown={(e) => handleKeyDown(i, e)}
                            autoComplete="one-time-code"
                        />
                    ))}
                </div>

                {/* Error */}
                {displayError && (
                    <div className="auth-error" style={{ marginBottom: '12px' }}>
                        {displayError}
                    </div>
                )}

                {/* Resend message */}
                {resendMessage && !displayError && (
                    <div className="auth-success" style={{ marginBottom: '12px' }}>
                        {resendMessage}
                    </div>
                )}

                {/* Verify button */}
                <button
                    className="auth-submit"
                    onClick={handleVerify}
                    disabled={isLoading || digits.join('').length < OTP_LENGTH}
                >
                    {isLoading ? (
                        <Loader2 size={18} className="auth-spinner" />
                    ) : (
                        <>
                            Verify Code
                            <ArrowRight size={16} />
                        </>
                    )}
                </button>

                {/* Resend */}
                <div className="otp-resend-row">
                    <span className="otp-resend-label">Didn't receive a code?</span>
                    <button
                        type="button"
                        className="auth-toggle-btn"
                        onClick={handleResend}
                        disabled={resendCooldown > 0 || isLoading}
                    >
                        {resendCooldown > 0 ? (
                            <>
                                <RotateCcw size={12} />
                                Resend in {resendCooldown}s
                            </>
                        ) : (
                            <>
                                <RotateCcw size={12} />
                                Resend code
                            </>
                        )}
                    </button>
                </div>

                {/* Back link */}
                <button
                    type="button"
                    className="auth-toggle-btn"
                    style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}
                    onClick={() => navigate('/chat')}
                >
                    <ArrowLeft size={14} />
                    Back to sign in
                </button>
            </div>
        </div>
    );
}

export default OtpVerifyScreen;
