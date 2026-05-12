import type {
  ArtifactGenerationPlan,
  ArtifactGenerationSection,
  ArtifactType,
  Message,
} from '../types';
import { detectResponseMode } from './outputBudget';
import { completeChat } from './openrouter';
import { validateArtifactContent } from './artifactValidation';
import { createArtifactJob, updateArtifactJob } from './artifactGenerationDb';
import { saveArtifact } from './artifactDb';

const MAX_SECTIONS = 6;
const SECTION_TOKEN_BUDGET = 1800;
const PLAN_TOKEN_BUDGET = 900;
const REPAIR_TOKEN_BUDGET = 2200;
const MAX_TOTAL_CHARS = 80_000;
const MAX_REPAIR_ATTEMPTS = 2;

export interface ArtifactJobCallbacks {
  onStatus: (status: Message['generationStatus'], detail?: string) => void;
  onPartial: (content: string) => void;
}

export function shouldUseArtifactJob(messages: Message[]): boolean {
  if (detectResponseMode(messages) !== 'artifact') return false;
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const text = lastUser?.content || '';
  return (
    text.length > 220 ||
    /\b(full|complete|entire|large|dashboard|website|site|app|game|html|svg|mermaid|file|artifact|report|document|landing page)\b/i.test(text)
  );
}

function artifactTag(plan: ArtifactGenerationPlan, content: string): string {
  const title = plan.title.replace(/"/g, '&quot;');
  const filename = plan.type === 'file' && plan.filename
    ? ` filename="${plan.filename.replace(/"/g, '&quot;')}"`
    : '';
  return `<lucen_artifact type="${plan.type}" title="${title}"${filename}>\n${content.trim()}\n</lucen_artifact>`;
}

function safeJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || trimmed;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw);
}

function normalizeType(value: unknown): ArtifactType {
  const type = String(value || 'html').toLowerCase();
  return type === 'svg' || type === 'mermaid' || type === 'file' ? type : 'html';
}

function normalizePlan(raw: unknown): ArtifactGenerationPlan {
  const obj = raw && typeof raw === 'object' ? raw as Record<string, any> : {};
  const type = normalizeType(obj.type);
  const sectionsRaw = Array.isArray(obj.sections) ? obj.sections.slice(0, MAX_SECTIONS) : [];
  const sections: ArtifactGenerationSection[] = sectionsRaw.length > 0
    ? sectionsRaw.map((s: any, idx: number) => ({
      id: String(s.id || `section_${idx + 1}`).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40),
      title: String(s.title || `Section ${idx + 1}`).slice(0, 80),
      purpose: s.purpose ? String(s.purpose).slice(0, 300) : undefined,
      tokenBudget: Math.min(SECTION_TOKEN_BUDGET, Math.max(300, Number(s.tokenBudget) || SECTION_TOKEN_BUDGET)),
      status: 'pending',
    }))
    : [{ id: 'artifact', title: 'Artifact', tokenBudget: SECTION_TOKEN_BUDGET, status: 'pending' }];

  return {
    type,
    title: String(obj.title || 'Artifact').slice(0, 100),
    filename: obj.filename ? String(obj.filename).slice(0, 120) : undefined,
    estimatedTokens: Math.max(0, Number(obj.estimatedTokens) || 0),
    maxTotalChars: Math.min(MAX_TOTAL_CHARS, Math.max(10_000, Number(obj.maxTotalChars) || MAX_TOTAL_CHARS)),
    sections,
  };
}

function planSchema(): Record<string, unknown> {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'artifact_generation_plan',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'title', 'estimatedTokens', 'maxTotalChars', 'sections'],
        properties: {
          type: { type: 'string', enum: ['html', 'svg', 'mermaid', 'file'] },
          title: { type: 'string' },
          filename: { type: 'string' },
          estimatedTokens: { type: 'number' },
          maxTotalChars: { type: 'number' },
          sections: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_SECTIONS,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'title', 'purpose', 'tokenBudget'],
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                purpose: { type: 'string' },
                tokenBudget: { type: 'number' },
              },
            },
          },
        },
      },
    },
  };
}

async function planArtifact(
  messages: Message[],
  conversationId: string,
  messageId: string,
): Promise<ArtifactGenerationPlan> {
  const plannerMessages = [
    ...messages,
    {
      id: `artifact-plan-${messageId}`,
      role: 'user' as const,
      content:
        'Create a bounded artifact generation plan. Split the final artifact into the smallest number of deterministic sections needed. Keep the total output under product limits. Return JSON only.',
      timestamp: Date.now(),
    },
  ];
  const result = await completeChat(plannerMessages, {
    conversationId,
    messageId,
    callKind: 'artifact_plan',
    maxTokens: PLAN_TOKEN_BUDGET,
    responseFormat: planSchema(),
  });
  return normalizePlan(safeJson(result.content));
}

