import React, { useMemo, useState } from 'react';
import { X, ExternalLink, Sparkles, Check } from 'lucide-react';
import Logo from './Logo';
import { PACKAGES, planLabel } from '../config/pricing';
import { useUIStore } from '../store/uiStore';
import { useCreditsStore } from '../store/creditsStore';
import { startLemonCheckout } from '../services/checkout';

const PricingModal: React.FC = () => {
    const { billingOpen, setBillingOpen } = useUIStore();
    const {
        remainingCredits,
        isLoading: creditsLoading,
        subscriptionPlan,
        subscriptionStatus,
    } = useCreditsStore();
    const [loadingTier, setLoadingTier] = useState<'regular' | 'pro' | null>(null);
    const [error, setError] = useState<string | null>(null);

    const tiers = useMemo(
        () => [PACKAGES.FREE, PACKAGES.REGULAR, PACKAGES.PRO],
        [],
    );

    const statusLine = useMemo(() => {
        if (subscriptionStatus === 'past_due') {
            return 'Your payment needs attention. Update billing in Lemon Squeezy to keep your plan.';
        }
        if (subscriptionStatus === 'active' || subscriptionPlan === 'regular' || subscriptionPlan === 'pro') {
            return `You are on ${planLabel(subscriptionPlan)}. Credits shown below sync with your account.`;
        }
        return 'You are on the free tier. Upgrade when you need more capacity.';
    }, [subscriptionStatus, subscriptionPlan]);

    if (!billingOpen) return null;

    const onCheckout = async (tier: 'regular' | 'pro') => {
        setError(null);
        const variantId = tier === 'regular' ? PACKAGES.REGULAR.variantId : PACKAGES.PRO.variantId;
        if (!variantId) {
            setError(`Set VITE_LS_VARIANT_${tier.toUpperCase()} in hosting env for this tier.`);
            return;
        }
        setLoadingTier(tier);
        try {
            await startLemonCheckout(variantId);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Checkout failed');
            setLoadingTier(null);
        }
    };

    return (
        <div className="modal-overlay billing-modal-overlay" onClick={() => setBillingOpen(false)}>
            <div
                className="billing-modal"
                role="dialog"
                aria-labelledby="billing-modal-title"
                onClick={(e) => e.stopPropagation()}
            >
                <header className="billing-modal__header">
                    <div className="billing-modal__brand">
                        <span className="billing-modal__logo-wrap">
                            <Logo size={28} className="billing-modal__logo" />
                        </span>
                        <div>
                            <h2 id="billing-modal-title" className="billing-modal__title">
                                Lucen plans
                            </h2>
                            <p className="billing-modal__subtitle">
                                One credit covers 1,000 blended tokens. Pick the tier that matches how you work.
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        className="billing-modal__close"
                        onClick={() => setBillingOpen(false)}
                        aria-label="Close"
                    >
                        <X size={20} />
                    </button>
                </header>

                <div className="billing-modal__current">
                    <div className="billing-modal__current-pill">
                        <span className="billing-modal__current-label">Current plan</span>
                        <span className="billing-modal__current-tier">{planLabel(subscriptionPlan)}</span>
                    </div>
                    <div className="billing-modal__balance-row">
                        <span className="billing-modal__balance-label">Balance</span>
                        <span className="billing-modal__balance-value">
                            {creditsLoading ? '…' : `${remainingCredits.toLocaleString(undefined, { maximumFractionDigits: 0 })} credits`}
                        </span>
                    </div>
                    <p className="billing-modal__status-copy">{statusLine}</p>
                </div>

                {error && (
                    <div className="billing-modal__error" role="alert">
                        {error}
                    </div>
                )}

                <div className="billing-modal__grid">
                    {tiers.map((p) => {
                        const isPaid = p.id === 'regular' || p.id === 'pro';
                        const tierKey = p.id as 'free' | 'regular' | 'pro';
                        const isLoading = loadingTier === tierKey;
                        const isFeatured = p.id === 'pro';
                        const isCurrent =
                            (p.id === 'free' && subscriptionPlan === 'free') ||
                            (p.id === 'regular' && subscriptionPlan === 'regular') ||
                            (p.id === 'pro' && subscriptionPlan === 'pro');

                        return (
                            <article
                                key={p.id}
                                className={`billing-tier ${isFeatured ? 'billing-tier--featured' : ''} ${isCurrent ? 'billing-tier--current' : ''}`}
                            >
                                {isFeatured && (
                                    <div className="billing-tier__ribbon">
                                        <Sparkles size={14} aria-hidden />
                                        Best value
                                    </div>
                                )}
                                <div className="billing-tier__head">
                                    <Logo size={22} className="billing-tier__mark" />
                                    <h3 className="billing-tier__name">{p.name}</h3>
                                    <div className="billing-tier__price">
                                        <span className="billing-tier__currency">$</span>
                                        <span className="billing-tier__amount">{p.priceUsd.toFixed(2)}</span>
                                        {p.priceUsd > 0 && (
                                            <span className="billing-tier__period">/mo</span>
                                        )}
                                    </div>
                                    <p className="billing-tier__tagline">{p.tagline}</p>
                                </div>

                                <ul className="billing-tier__features">
                                    {p.features.map((line) => (
                                        <li key={line}>
                                            <Check size={16} className="billing-tier__check" strokeWidth={2.5} />
                                            <span>{line}</span>
                                        </li>
                                    ))}
                                </ul>

                                {p.proExtra && (
                                    <p className="billing-tier__extra">{p.proExtra}</p>
                                )}

                                <div className="billing-tier__footer">
                                    {isPaid ? (
                                        <button
                                            type="button"
                                            className={`billing-tier__cta ${isFeatured ? 'billing-tier__cta--primary' : ''}`}
                                            onClick={() => onCheckout(p.id as 'regular' | 'pro')}
                                            disabled={!!loadingTier || isCurrent}
                                        >
                                            <ExternalLink size={16} />
                                            {isCurrent
                                                ? 'Current plan'
                                                : isLoading
                                                  ? 'Opening checkout…'
                                                  : `Choose ${p.name}`}
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            className="billing-tier__cta billing-tier__cta--ghost"
                                            onClick={() => setBillingOpen(false)}
                                        >
                                            Continue on Free
                                        </button>
                                    )}
                                </div>
                            </article>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default PricingModal;
