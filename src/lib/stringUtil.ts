/**
 * Helper utility to filter out MiniMax internal XML tags and leaked tool calls.
 * Uses 3 clean regex patterns instead of 15 individual ones.
 */
export function sanitizeMinimaxTags(text: string): string {
    if (!text || typeof text !== 'string') return text ?? '';
    const tags = 'minimax:[a-z_]+|invoke|tool_call|query|search_query|web_search|parameter|max_results|search_title|analysis_title|extraction_title|file_id|image_ids|image_id|argument|arguments|tool_args|tool_arguments|call|execute';
    const pairedRegex = new RegExp(`<(${tags})[^>]*>[\\s\\S]*?<\\/\\1>`, 'gi');
    const unpairedRegex = new RegExp(`<\\/?(${tags})[^>]*>`, 'gi');
    const malformedRegex = new RegExp(`(?:search_query|web_search|query|invoke|tool_call|parameter|max_results)>[^\\n]*`, 'gi');
    const partialRegex = new RegExp(`<(${tags})[^>]*$`, 'i');

    return text
        .replace(pairedRegex, '')
        .replace(unpairedRegex, '')
        .replace(malformedRegex, '')
        .replace(partialRegex, '');
}
