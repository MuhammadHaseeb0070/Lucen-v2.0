import { v4 as uuidv4 } from 'uuid';
import { streamChat } from './openrouter';
import type { Message } from '../types';
import type {
  ReactProject,
  WorkspaceAiMessage,
  WorkspaceDiagnostic,
  WorkspacePatch,
  WorkspaceRuntimeLog,
} from '../types/workspace';

export const WORKSPACE_AI_SYSTEM_PROMPT = `<lucen_workspace_system>
You are Lucen's dedicated React Workspace coding agent.

You are operating inside a frontend-only React workspace. The user is editing a real multi-file React web app.

Core behavior:
- Prefer precise, minimal edits over broad rewrites.
- Edit the fewest files necessary.
- Preserve the user's existing architecture unless there is a clear bug or explicit refactor request.
- Never invent backend or database code for this workspace.
- Assume the runtime is frontend-only React.
- When fixing an error, focus on the specific files and lines implicated by the provided diagnostics first.

Response format:
- Write your normal explanation in plain markdown text.
- If you want Lucen to apply file changes automatically, include exactly one patch block after the explanation:

<lucen_workspace_patch>
{
  "summary": "short summary",
  "reasoning": "optional short reasoning",
  "operations": [
    {
      "type": "replaceInFile",
      "path": "src/App.tsx",
      "oldText": "old snippet",
      "newText": "new snippet"
    }
  ]
}
</lucen_workspace_patch>

Allowed operation types:
- createFile { type, path, content }
- updateFile { type, path, content }
- replaceInFile { type, path, oldText, newText }
- renameFile { type, path, newPath }
- deleteFile { type, path }
- updateDependencies { type, dependencies?, devDependencies? }

Patch rules:
- Prefer replaceInFile for local fixes.
- Use updateFile only when a file needs substantial replacement.
- Do not include operations for untouched files.
- Paths must be project-relative.
- The patch JSON must be valid JSON.

Do not use artifact tags in this mode.
</lucen_workspace_system>`;

export interface WorkspaceAiContext {
  project: ReactProject;
  selectedPaths: string[];
  diagnostics: WorkspaceDiagnostic[];
  runtimeLogs: WorkspaceRuntimeLog[];
  history: WorkspaceAiMessage[];
}

export interface WorkspaceAiStreamOptions {
  prompt: string;
  context: WorkspaceAiContext;
  onChunk: (chunk: string) => void;
  onDone: (result: { content: string; patch: WorkspacePatch | null }) => void;
  onError: (message: string) => void;
}

function buildWorkspaceContextBlock(context: WorkspaceAiContext, prompt: string): string {
  const selectedPaths = context.selectedPaths.length > 0
    ? context.selectedPaths
    : (context.project.entryFilePath ? [context.project.entryFilePath] : Object.keys(context.project.files).slice(0, 3));

  const fileBlocks = selectedPaths
    .map((path) => context.project.files[path])
    .filter(Boolean)
    .map((file) => [
      `File: ${file.path}`,
      '```',
      file.content,
      '```',
    ].join('\n'))
    .join('\n\n');

  const diagnosticsBlock = context.diagnostics.length > 0
    ? context.diagnostics.slice(0, 20).map((diagnostic) => {
        const location = [diagnostic.path, diagnostic.line, diagnostic.column]
          .filter((value) => value !== undefined && value !== null && value !== '')
          .join(':');
        return `- [${diagnostic.severity.toUpperCase()}] ${diagnostic.title}${location ? ` (${location})` : ''}\n  ${diagnostic.message}`;
      }).join('\n')
    : '- No active diagnostics provided.';

  const runtimeBlock = context.runtimeLogs.length > 0
    ? context.runtimeLogs.slice(-10).map((log) => `- [${log.level.toUpperCase()}] ${log.message}`).join('\n')
    : '- No recent runtime logs provided.';

  return [
    `Project: ${context.project.name}`,
    `Template: ${context.project.template}`,
    `Selected paths: ${selectedPaths.join(', ') || '(none)'}`,
    '',
    'Diagnostics:',
    diagnosticsBlock,
    '',
    'Recent runtime logs:',
    runtimeBlock,
    '',
    'Relevant file contents:',
    fileBlocks || '(no file content available)',
    '',
    'User request:',
    prompt,
  ].join('\n');
}

export function stripWorkspacePatchEnvelope(content: string): string {
  return content.replace(/<lucen_workspace_patch>[\s\S]*?<\/lucen_workspace_patch>/g, '').trim();
}

export function extractWorkspacePatch(content: string): WorkspacePatch | null {
  const match = content.match(/<lucen_workspace_patch>\s*([\s\S]*?)\s*<\/lucen_workspace_patch>/i);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1]) as Omit<WorkspacePatch, 'id' | 'createdAt' | 'status'>;
    if (!parsed || !Array.isArray(parsed.operations)) return null;

    return {
      id: uuidv4(),
      summary: parsed.summary || 'Workspace update',
      reasoning: parsed.reasoning,
      createdAt: Date.now(),
      status: 'pending',
      operations: parsed.operations,
      rawResponse: content,
    };
  } catch {
    return null;
  }
}

export async function streamWorkspaceAiResponse(options: WorkspaceAiStreamOptions): Promise<void> {
  const { context, prompt } = options;
  const workspaceMessages: Message[] = context.history.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.createdAt,
  }));

  workspaceMessages.push({
    id: uuidv4(),
    role: 'user',
    content: buildWorkspaceContextBlock(context, prompt),
    timestamp: Date.now(),
  });

  let fullContent = '';
  await streamChat(workspaceMessages, {
    onChunk: (chunk) => {
      fullContent += chunk;
      options.onChunk(chunk);
    },
    onReasoning: () => {
      // Workspace mode keeps the UI focused on concrete output, not streamed reasoning.
    },
    onDone: () => {
      options.onDone({
        content: stripWorkspacePatchEnvelope(fullContent),
        patch: extractWorkspacePatch(fullContent),
      });
    },
    onError: options.onError,
  }, {
    systemPromptOverride: WORKSPACE_AI_SYSTEM_PROMPT,
  });
}
