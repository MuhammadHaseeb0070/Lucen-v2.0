import { getSingletonHighlighter, bundledLanguages } from 'shiki/bundle/web';

let highlighterPromise = getSingletonHighlighter({
    themes: ['one-dark-pro'],
    langs: ['html', 'css', 'javascript', 'typescript', 'json', 'markdown', 'python', 'bash']
});

self.onmessage = async (e: MessageEvent) => {
    const { id, code, language } = e.data;
    try {
        const highlighter = await highlighterPromise;
        const loadedLangs = highlighter.getLoadedLanguages();
        
        let targetLang = language || 'text';
        // Normalize language names to match shiki if necessary
        if (targetLang === 'xml') targetLang = 'html';
        
        if (targetLang !== 'text' && !loadedLangs.includes(targetLang)) {
            if (bundledLanguages[targetLang as keyof typeof bundledLanguages]) {
                await highlighter.loadLanguage(targetLang as keyof typeof bundledLanguages);
            } else {
                targetLang = 'text'; // Fallback
            }
        }
        
        const html = highlighter.codeToHtml(code, {
            lang: targetLang,
            theme: 'one-dark-pro',
        });
        
        self.postMessage({ id, html, success: true });
    } catch (err: any) {
        self.postMessage({ id, error: err.message || 'Error highlighting', success: false, code });
    }
};
