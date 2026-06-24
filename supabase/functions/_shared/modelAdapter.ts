export type ReasoningMode = 'none' | 'tokens' | 'stream_think_tag';

export type ProviderFamily = 'openai' | 'anthropic' | 'google';

export interface ModelProfile {
  id: string;                             // full model string e.g. "moonshot/kimi-k2"
  family: ProviderFamily;
  reasoningMode: ReasoningMode;
  supportsNativeTools: boolean;           // false = use XML tool emulation fallback
  requiresMaxCompletionTokens: boolean;   // true for openai/o1, openai/o3 only
  stripSystemRole: boolean;               // true for minimax/minimax-m1 only
  reasoningEffort: 'low' | 'normal' | 'high';
}

export interface ParsedDelta {
  content: string;      // clean visible text only — no reasoning, no think tags
  reasoning: string;    // reasoning content — never forwarded to user
  toolCallDeltas: any[]; // raw tool_calls array from delta
  isGarbled: boolean;   // true if content is clearly garbage (e.g. !!!!! flood)
}

/**
 * Builds a ModelProfile object based on the requested environment key, evaluating overrides and auto-detecting capabilities.
 */
export function buildModelProfile(modelEnvKey: 'MAIN' | 'CODER' | 'VISION'): ModelProfile {
  let modelId = '';
  let reasoningModeOverride: string | undefined;
  let toolSupportOverride: string | undefined;
  let reasoningEffortOverride: string | undefined;

  if (modelEnvKey === 'MAIN') {
    modelId = Deno.env.get('MAIN_CHAT_MODEL') || '';
    reasoningModeOverride = Deno.env.get('MAIN_CHAT_REASONING_MODE');
    toolSupportOverride = Deno.env.get('MAIN_CHAT_SUPPORTS_TOOLS');
    reasoningEffortOverride = Deno.env.get('MAIN_CHAT_REASONING_EFFORT');
  } else if (modelEnvKey === 'CODER') {
    modelId = Deno.env.get('CODER_MODEL') || Deno.env.get('CODING_CHAT_MODEL') || '';
    reasoningModeOverride = Deno.env.get('CODER_REASONING_MODE');
    toolSupportOverride = Deno.env.get('CODER_SUPPORTS_TOOLS');
    reasoningEffortOverride = Deno.env.get('CODER_REASONING_EFFORT');
  } else {
    modelId = Deno.env.get('VISION_HELPER_MODEL') || '';
    reasoningModeOverride = Deno.env.get('VISION_REASONING_MODE');
    toolSupportOverride = Deno.env.get('VISION_SUPPORTS_TOOLS');
    reasoningEffortOverride = Deno.env.get('VISION_REASONING_EFFORT');
  }

  const idLower = modelId.toLowerCase();

  // Family auto-detection
  let family: ProviderFamily = 'openai';
  if (idLower.includes('anthropic/')) {
    family = 'anthropic';
  } else if (idLower.includes('google/')) {
    family = 'google';
  }

  // Reasoning mode auto-detection
  let reasoningMode: ReasoningMode = 'none';
  if (
    idLower.includes('/o1') ||
    idLower.includes('/o3') ||
    idLower.includes('openai/o1') ||
    idLower.includes('openai/o3')
  ) {
    reasoningMode = 'tokens';
  } else if (
    idLower.includes('kimi') &&
    (idLower.includes('k2') || idLower.includes('thinking'))
  ) {
    reasoningMode = 'tokens';
  } else if (
    idLower.includes('deepseek') &&
    (idLower.includes('r1') || idLower.includes('reasoner'))
  ) {
    reasoningMode = 'stream_think_tag';
  } else if (idLower.includes('qwq') || idLower.includes('qvq')) {
    reasoningMode = 'stream_think_tag';
  } else if (idLower.includes('minimax') && idLower.includes('thinking')) {
    reasoningMode = 'stream_think_tag';
  }

  // Apply overrides
  if (
    reasoningModeOverride === 'none' ||
    reasoningModeOverride === 'tokens' ||
    reasoningModeOverride === 'stream_think_tag'
  ) {
    reasoningMode = reasoningModeOverride;
  }

  // Native tools support: default true for MAIN, false for others
  let supportsNativeTools = modelEnvKey === 'MAIN';
  if (toolSupportOverride === 'true') {
    supportsNativeTools = true;
  } else if (toolSupportOverride === 'false') {
    supportsNativeTools = false;
  }

  // Reasoning effort
  let reasoningEffort: 'low' | 'normal' | 'high' = 'normal';
  if (
    reasoningEffortOverride === 'low' ||
    reasoningEffortOverride === 'normal' ||
    reasoningEffortOverride === 'high'
  ) {
    reasoningEffort = reasoningEffortOverride;
  }

  const requiresMaxCompletionTokens =
    idLower.includes('openai/o1') || idLower.includes('openai/o3');
  const stripSystemRole = idLower.includes('minimax/minimax-m1');

  return {
    id: modelId,
    family,
    reasoningMode,
    supportsNativeTools,
    requiresMaxCompletionTokens,
    stripSystemRole,
    reasoningEffort,
  };
}

