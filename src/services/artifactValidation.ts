import type { ArtifactType, ArtifactValidationReport } from '../types';

function report(errors: string[], warnings: string[] = []): ArtifactValidationReport {
  return {
    ok: errors.length === 0,
    status: errors.length === 0 ? 'valid' : 'invalid',
    errors,
    warnings,
    checkedAt: Date.now(),
  };
}

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) || []).length;
}

function validateHtml(content: string): ArtifactValidationReport {
  const text = content.trim();
  const lower = text.toLowerCase();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!text) errors.push('HTML artifact is empty.');
  if (!lower.includes('<html')) errors.push('Missing <html> root element.');
  if (!lower.includes('<head')) warnings.push('Missing <head>; preview can still run but document metadata may be incomplete.');
  if (!lower.includes('<body')) errors.push('Missing <body> element.');
  if (countMatches(lower, /<script[\s>]/g) !== countMatches(lower, /<\/script>/g)) {
    errors.push('Unbalanced <script> tags.');
  }
  if (countMatches(lower, /<style[\s>]/g) !== countMatches(lower, /<\/style>/g)) {
    errors.push('Unbalanced <style> tags.');
  }
  if (lower.includes('<lucen_artifact')) errors.push('Artifact tags leaked into HTML body.');

  return report(errors, warnings);
}

function validateSvg(content: string): ArtifactValidationReport {
  const text = content.trim();
  const lower = text.toLowerCase();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!lower.startsWith('<svg')) errors.push('SVG artifact must start with a single <svg> root element.');
  if (!lower.endsWith('</svg>')) errors.push('SVG artifact must end with </svg>.');
  if (countMatches(lower, /<svg[\s>]/g) !== 1) errors.push('SVG artifact must contain exactly one <svg> root.');
  if (/<script[\s>]/i.test(text)) errors.push('SVG artifact cannot include script tags.');
  if (!/viewbox\s*=/i.test(text)) warnings.push('SVG is missing viewBox; scaling may be poor.');

  return report(errors, warnings);
}

function validateMermaid(content: string): ArtifactValidationReport {
  const text = content.trim();
  const errors: string[] = [];
  const warnings: string[] = [];
  const first = text.split('\n').find((line) => line.trim())?.trim().toLowerCase() || '';

  if (!text) errors.push('Mermaid artifact is empty.');
  if (!/^(flowchart|graph|sequencediagram|classdiagram|statediagram|erdiagram|journey|gantt|pie|mindmap|timeline|gitgraph)\b/.test(first.replace(/\s+/g, ''))) {
    errors.push('Mermaid artifact must start with a valid diagram declaration.');
  }
  if (/box-shadow|drop-shadow|backdrop-filter/i.test(text)) {
    errors.push('Mermaid artifact includes unsupported shadow styling.');
  }
  if (/[a-zA-Z0-9_]+\[[^\]"]*\([^)]*\)[^\]"]*\]/.test(text)) {
    warnings.push('Some node labels with parentheses are not quoted and may fail Mermaid parsing.');
  }

  return report(errors, warnings);
}

function validateFile(content: string, filename?: string): ArtifactValidationReport {
  const text = content.trim();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!text) errors.push('File artifact is empty.');
  if (filename?.toLowerCase().endsWith('.json')) {
    try {
      JSON.parse(text);
    } catch (err) {
      errors.push(`Invalid JSON: ${err instanceof Error ? err.message : 'parse failed'}`);
    }
  }
  if (!filename) warnings.push('File artifact has no filename.');

  return report(errors, warnings);
}

export function validateArtifactContent(
  type: ArtifactType,
  content: string,
  filename?: string,
): ArtifactValidationReport {
  if (type === 'html') return validateHtml(content);
  if (type === 'svg') return validateSvg(content);
  if (type === 'mermaid') return validateMermaid(content);
  return validateFile(content, filename);
}
