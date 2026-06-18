/**
 * Helper utility to filter out MiniMax internal XML tags.
 * Strips any text matching these patterns:
 *  - <minimax:tool_call>...</minimax:tool_call> (full tag + content)
 *  - <minimax:tool_call ...any attributes...>
 *  - </minimax:tool_call>
 *  - Any opening or closing tag starting with <minimax: or </minimax:
 *  - The text content BETWEEN these tags if the tags are present
 */
export function sanitizeMinimaxTags(text: string): string {
    if (!text || typeof text !== 'string') return text ?? '';
    return text
        .replace(/<minimax:tool_call[\s\S]*?<\/minimax:tool_call>/g, '')
        .replace(/<\/?minimax:[^>]*>/g, '')
        .replace(/<(?:query|search_query|web_search)[^>]*>[\s\S]*?<\/(?:query|search_query|web_search)>/gi, '')
        .replace(/(?:search_query|web_search|query)>[^\n]*/gi, '')
        .replace(/<\/?(?:query|search_query|web_search)[^>]*>/gi, '')
        .replace(/<tool_call[\s\S]*?<\/tool_call>/gi, '')
        .replace(/<\/?tool_call[^>]*>/gi, '')
        .replace(/<invoke[\s\S]*?<\/invoke>/gi, '')
        .replace(/<parameter[\s\S]*?<\/parameter>/gi, '')
        .replace(/<\/?invoke[^>]*>/gi, '')
        .replace(/<\/?parameter[^>]*>/gi, '');
}
