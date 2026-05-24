export interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: 'object';
            properties: Record<string, any>;
            required?: string[];
        };
    };
    parallelizable: boolean;
    userFacingLabel: string;
}

export const TOOLS: Record<string, ToolDefinition> = {
    analyze_image: {
        type: 'function',
        function: {
            name: 'analyze_image',
            description: 'Analyzes one or more image files from storage by their attachment UUIDs, answering a specific question.',
            parameters: {
                type: 'object',
                properties: {
                    image_ids: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'The attachment UUIDs of the image(s) to analyze (from the [Attached Image: uuid] markers).'
                    },
                    question: {
                        type: 'string',
                        description: 'The specific question to answer about the image(s).'
                    },
                    analysis_title: {
                        type: 'string',
                        description: 'A 3-5 word label shown to the user as progress (e.g. "Analyzing sales chart").'
                    }
                },
                required: ['image_ids']
            }
        },
        parallelizable: true,
        userFacingLabel: 'Analyzing image'
    },
    web_search: {
        type: 'function',
        function: {
            name: 'web_search',
            description: 'Performs a live web search using Tavily to retrieve current information and links.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'The search query string.'
                    },
                    search_title: {
                        type: 'string',
                        description: 'A 3-5 word label shown to the user as progress (e.g. "Searching for weather").'
                    },
                    max_results: {
                        type: 'integer',
                        description: 'Optional maximum number of search results to return (cap of 5).'
                    }
                },
                required: ['query']
            }
        },
        parallelizable: false,
        userFacingLabel: 'Searching the web'
    },
    process_file: {
        type: 'function',
        function: {
            name: 'process_file',
            description: 'Reads and extracts text content from an attached document file by its UUID.',
            parameters: {
                type: 'object',
                properties: {
                    file_id: {
                        type: 'string',
                        description: 'The attachment UUID of the document to extract text from (from the [Attached File: uuid] marker).'
                    },
                    extraction_title: {
                        type: 'string',
                        description: 'A 3-5 word label shown to the user as progress (e.g. "Reading data sheet").'
                    },
                    max_chars: {
                        type: 'integer',
                        description: 'Optional maximum number of characters to extract.'
                    }
                },
                required: ['file_id']
            }
        },
        parallelizable: true,
        userFacingLabel: 'Extracting file content'
    }
};

export function getOpenRouterTools(): Array<{
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: 'object';
            properties: Record<string, any>;
            required?: string[];
        };
    };
}> {
    return Object.values(TOOLS).map(t => ({
        type: t.type,
        function: t.function
    }));
}
