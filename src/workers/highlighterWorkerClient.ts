const worker = new Worker(new URL('./highlighter.worker.ts', import.meta.url), {
    type: 'module'
});

let messageId = 0;
const callbacks = new Map<number, { resolve: (val: string) => void, reject: (err: Error) => void }>();

worker.onmessage = (e: MessageEvent) => {
    const { id, html, success, error } = e.data;
    const cb = callbacks.get(id);
    if (cb) {
        if (success) {
            cb.resolve(html);
        } else {
            cb.reject(new Error(error));
        }
        callbacks.delete(id);
    }
};

export const highlightCode = (code: string, language: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        const id = ++messageId;
        callbacks.set(id, { resolve, reject });
        worker.postMessage({ id, code, language });
    });
};
