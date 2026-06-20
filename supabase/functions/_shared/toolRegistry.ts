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
            description: 'Analyze and identify the content of uploaded images. Always pass ALL image IDs from the current message. Images are described individually and labeled Image 1, Image 2, etc. Call this once with all image IDs rather than multiple times with one ID each.',
            parameters: {
                type: 'object',
                properties: {
                    image_ids: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Array of ALL attachment UUIDs for images to analyze in this request. IMPORTANT: You must pass ALL image IDs that appear in [Attached Image: id] markers in the current message — do not skip any. Each image will be analyzed and described separately. If the user uploaded 3 images, pass all 3 IDs in this array.'
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
        parallelizable: true,
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
    },
    generate_artifact: {
        type: 'function',
        function: {
            name: 'generate_artifact',
            description: 'Generate a complex, complete artifact (HTML app, dashboard, game, widget, interactive UI, etc.) from a detailed prompt. Use ONLY when the user requests building something that requires more than 50 lines of code. CRITICAL: You can only generate ONE artifact per response. If the user asks for multiple separate artifacts, you MUST either combine them into a single comprehensive UI (e.g., side-by-side) or politely explain the 1-artifact limit and ask which one they want built first. The master_prompt must be exhaustively detailed — it is the ONLY input the coding engine receives. Include: full layout description, every UI section, every feature, all colors, typography, spacing, interactions, animations, responsive behavior, data structures, JS logic, edge cases, empty states, error handling. A generic prompt produces generic output — be specific.',
            parameters: {
                type: 'object',
                properties: {
                    master_prompt: {
                        type: 'string',
                        description: 'A massive, exhaustively detailed prompt describing EVERYTHING to build. Must include: full layout, every UI section, every feature, all colors, typography, spacing, interactions, animations, responsive behavior, data structures, JS logic, edge cases, empty states, error handling. Written so thoroughly that a coding model with zero other context can build the complete artifact perfectly in a single response.'
                    },
                    title: {
                        type: 'string',
                        description: 'Short title for the artifact (e.g. "Expense Tracker", "Weather Dashboard")'
                    },
                    artifact_type: {
                        type: 'string',
                        enum: ['html', 'svg', 'mermaid', 'file', 'excel', 'word', 'pdf'],
                        description: 'The type of artifact to generate. Most interactive apps/dashboards/games should be html.'
                    },
                    generation_title: {
                        type: 'string',
                        description: 'A 3-5 word label shown to the user as progress (e.g. "Building expense tracker", "Creating weather dashboard").'
                    }
                },
                required: ['master_prompt', 'title', 'artifact_type']
            }
        },
        parallelizable: false,
        userFacingLabel: 'Creating artifact'
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
