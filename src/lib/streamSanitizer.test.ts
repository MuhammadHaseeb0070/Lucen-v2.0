import { StreamSanitizer } from './streamSanitizer';

describe('StreamSanitizer', () => {
  it('passes through normal text', () => {
    const sanitizer = new StreamSanitizer();
    let content = '';
    let reasoning = '';
    sanitizer.processChunk('Hello world!', c => content += c, r => reasoning += r);
    sanitizer.flush(c => content += c, r => reasoning += r);
    expect(content).toBe('Hello world!');
    expect(reasoning).toBe('');
  });

  it('hides complete hidden tags', () => {
    const sanitizer = new StreamSanitizer();
    let content = '';
    sanitizer.processChunk('Hello <lucen_system>internal stuff</lucen_system> world', c => content += c, () => {});
    sanitizer.flush(c => content += c, () => {});
    expect(content).toBe('Hello  world');
  });

  it('buffers and hides partial tags during streaming without leaking', () => {
    const sanitizer = new StreamSanitizer();
    let content = '';
    
    sanitizer.processChunk('Hello <lucen', c => content += c, () => {});
    expect(content).toBe('Hello ');
    
    sanitizer.processChunk('_system>internal', c => content += c, () => {});
    expect(content).toBe('Hello '); // Still buffered/hidden
    
    sanitizer.processChunk('</lucen_system> world', c => content += c, () => {});
    expect(content).toBe('Hello  world');
  });

  it('routes <think> tags to reasoning', () => {
    const sanitizer = new StreamSanitizer();
    let content = '';
    let reasoning = '';
    
    sanitizer.processChunk('Response: <think>this is a thought</think> End.', 
      c => content += c, 
      r => reasoning += r
    );
    sanitizer.flush(c => content += c, r => reasoning += r);
    
    expect(content).toBe('Response:  End.');
    expect(reasoning).toBe('this is a thought');
  });

  it('routes partial <think> tags to reasoning correctly during streaming', () => {
    const sanitizer = new StreamSanitizer();
    let content = '';
    let reasoning = '';
    
    sanitizer.processChunk('Start <thin', c => content += c, r => reasoning += r);
    expect(content).toBe('Start ');
    expect(reasoning).toBe('');
    
    // "step 1" is 6 chars. closeTag "</think>" is 8 chars.
    // StreamSanitizer holds back 8 chars to avoid tearing closing tags, so reasoning will still be empty.
    sanitizer.processChunk('k>step 1', c => content += c, r => reasoning += r);
    expect(content).toBe('Start ');
    expect(reasoning).toBe('');
    
    sanitizer.processChunk('...123456789</', c => content += c, r => reasoning += r);
    expect(reasoning).toBe('step 1...123');
    
    sanitizer.processChunk('think>End.', c => content += c, r => reasoning += r);
    sanitizer.flush(c => content += c, r => reasoning += r);
    
    expect(content).toBe('Start End.');
    expect(reasoning).toBe('step 1...123456789');
  });

  it('does not swallow normal HTML tags', () => {
    const sanitizer = new StreamSanitizer();
    let content = '';
    
    sanitizer.processChunk('<div><lucen_artifact id="x">Content</lucen_artifact></div>', c => content += c, () => {});
    sanitizer.flush(c => content += c, () => {});
    
    expect(content).toBe('<div><lucen_artifact id="x">Content</lucen_artifact></div>');
  });
});
