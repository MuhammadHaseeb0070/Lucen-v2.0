import React, { useMemo, useState } from 'react';
import {
    X, ExternalLink, Sparkles, Check, ChevronDown, Zap,
    HelpCircle, CreditCard, Shield, Star,
} from 'lucide-react';
import Logo from './Logo';
import {
    PLAN_LIST, planLabel, formatLC, LC, SUBSCRIPTION_FAQ,
    CREDIT_COSTS, type PlanDefinition,
} from '../config/subscriptionConfig';
import { useUIStore } from '../store/uiStore';
import { useCreditsStore } from '../store/creditsStore';
import { startCheckout, getPaymentProvider } from '../services/checkout';
import { paymentProviderName } from '../config/subscriptionConfig';

// ─── FAQ Accordion Item ───
const FaqItem: React.FC<{ question: string; answer: string }> = ({ question, answer }) => {
    const [open, setOpen] = useState(false);
    return (
        <div className={`lc-faq-item ${open ? 'lc-faq-item--open' : ''}`}>
            <button
                type="button"
                className="lc-faq-item__trigger"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
            >
                <span className="lc-faq-item__question">{question}</span>
                <ChevronDown size={16} className="lc-faq-item__chevron" />
            </button>
            {open && (
                <div className="lc-faq-item__answer">
                    <p>{answer}</p>
                </div>
            )}
        </div>
    );
};

