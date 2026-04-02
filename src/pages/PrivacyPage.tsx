import React from 'react';

const PrivacyPage: React.FC = () => {
    return (
        <section className="landing-section" style={{ textAlign: 'left', alignItems: 'flex-start' }}>
            <div style={{ maxWidth: '800px', margin: '0 auto', width: '100%' }}>
                <h1 style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>Privacy Policy</h1>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '3rem' }}>Last updated: {new Date().toLocaleDateString()}</p>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', lineHeight: 1.7, fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                    <section>
                        <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>1. Information We Collect</h2>
                        <p>
                            We collect information you provide directly to us when you create an account, purchase a subscription, or communicate with us.
                            This may include your email address, billing information (processed securely through our payment provider), and authentication markers.
                        </p>
                    </section>

                    <section>
                        <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>2. How We Use Your Data</h2>
                        <p>We use the information we collect to:</p>
                        <ul style={{ marginLeft: '1.5rem', marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <li>Provide, maintain, and improve the Lucen workspace.</li>
                            <li>Process transactions and send related alerts, including confirmations and receipts.</li>
                            <li>Send you technical notices, updates, and support messages.</li>
                            <li>Monitor and analyze trends, usage, and activities to improve the user experience.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>3. Data Handling with AI Models</h2>
                        <p>
                            As an AI interface, the queries, prompts, and context you provide in the chat are transmitted to third-party language model providers (e.g., Anthropic, OpenAI) via secured APIs to generate responses. We strongly advise against sending highly sensitive Personal Identifiable Information (PII) into the chat. We do not use your chat histories to train our own base models.
                        </p>
                    </section>

                    <section>
                        <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>4. Cookies and Local Storage</h2>
                        <p>
                            We use local browser storage and minimal cookies to persist your session authentication, selected visual themes, and workspace state. You can control or reset your browser's local storage properties via your browser settings.
                        </p>
                    </section>

                    <section>
                        <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>5. Third-Party Sharing</h2>
                        <p>
                            We do not sell, trade, or otherwise transfer to outside parties your Personally Identifiable Information unless we provide users with advance notice. This does not include web hosting partners, AI API providers, and payment processors who assist us in operating our website and conducting our business, so long as those parties agree to keep this information confidential.
                        </p>
                    </section>

                    <section>
                        <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>6. Contact Us</h2>
                        <p>
                            If you have questions or concerns regarding this Privacy Policy or our data practices, please contact us at support@lucen.space.
                        </p>
                    </section>
                </div>
            </div>
        </section>
    );
};

export default PrivacyPage;
