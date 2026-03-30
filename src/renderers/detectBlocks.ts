export type Block =
  | { type: 'artifact'; raw: string; artifactType: string; title: string; content: string }
  | { type: 'mermaid'; raw: string; content: string }
  | { type: 'math_block'; raw: string; content: string } // $$...$$
  | { type: 'code'; raw: string; lang: string; content: string }
  | { type: 'table'; raw: string; content: string }
  | { type: 'markdown'; raw: string; content: string };

function firstMatch(
  re: RegExp,
  text: string,
  startIndex: number
): { index: number; match: RegExpExecArray } | null {
  re.lastIndex = startIndex;
  const match = re.exec(text);
  if (!match) return null;
  const index = match.index ?? 0;
  return { index, match };
}

/**
 * Split an AI response into typed blocks.
 *
 * Priority order (most specific first):
 * artifact -> mermaid -> math_block -> code -> table -> markdown
 */
export function detectBlocks(text: string): Block[] {
  if (!text) return [];

  const detectors: Array<{
    key: Block['type'];
    re: RegExp;
    build: (match: RegExpExecArray) => Block;
  }> = [
    {
      key: 'artifact',
      // <lucen_artifact type="..." title="...">...</lucen_artifact>
      re: /<lucen_artifact\s+type="([^"]+)"\s+title="([^"]+)">([\s\S]*?)<\/lucen_artifact>/g,
      build: (m) => ({
        type: 'artifact',
        raw: m[0],
        artifactType: m[1],
        title: m[2],
        content: (m[3] ?? '').trim(),
      }),
    },
    {
      key: 'mermaid',
      re: /^```mermaid\n([\s\S]*?)^```/gm,
      build: (m) => ({
        type: 'mermaid',
        raw: m[0],
        content: (m[1] ?? '').trim(),
      }),
    },
    {
      key: 'math_block',
      re: /\$\$([\s\S]*?)\$\$/g,
      build: (m) => ({
        type: 'math_block',
        raw: m[0],
        content: (m[1] ?? '').trim(),
      }),
    },
    {
      key: 'code',
      re: /^```(\w+)\n([\s\S]*?)^```/gm,
      build: (m) => ({
        type: 'code',
        raw: m[0],
        lang: (m[1] ?? '').trim(),
        content: (m[2] ?? '').trimEnd(),
      }),
    },
    {
      key: 'table',
      // Extract contiguous lines where every non-empty line starts with |
      // (as described in the prompt).
      re: /^(\|.+\n)+/gm,
      build: (m) => {
        const raw = m[0] ?? '';
        return {
          type: 'table',
          raw,
          content: raw.trimEnd(),
        };
      },
    },
  ];

  const blocks: Block[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    let best:
      | { detectorIndex: number; index: number; match: RegExpExecArray; key: Block['type'] }
      | null = null;

    for (let i = 0; i < detectors.length; i++) {
      const det = detectors[i];
      // Clone regex to avoid lastIndex cross-contamination.
      const re = new RegExp(det.re.source, det.re.flags);
      const found = firstMatch(re, text, cursor);
      if (!found) continue;

      if (!best) {
        best = { detectorIndex: i, index: found.index, match: found.match, key: det.key };
        continue;
      }

      if (found.index < best.index) {
        best = { detectorIndex: i, index: found.index, match: found.match, key: det.key };
        continue;
      }

      // Same start index: pick the most specific (earlier detector in list).
      if (found.index === best.index && i < best.detectorIndex) {
        best = { detectorIndex: i, index: found.index, match: found.match, key: det.key };
      }
    }

    if (!best) {
      const tail = text.slice(cursor);
      if (tail) blocks.push({ type: 'markdown', raw: tail, content: tail });
      break;
    }

    if (best.index > cursor) {
      const md = text.slice(cursor, best.index);
      if (md) blocks.push({ type: 'markdown', raw: md, content: md });
    }

    const block = detectors[best.detectorIndex].build(best.match);
    blocks.push(block);
    cursor = best.index + best.match[0].length;
  }

  // Avoid returning empty markdown blocks at edges.
  return blocks.filter((b) => b.raw.trim() !== '');
}