/**
 * Builds the correct payload body for OpenRouter API requests based on model configurations and features.
 */
export function buildRequestBody(
  profile: ModelProfile,
  messages: any[],
  tools: any[],
  maxTokens: number,
  enableReasoning: boolean
): Record<string, unknown> {
  let processedMessages = [...messages];

  if (profile.stripSystemRole) {
    const newMessages: any[] = [];
    for (const msg of messages) {
      if (msg.role === 'system') {
        newMessages.push({
          role: 'user',
          content: `[System]\n${msg.content}\n[/System]`,
        });
        newMessages.push({
          role: 'assistant',
          content: 'Understood.',
        });
      } else {
        newMessages.push(msg);
      }
    }
    processedMessages = newMessages;
  }

  const body: Record<string, unknown> = {
    model: profile.id,
    messages: processedMessages,
    stream: true,
  };

  if (profile.requiresMaxCompletionTokens) {
    body.max_completion_tokens = maxTokens;
  } else {
    body.max_tokens = maxTokens;
    body.temperature = 0.7;
  }

  if (enableReasoning && profile.reasoningMode === 'tokens') {
    body.reasoning = {
      effort: profile.reasoningEffort,
    };
  }

  if (tools && tools.length > 0 && profile.supportsNativeTools === true) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  return body;
}

/**
 * Parses a single chunk delta from the SSE stream, cleanly separating reasoning/thinking output from standard response text.
 */