async function generateSection(params: {
  messages: Message[];
  plan: ArtifactGenerationPlan;
  section: ArtifactGenerationSection;
  priorContent: string;
  conversationId: string;
  messageId: string;
}): Promise<string> {
  const prompt = [
    `Generate only this artifact section: ${params.section.id} - ${params.section.title}.`,
    `Artifact type: ${params.plan.type}. Title: ${params.plan.title}.`,
    params.plan.filename ? `Filename: ${params.plan.filename}.` : '',
    params.section.purpose ? `Section purpose: ${params.section.purpose}` : '',
    `Hard limit: about ${params.section.tokenBudget} output tokens for this section.`,
    `Current assembled artifact length: ${params.priorContent.length} chars.`,
    'Return raw section content only. No markdown fences. No lucen_artifact tags. No commentary.',
  ].filter(Boolean).join('\n');

  const result = await completeChat([
    ...params.messages,
    {
      id: `artifact-section-${params.section.id}-${params.messageId}`,
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    },
  ], {
    conversationId: params.conversationId,
    messageId: params.messageId,
    callKind: 'artifact_section',
    maxTokens: params.section.tokenBudget,
  });

  return result.content.trim();
}

async function repairArtifact(params: {
  messages: Message[];
  plan: ArtifactGenerationPlan;
  content: string;
  errors: string[];
  conversationId: string;
  messageId: string;
}): Promise<string> {
  const result = await completeChat([
    ...params.messages,
    {
      id: `artifact-repair-${params.messageId}`,
      role: 'user',
      content: [
        'Repair this artifact so it validates. Return the full corrected artifact body only.',
        `Type: ${params.plan.type}. Title: ${params.plan.title}.`,
        `Validation errors: ${params.errors.join('; ')}`,
        'Do not include markdown fences, explanations, or lucen_artifact tags.',
        '',
        params.content,
      ].join('\n'),
      timestamp: Date.now(),
    },
  ], {
    conversationId: params.conversationId,
    messageId: params.messageId,
    callKind: 'artifact_repair',
    maxTokens: REPAIR_TOKEN_BUDGET,
  });
  return result.content.trim();
}

export async function runArtifactGenerationJob(params: {
  messages: Message[];
  conversationId: string;
  messageId: string;
  signal?: AbortSignal;
  callbacks: ArtifactJobCallbacks;
}): Promise<{ content: string; complete: boolean; jobId: string; finalArtifactId: string | null; validation: ReturnType<typeof validateArtifactContent> }> {
  const jobId = crypto.randomUUID();
  await createArtifactJob({ id: jobId, conversationId: params.conversationId, messageId: params.messageId });
  params.callbacks.onStatus('planning', 'Planning artifact sections');

  const plan = await planArtifact(params.messages, params.conversationId, params.messageId);
  await updateArtifactJob(jobId, { status: 'generating', plan, sections: plan.sections });

  let assembled = '';
  const sections = [...plan.sections];

  for (let i = 0; i < sections.length; i++) {
    if (params.signal?.aborted) throw new Error('Generation stopped');
    params.callbacks.onStatus('generating', `Generating ${sections[i].title}`);
    sections[i] = { ...sections[i], status: 'generating' };
    await updateArtifactJob(jobId, { status: 'generating', currentSection: i, sections, assembledContent: assembled });

    const sectionContent = await generateSection({
      messages: params.messages,
      plan,
      section: sections[i],
      priorContent: assembled,
      conversationId: params.conversationId,
      messageId: params.messageId,
    });

    assembled = `${assembled}${assembled ? '\n\n' : ''}${sectionContent}`.slice(0, plan.maxTotalChars);
    sections[i] = { ...sections[i], status: 'valid', content: sectionContent };
    params.callbacks.onPartial(artifactTag(plan, assembled));
    await updateArtifactJob(jobId, { sections, assembledContent: assembled, currentSection: i + 1 });
  }

  params.callbacks.onStatus('validating', 'Validating final artifact');
  let validation = validateArtifactContent(plan.type, assembled, plan.filename);
  let repairCount = 0;

  while (!validation.ok && repairCount < MAX_REPAIR_ATTEMPTS) {
    repairCount++;
    params.callbacks.onStatus('repairing', `Repairing artifact (${repairCount}/${MAX_REPAIR_ATTEMPTS})`);
    await updateArtifactJob(jobId, {
      status: 'repairing',
      retryCount: repairCount,
      validationErrors: validation.errors,
    });
    assembled = await repairArtifact({
      messages: params.messages,
      plan,
      content: assembled,
      errors: validation.errors,
      conversationId: params.conversationId,
      messageId: params.messageId,
    });
    validation = validateArtifactContent(plan.type, assembled, plan.filename);
    params.callbacks.onPartial(artifactTag(plan, assembled));
  }

  const complete = validation.ok;
  const finalContent = artifactTag(plan, assembled);
  let finalArtifactId: string | null = null;
  if (complete) {
    finalArtifactId = await saveArtifact({
      clientId: `${params.messageId}-artifact-0`,
      conversationId: params.conversationId,
      messageId: params.messageId,
      type: plan.type,
      title: plan.title,
      content: assembled,
    });
  }

  await updateArtifactJob(jobId, {
    status: complete ? 'complete' : 'partial_saved',
    sections,
    assembledContent: assembled,
    validationErrors: validation.errors,
    retryCount: repairCount,
    finalArtifactId,
  });
  params.callbacks.onStatus(complete ? 'complete' : 'partial_saved', complete ? 'Artifact complete' : 'Partial artifact saved');

  return { content: finalContent, complete, jobId, finalArtifactId, validation };
}
