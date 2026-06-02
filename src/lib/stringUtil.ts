/**
 * Helper utility to filter out MiniMax internal XML tags and leaked tool calls.
 * Uses 3 clean regex patterns instead of 15 individual ones.
 */
export function sanitizeMinimaxTags(text: string): string {
    if (!text || typeof text !== 'string') return text ?? '';
    return text
        // Strip complete paired XML tags with content (non-HTML tags)
        .replace(/<(minimax:[a-z_]+|invoke|tool_call|query|search_query|web_search|parameter)[^>]*>[\s\S]*?<\/\1>/gi, '')
        // Strip any remaining unpaired tags from the above set  
        .replace(/<\/?(minimax:[a-z_]+|invoke|tool_call|query|search_query|web_search|parameter)[^>]*>/gi, '')
        // Strip malformed openings (e.g. "query>text")
        .replace(/(?:search_query|web_search|query|invoke|tool_call)>[^\n]*/gi, '');
}
