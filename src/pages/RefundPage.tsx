import React from 'react';

const RefundPage: React.FC = () => {
    return (
        <section className="landing-section" style={{ textAlign: 'left', alignItems: 'flex-start' }}>
            <div style={{ maxWidth: '800px', margin: '0 auto', width: '100%' }}>
                <h1 style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>Refund Policy</h1>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '3rem' }}>Last updated: {new Date().toLocaleDateString()}</p>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', lineHeight: 1.7, fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                    <section>
                        <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>1. General Subscription Refunds</h2>
                        <p>
                            Due to the non-returnable nature of computing resources and third-party API costs incurred the moment our services are used, Lucen generally operates on a strict no-refund policy for applied subscriptions. You can cancel your subscription at any time to prevent future billing, and you will retain access to your plan's features and credits until the end of your current billing cycle.
                        </p>
                    </section>

                    <section>
                        <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>2. Exceptions and 14-Day Grace Period</h2>
                        <p>
                            We want you to be satisfied with our application. As an exception, if you request a refund within 14 days of your initial purchase, AND you have consumed fewer than 5% of your allocated credits for that billing period, we will issue a full refund upon request. 
                        </p>
                        <p style={{ marginTop: '0.5rem' }}>
                            Please note that this grace period applies exclusively to your first month of service and does not apply to subsequent recurring payments or annual plan renewals.
                        </p>
                    </section>

                    <section>
                        <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>3. Unused Credits</h2>
                        <p>
                            We do not offer partial refunds or cash equivalents for unused credits under any circumstances. Depending on your specific subscription plan, unused credits may either roll over or expire at the conclusion of the billing epoch. If you cancel your account, your existing credit balance is forfeited at the end of the billing cycle.
                        </p>
                    </section>
                    
                    <section>
                        <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>4. Accidental Upgrades / Errors</h2>
                        <p>
                            If you believe you have been billed in error, or if a severe platform unavailability prevented usage entirely, please contact us within 72 hours of the charge. We review these issues on a case-by-case basis and will grant a refund or account credit if the fault lies with our billing or deployment infrastructure.
                        </p>
                    </section>

                    <section>
                        <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>5. How to Request a Refund</h2>
                        <p>
                            To initiate a refund request that falls within our grace period, please send an email to <a href="mailto:support@lucen.space" style={{ color: 'var(--accent)', textDecoration: 'none' }}>support@lucen.space</a> with:
                        </p>
                        <ul style={{ marginLeft: '1.5rem', marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <li>The email address associated with your Lucen account</li>
                            <li>The receipt or order number provided by Lemon Squeezy (our payment processor)</li>
                            <li>A brief explanation of why you are requesting a refund</li>
                        </ul>
                    </section>
                </div>
            </div>
        </section>
    );
};

export default RefundPage;
