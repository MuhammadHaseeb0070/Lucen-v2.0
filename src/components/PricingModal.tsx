import React, { useMemo, useState } from 'react';
import { X, ExternalLink, Sparkles } from 'lucide-react';
import { PACKAGES } from '../config/pricing';
import { useUIStore } from '../store/uiStore';
import { startLemonCheckout } from '../services/checkout';

const PricingModal: React.FC = () => {
    const { billingOpen, setBillingOpen } = useUIStore();
    const [loadingTier, setLoadingTier] = useState<'regular' | 'pro' | null>(null);
    const [error, setError] = useState<string | null>(null);

    const tiers = useMemo(() => ([
        PACKAGES.FREE,
        PACKAGES.REGULAR,
        PACKAGES.PRO,
    ]), []);

    if (!billingOpen) return null;

    const onCheckout = async (tier: 'regular' | 'pro') => {
        setError(null);
        const variantId = tier === 'regular' ? PACKAGES.REGULAR.variantId : PACKAGES.PRO.variantId;
        if (!variantId) {
            setError(`Missing ${tier.toUpperCase()} variant id. Set VITE_LS_VARIANT_${tier.toUpperCase()} in your environment.`);
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
        <div className="modal-overlay" onClick={() => setBillingOpen(false)}>
            <div className="settings-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 920 }}>
                <div className="settings-content__header">
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Sparkles size={18} />
                        Lucen Credits
                    </h3>
                    <button className="settings-close" onClick={() => setBillingOpen(false)}>
                        <X size={18} />
                    </button>
                </div>

                <div className="settings-tab-body">
                    <p className="settings-desc" style={{ marginBottom: 14 }}>
                        1 Credit = 1,000 blended tokens. Upgrade anytime.
                    </p>

                    {error && (
                        <p className="security-error" style={{ marginTop: 0, marginBottom: 12 }}>
                            {error}
                        </p>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
                        {tiers.map((p) => {
                            const isPaid = p.id === 'regular' || p.id === 'pro';
                            const tierKey = p.id as 'free' | 'regular' | 'pro';
                            const isLoading = loadingTier === tierKey;
                            return (
                                <div
                                    key={p.id}
                                    style={{
                                        border: '1px solid var(--divider)',
                                        borderRadius: 'var(--r-lg)',
                                        background: 'var(--bg-surface)',
                                        padding: 14,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 10,
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                        <div style={{ fontWeight: 700 }}>{p.name}</div>
                                        <div style={{ fontWeight: 700 }}>
                                            ${p.priceUsd.toFixed(2)}
                                            <span style={{ opacity: 0.65, fontWeight: 600, marginLeft: 6 }}>
                                                {p.priceUsd > 0 ? '/mo' : ''}
                                            </span>
                                        </div>
                                    </div>

                                    <div style={{ opacity: 0.85 }}>
                                        <div style={{ fontWeight: 700 }}>
                                            {p.creditsProvided.toLocaleString()} Credits
                                        </div>
                                        <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
                                            {p.description}
                                        </div>
                                    </div>

                                    <div style={{ marginTop: 'auto' }}>
                                        {isPaid ? (
                                            <button
                                                className="auth-submit"
                                                onClick={() => onCheckout(p.id as 'regular' | 'pro')}
                                                disabled={!!loadingTier}
                                                style={{ width: '100%', display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}
                                            >
                                                <ExternalLink size={16} />
                                                {isLoading ? 'Redirecting…' : `Upgrade to ${p.name}`}
                                            </button>
                                        ) : (
                                            <button
                                                className="auth-submit"
                                                onClick={() => setBillingOpen(false)}
                                                style={{ width: '100%', opacity: 0.8 }}
                                            >
                                                Stay Free
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PricingModal;