export function parseDelta(
  delta: any,
  profile: ModelProfile,
  thinkTagBuffer: { open: boolean; buf: string }
): ParsedDelta {
  let content = delta?.content ?? '';
  let reasoning = '';

  if (profile.reasoningMode === 'tokens') {
    reasoning = delta?.reasoning ?? delta?.reasoning_content ?? delta?.thinking ?? '';
    if (reasoning && !content) {
      content = '';
    }
  } else if (profile.reasoningMode === 'stream_think_tag') {
    if (!thinkTagBuffer.open) {
      if (content.includes('<think>')) {
        const parts = content.split('<think>');
        const textBefore = parts[0];
        const textAfter = parts.slice(1).join('<think>');

        content = textBefore;
        thinkTagBuffer.open = true;

        if (textAfter.includes('</think>')) {
          const subparts = textAfter.split('</think>');
          const reasoningContent = subparts[0];
          const textAfterClose = subparts.slice(1).join('</think>');

          reasoning = reasoningContent;
          thinkTagBuffer.open = false;
          thinkTagBuffer.buf = '';
          content += textAfterClose;
        } else {
          thinkTagBuffer.buf = textAfter;
        }
      }
    } else {
      if (content.includes('</think>')) {
        const parts = content.split('</think>');
        const textBefore = parts[0];
        const textAfter = parts.slice(1).join('</think>');

        thinkTagBuffer.buf += textBefore;
        reasoning = thinkTagBuffer.buf;
        thinkTagBuffer.open = false;
        thinkTagBuffer.buf = '';
        content = textAfter;
      } else {
        thinkTagBuffer.buf += content;
        content = '';
      }
    }
  }

  const toolCallDeltas = delta?.tool_calls ?? [];

  // Garbled content detection
  let isGarbled = false;
  if (content.length > 20) {
    const regex = /[^a-zA-Z0-9\u0600-\u06FF\u0750-\u077F\u4e00-\u9fff\u3040-\u30ff\s.,!?'"()\-:]/g;
    const matches = content.match(regex);
    const nonMatchingCount = matches ? matches.length : 0;
    const ratio = nonMatchingCount / content.length;
    if (ratio > 0.80) {
      isGarbled = true;
      console.warn(`[ModelAdapter] Garbled content detected (ratio: ${ratio.toFixed(2)}): ${content.slice(0, 100)}`);
      content = '';
    }
  }

  return {
    content,
    reasoning,
    toolCallDeltas,
    isGarbled,
  };
}

/**
 * Generates an XML tool usage guide injection segment to be appended to the system instructions.
 */
export function buildXmlToolManifest(tools: any[]): string {
  let manifest = `## Available tools
You can call these tools by responding with an XML block in this exact format:
<tool_call>
<name>TOOL_NAME</name>
<args>{"param": "value"}</args>
</tool_call>

Available tools:\n`;

  for (const t of tools) {
    const fn = t.function;
    const name = fn.name;
    const desc = fn.description;
    const paramsObj = fn.parameters?.properties || {};
    const requiredList = fn.parameters?.required || [];

    const reqStrList: string[] = [];
    const optStrList: string[] = [];

    for (const key of Object.keys(paramsObj)) {
      const pDesc = paramsObj[key].description || '';
      const pType = paramsObj[key].type || '';
      const detail = `${key} (${pType}): ${pDesc}`;
      if (requiredList.includes(key)) {
        reqStrList.push(detail);
      } else {
        optStrList.push(detail);
      }
    }

    manifest += `- ${name}: ${desc}\n`;
    if (reqStrList.length > 0) {
      manifest += `  Required params:\n    - ${reqStrList.join('\n    - ')}\n`;
    } else {
      manifest += `  Required params: None\n`;
    }
    if (optStrList.length > 0) {
      manifest += `  Optional params:\n    - ${optStrList.join('\n    - ')}\n`;
    } else {
      manifest += `  Optional params: None\n`;
    }
  }

  manifest += `\nRules:
- One tool call per XML block
- Wait for tool result before calling the next dependent tool
- Independent tools: call them in sequence
- If you do not need a tool, do not output a tool_call block`;

  return manifest;
}

/**
 * Extracts and parses the first XML tool block from raw string outputs.
 */
export function parseXmlToolCall(text: string): { name: string; args: Record<string, unknown> } | null {
  if (!text) return null;

  const toolCallRegex = /<tool_call>([\s\S]*?)<\/tool_call>/i;
  const match = text.match(toolCallRegex);
  if (!match) return null;

  const inside = match[1];

  const nameRegex = /<name>([\s\S]*?)<\/name>/i;
  const nameMatch = inside.match(nameRegex);
  if (!nameMatch) return null;
  const name = nameMatch[1].trim();

  const argsRegex = /<args>([\s\S]*?)<\/args>/i;
  const argsMatch = inside.match(argsRegex);
  if (!argsMatch) return null;
  const argsStr = argsMatch[1].trim();

  try {
    const args = JSON.parse(argsStr);
    if (args && typeof args === 'object') {
      return { name, args };
    }
  } catch {
    try {
      const unescaped = argsStr
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
      const args = JSON.parse(unescaped);
      if (args && typeof args === 'object') {
        return { name, args };
      }
    } catch {
      // fail parse
    }
  }

  return null;
}
