const text = '<lucen_artifact type="html" title="Test">\n' + 'a'.repeat(100000) + '\n</lucen_artifact>';
const COMPLETE_ARTIFACT_RE = /<lucen_artifact\s+([^>]*)>([\s\S]*?)<\/lucen_artifact>/g;
const start = Date.now();
const result = text.replace(COMPLETE_ARTIFACT_RE, () => 'MATCHED');
console.log('Matched:', result === 'MATCHED', 'Length:', result.length, 'Time:', Date.now() - start);