// ─── Credit Progress Bar ───
const CreditBar: React.FC<{ current: number; max: number }> = ({ current, max }) => {
    const pct = Math.min(100, Math.max(0, (current / max) * 100));
    const barClass =
        pct > 50 ? 'lc-credit-bar__fill--green'
        : pct > 20 ? 'lc-credit-bar__fill--yellow'
        : 'lc-credit-bar__fill--red';

    return (
        <div className="lc-credit-bar">
            <div className="lc-credit-bar__labels">
                <span className="lc-credit-bar__current">
                    {formatLC(current)} <span className="lc-credit-bar__unit">{LC.unit}</span>
                </span>
                <span className="lc-credit-bar__max">of {formatLC(max)} {LC.unit}</span>
            </div>
            <div className="lc-credit-bar__track">
                <div
                    className={`lc-credit-bar__fill ${barClass}`}
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
};

// ─── Plan Card ───
const PlanCard: React.FC<{
    plan: PlanDefinition;
    isCurrent: boolean;
    isLoading: boolean;
    onCheckout: () => void;
    disabled: boolean;
}> = ({ plan, isCurrent, isLoading, onCheckout, disabled }) => {
    const isPaid = plan.id === 'regular' || plan.id === 'pro';
    const isFeatured = plan.recommended;

    return (
        <article
            className={`lc-plan ${isFeatured ? 'lc-plan--featured' : ''} ${isCurrent ? 'lc-plan--current' : ''} lc-plan--${plan.id}`}
        >
            {isFeatured && (
                <div className="lc-plan__ribbon">
                    <Star size={12} aria-hidden />
                    <span>Best Value</span>
                </div>
            )}

            {plan.highlight && (
                <div className="lc-plan__bonus-badge">
                    <Zap size={12} aria-hidden />
                    <span>{plan.highlight}</span>
                </div>
            )}

            <div className="lc-plan__header">
                <div className="lc-plan__name-row">
                    <Logo size={20} className="lc-plan__logo" />
                    <h3 className="lc-plan__name">{plan.name}</h3>
                    {isCurrent && <span className="lc-plan__current-badge">Current</span>}
                </div>

                <div className="lc-plan__price-block">
                    <span className="lc-plan__currency">$</span>
                    <span className="lc-plan__amount">{plan.priceUsd}</span>
                    {plan.priceUsd > 0 && <span className="lc-plan__period">/mo</span>}
                </div>

                <p className="lc-plan__tagline">{plan.tagline}</p>

                <div className="lc-plan__credit-badge">
                    <CreditCard size={14} aria-hidden />
                    <span>{plan.badge}</span>
                </div>
            </div>

            <ul className="lc-plan__features">
                {plan.features.map((feat) => (
                    <li key={feat}>
                        <Check size={14} className="lc-plan__check" strokeWidth={2.5} />
                        <span>{feat}</span>
                    </li>
                ))}
            </ul>

            <div className="lc-plan__footer">
                {isPaid ? (
                    <button
                        type="button"
                        className={`lc-plan__cta ${isFeatured ? 'lc-plan__cta--primary' : ''}`}
                        onClick={onCheckout}
                        disabled={disabled || isCurrent}
                    >
                        <ExternalLink size={14} />
                        {isCurrent
                            ? 'Your Current Plan'
                            : isLoading
                              ? 'Opening Checkout…'
                              : `Upgrade to ${plan.name}`}
                    </button>
                ) : (
                    <div className="lc-plan__free-label">
                        <Shield size={14} />
                        <span>Included free forever</span>
                    </div>
                )}
            </div>
        </article>
    );
};

// ─── Main PricingModal ───
const PricingModal: React.FC = () => {
    const { billingOpen, setBillingOpen } = useUIStore();
    const {
        remainingCredits,
        isLoading: creditsLoading,
        subscriptionPlan,
        subscriptionStatus,
        customerPortalUrl,
        renewsAt,
    } = useCreditsStore();
    const [loadingTier, setLoadingTier] = useState<'regular' | 'pro' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [faqOpen, setFaqOpen] = useState(false);

    const currentPlan = useMemo(() =>
        PLAN_LIST.find((p) => p.id === subscriptionPlan) ?? PLAN_LIST[0],
    [subscriptionPlan]);

    const statusLine = useMemo(() => {
        if (subscriptionStatus === 'past_due') {
            return `Your payment needs attention. Please update your billing info in ${paymentProviderName()}.`;
        }
        if (subscriptionStatus === 'active') {
            const renewText = renewsAt ? ` Renews on ${new Date(renewsAt).toLocaleDateString()}.` : '';
            return `You are on the ${planLabel(subscriptionPlan)} plan.${renewText}`;
        }
        return `You are on the Free tier. Upgrade to unlock more ${LC.unit} and unlimited features.`;
    }, [subscriptionStatus, subscriptionPlan, renewsAt]);

    if (!billingOpen) return null;

    const onCheckout = async (tier: 'regular' | 'pro') => {
        setError(null);
        const plan = PLAN_LIST.find((p) => p.id === tier);
        const provider = getPaymentProvider();

        // Validate that the required env var is set for the active provider
        if (provider === 'gumroad') {
            if (!plan?.gumroadProductUrl) {
                setError('Missing environment variable: VITE_GUMROAD_PRODUCT_URL');
                return;
            }
        } else {
            if (!plan?.variantId) {
                setError(`Missing environment variable: VITE_LS_VARIANT_${tier.toUpperCase()}`);
                return;
            }
        }

        setLoadingTier(tier);
        try {
            const redirectUrl = `${window.location.origin}/chat?subscription_updated=1`;
            await startCheckout(
                {
                    variantId: plan?.variantId,
                    gumroadProductUrl: plan?.gumroadProductUrl,
                    gumroadTierName: plan?.gumroadTierName,
                },
                redirectUrl,
            );
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Checkout failed');
            setLoadingTier(null);
        }
    };

    return (
        <div className="lc-modal-overlay" onClick={() => setBillingOpen(false)}>
            <div
                className="lc-modal"
                role="dialog"
                aria-labelledby="lc-modal-title"
                onClick={(e) => e.stopPropagation()}
            >
                {/* ── Close Button ── */}
                <button
                    type="button"
                    className="lc-modal__close"
                    onClick={() => setBillingOpen(false)}
                    aria-label="Close"
                >
                    <X size={20} />
                </button>

                {/* ── Scrollable Content ── */}
                <div className="lc-modal__scroll">
                    {/* ── Header ── */}
                    <header className="lc-modal__header">
                        <div className="lc-modal__brand">
                            <Logo size={32} className="lc-modal__brand-logo" />
                            <div>
                                <h2 id="lc-modal-title" className="lc-modal__title">
                                    Subscription & {LC.unit}
                                </h2>
                                <p className="lc-modal__subtitle">{statusLine}</p>
                            </div>
                        </div>
                    </header>

                    {/* ── LC Explainer ── */}
                    <div className="lc-explainer">
                        <div className="lc-explainer__icon">
                            <Sparkles size={18} />
                        </div>
                        <div className="lc-explainer__text">
                            <strong>What is {LC.unit}?</strong>
                            <p>{LC.description}</p>
                        </div>
                    </div>

                    {/* ── Current Balance ── */}
                    <div className="lc-balance-card">
                        <div className="lc-balance-card__row lc-balance-card__row--space">
                            <div className="lc-balance-card__plan">
                                <span className={`lc-balance-card__plan-badge lc-balance-card__plan-badge--${subscriptionPlan}`}>
                                    {planLabel(subscriptionPlan)}
                                </span>
                                {subscriptionStatus === 'past_due' && (
                                    <span className="lc-balance-card__warning">Payment Past Due</span>
                                )}
                            </div>
                            
                            {(customerPortalUrl && getPaymentProvider() === 'lemonsqueezy') ? (
                                <a
                                    href={customerPortalUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="lc-manage-link"
                                >
                                    Manage Subscription <ExternalLink size={14} />
                                </a>
                            ) : (getPaymentProvider() === 'gumroad' && subscriptionPlan !== 'free') ? (
                                <a
                                    href="https://app.gumroad.com/library"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="lc-manage-link"
                                    title="Go to your Gumroad Library to manage billing or cancel"
                                >
                                    Manage on Gumroad <ExternalLink size={14} />
                                </a>
                            ) : null}
                        </div>
                        <CreditBar
                            current={creditsLoading ? 0 : remainingCredits}
                            max={currentPlan.creditsProvided}
                        />
                    </div>

                    {/* ── Error Banner ── */}
                    {error && (
                        <div className="lc-error" role="alert">
                            <span>⚠️ {error}</span>
                            <button onClick={() => setError(null)} aria-label="Dismiss">
                                <X size={14} />
                            </button>
                        </div>
                    )}

                    {/* ── Plan Cards ── */}
                    <div className="lc-plans-grid">
                        {PLAN_LIST.map((plan) => (
                            <PlanCard
                                key={plan.id}
                                plan={plan}
                                isCurrent={plan.id === subscriptionPlan}
                                isLoading={loadingTier === plan.id}
                                onCheckout={() => onCheckout(plan.id as 'regular' | 'pro')}
                                disabled={!!loadingTier}
                            />
                        ))}
                    </div>

                    {/* ── Credit Cost Reference ── */}
                    <div className="lc-cost-ref">
                        <h4 className="lc-cost-ref__title">How {LC.unit} are used</h4>
                        <div className="lc-cost-ref__grid">
                            <div className="lc-cost-ref__item">
                                <span className="lc-cost-ref__value">{CREDIT_COSTS.PER_1K_TOKENS}</span>
                                <span className="lc-cost-ref__label">{LC.unit} per 1K tokens</span>
                                <span className="lc-cost-ref__desc">Chat input, output, reasoning</span>
                            </div>
                            <div className="lc-cost-ref__item">
                                <span className="lc-cost-ref__value">{CREDIT_COSTS.PER_IMAGE}</span>
                                <span className="lc-cost-ref__label">{LC.unit} per image</span>
                                <span className="lc-cost-ref__desc">Image analysis & vision</span>
                            </div>
                            <div className="lc-cost-ref__item">
                                <span className="lc-cost-ref__value">{CREDIT_COSTS.PER_WEB_SEARCH}</span>
                                <span className="lc-cost-ref__label">{LC.unit} per web search</span>
                                <span className="lc-cost-ref__desc">Real-time internet access</span>
                            </div>
                        </div>
                    </div>

                    {/* ── FAQ Section ── */}
                    <div className="lc-faq">
                        <button
                            type="button"
                            className="lc-faq__toggle"
                            onClick={() => setFaqOpen(!faqOpen)}
                        >
                            <HelpCircle size={18} />
                            <span>Frequently Asked Questions</span>
                            <ChevronDown
                                size={16}
                                className={`lc-faq__toggle-chevron ${faqOpen ? 'lc-faq__toggle-chevron--open' : ''}`}
                            />
                        </button>
                        {faqOpen && (
                            <div className="lc-faq__list">
                                {SUBSCRIPTION_FAQ.map((item) => (
                                    <FaqItem key={item.question} question={item.question} answer={item.answer} />
                                ))}
                            </div>
                        )}
                    </div>

                    {/* ── Footer Note ── */}
                    <p className="lc-modal__footer-note">
                        All payments are processed securely by {paymentProviderName()}. You can manage your
                        billing, update payment methods, or cancel anytime.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default PricingModal;
