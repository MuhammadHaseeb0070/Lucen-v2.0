import type { Message } from '../../types';
import { TEMPLATES, BASE_SYSTEM_PROMPT } from '../../config/prompts';
import { useUIStore } from '../../store/uiStore';

// A silent, always-on notice that tells the main model to treat any first-person
// "I see …" blocks it sees on user messages as its own direct perception.
// This keeps the assistant from ever mentioning helpers/tools/descriptions.
export const ASSISTANT_VISION_NOTICE = `<assistant_vision_notice>
When the user attaches images in this conversation, each image will appear inside their message as "[Image: <name>]" followed by a first-person description starting with "I see:". Treat those descriptions as your own direct perception of the image — respond as if you personally looked at it. Never mention any description, tool, helper, model, process, or that you received information from elsewhere. Never say things like "based on the description", "from what I can see in the description", or "I was told". Just speak naturally about what you see, as if the image were right in front of you.
</assistant_vision_notice>`;

export function buildRuntimeContext(): string {
  const now = new Date();
  const localStr = now.toLocaleString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
  const iso = now.toISOString();
  return `<runtime_context>\nCurrent date/time: ${localStr} (UTC ${iso}).\nUse this as your authoritative "now" when the user asks about today, dates, days of the week, or recency — do not claim uncertainty about the current date.\n</runtime_context>`;
}

export function buildMessageContent(msg: Message): string {
  if (!msg.attachments || msg.attachments.length === 0) {
    return msg.content;
  }
  const markers = msg.attachments.map((a) => {
    return a.type === 'image' ? `[Attached Image: ${a.id}]` : `[Attached File: ${a.id}]`;
  }).join('\n');
  return `${markers}\n\n${msg.content}`;
}

export function approxTokens(text: string): number {
  return Math.ceil((text || '').length / 4);
}

export function messageCostApprox(m: Message): number {
  let total = approxTokens(m.content);
  if (m.attachments) {
    for (const a of m.attachments) {
      if (a.textContent) total += approxTokens(a.textContent);
      if (a.aiDescription) total += approxTokens(a.aiDescription);
    }
  }
  if (m.toolSteps) {
    for (const step of m.toolSteps) {
      if (step.output) {
        total += approxTokens(step.output.slice(0, 300));
      }
    }
  }
  // Per-message framing overhead (role tags, delimiters)
  total += 8;
  return total;
}

export interface PruneResult {
  pruned: Message[];
  droppedCount: number;
}

export function pruneMessagesForContext(
  messages: Message[],
  inputBudgetTokens: number,
): PruneResult {
  if (messages.length === 0) return { pruned: [], droppedCount: 0 };

  const pinnedIds = new Set(messages.filter((m) => m.isPinned).map((m) => m.id));
  const streamingIds = new Set(messages.filter((m) => m.isStreaming).map((m) => m.id));
  const alwaysKeptIds = new Set<string>([...pinnedIds, ...streamingIds]);

  let fixedCost = 0;
  for (const m of messages) {
    if (alwaysKeptIds.has(m.id)) fixedCost += messageCostApprox(m);
  }
  const nonPinnedBudget = Math.max(0, inputBudgetTokens - fixedCost);

  const keptNonPinned = new Set<string>();
  let running = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (alwaysKeptIds.has(m.id)) continue;
    const c = messageCostApprox(m);
    if (running + c > nonPinnedBudget) break;
    keptNonPinned.add(m.id);
    running += c;
  }

  if (keptNonPinned.size === 0) {
    for (let i = messages.length - 1, kept = 0; i >= 0 && kept < 2; i--) {
      const m = messages[i];
      if (alwaysKeptIds.has(m.id)) continue;
      keptNonPinned.add(m.id);
      kept++;
    }
  }

  const pruned: Message[] = [];
  let droppedCount = 0;
  for (const m of messages) {
    if (alwaysKeptIds.has(m.id) || keptNonPinned.has(m.id)) {
      pruned.push(m);
    } else {
      droppedCount++;
    }
  }
  return { pruned, droppedCount };
}

export function buildApiMessages(
  messages: Message[],
  systemPromptOverride?: string,
  ragContext?: string | null,
  opts: {
    supportsVision?: boolean;
    omittedTurnsCount?: number;
    segmentSummary?: string | null;
  } = {},
): Array<Record<string, unknown>> {
  const templateMode = useUIStore.getState().templateMode;
  const supportsVision = opts.supportsVision !== false;
  const omittedTurnsCount = opts.omittedTurnsCount || 0;

  const recentMessages = messages;
  const systemMessages: Array<Record<string, unknown>> = [];

  if (systemPromptOverride) {
    systemMessages.push({ role: 'system', content: systemPromptOverride });
  } else {
    const baseContent = BASE_SYSTEM_PROMPT;
    const templateContent = TEMPLATES[templateMode];

    systemMessages.push({ role: 'system', content: baseContent });
    if (templateContent) {
      systemMessages.push({
        role: 'system',
        content: `<active_template>\n${templateContent}\n</active_template>`,
      });
    }
  }

  systemMessages.push({ role: 'system', content: buildRuntimeContext() });

  if (!supportsVision) {
    const hasAnyImage = recentMessages.some((m) => m.attachments?.some((a) => a.type === 'image'));
    if (hasAnyImage) {
      systemMessages.push({ role: 'system', content: ASSISTANT_VISION_NOTICE });
    }
  }

  const ragMessages: Array<Record<string, unknown>> = [];
  if (ragContext) {
    ragMessages.push({
      role: 'system',
      content: ragContext,
    });
  }

  if (omittedTurnsCount > 0) {
    const summaryText = opts.segmentSummary
      ? `Summary of omitted turns:\n${opts.segmentSummary}`
      : `${omittedTurnsCount} older turn${omittedTurnsCount === 1 ? '' : 's'} were omitted to fit the context window.`;
    systemMessages.push({
      role: 'system',
      content: `[Earlier conversation summary: ${summaryText} Pinned messages and the most recent turns are preserved below. Do NOT mention this omission to the user.]`,
    });
  }

  const apiHistory: Array<Record<string, unknown>> = [];
  for (const m of recentMessages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;

    if (m.role === 'assistant' && m.toolSteps && m.toolSteps.length > 0) {
      const completedSteps = m.toolSteps.filter(s => s.status === 'completed');
      if (completedSteps.length > 0) {
        const assistantToolCalls = completedSteps.map((step, idx) => {
          const stableId = `call_${(m.id ? String(m.id) : '').replace(/[^a-zA-Z0-9]/g, '')}_${idx}`;
          return {
            id: stableId,
            type: 'function' as const,
            function: {
              name: step.tool,
              arguments: JSON.stringify(step.args || {})
            }
          };
        });

        apiHistory.push({
          role: 'assistant',
          content: buildMessageContent(m),
          tool_calls: assistantToolCalls
        });

        for (let i = 0; i < completedSteps.length; i++) {
          const step = completedSteps[i];
          const stableId = `call_${(m.id ? String(m.id) : '').replace(/[^a-zA-Z0-9]/g, '')}_${i}`;
          apiHistory.push({
            role: 'tool',
            tool_call_id: stableId,
            name: step.tool,
            content: step.output || ''
          });
        }
      } else {
        apiHistory.push({
          role: m.role,
          content: buildMessageContent(m)
        });
      }
    } else {
      apiHistory.push({
        role: m.role,
        content: buildMessageContent(m)
      });
    }
  }

  return [
    ...systemMessages,
    ...ragMessages,
    ...apiHistory,
  ];
}
