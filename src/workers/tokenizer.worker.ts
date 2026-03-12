// ============================================
// Tokenizer Web Worker
// ============================================
// Runs Tiktoken in a background thread so the main UI never freezes 
// when the user types huge prompts or uploads large files.

import { getEncoding, Tiktoken } from 'js-tiktoken';

// We use 'cl100k_base' which is standard for GPT-4/Grok/Modern LLMs.
let encoder: Tiktoken | null = null;

try {
    encoder = getEncoding('cl100k_base');
} catch (error) {
    console.error('Failed to initialize tiktoken in worker:', error);
}

// ─── Worker State ───
// We'll keep a cache so we only tokenize differences if possible,
// but for simplicity and safety, we simply re-tokenize the string passed.
// Web Workers are fast enough for most plain texts.

self.onmessage = (e: MessageEvent) => {
    const { id, text, type } = e.data;

    if (!encoder) {
        self.postMessage({ id, tokens: 0, error: 'Encoder not ready' });
        return;
    }

    try {
        if (type === 'count') {
            // Encode and count the tokens
            const tokens = encoder.encode(text).length;
            self.postMessage({ id, tokens });
        }
    } catch (error: any) {
        console.error('Tokenizer Worker Error:', error);
        self.postMessage({ id, tokens: 0, error: error.message });
    }
};
