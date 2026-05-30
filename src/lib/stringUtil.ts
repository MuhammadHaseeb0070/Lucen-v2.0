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
    if (!text) return text;
    return text
        .replace(/<minimax:tool_call[\s\S]*?<\/minimax:tool_call>/g, '')
        .replace(/<\/?minimax:[^>]*>/g, '');
}
