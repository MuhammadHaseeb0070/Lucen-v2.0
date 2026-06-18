export class StreamSanitizer {
  private buffer = '';
  private insideHiddenTag: string | null = null;
  private insideRoutingTag: string | null = null;
  
  // Tags that should be completely hidden from the user output
  private hiddenTags = [
    'lucen_system', 'active_template', 'template', 
    'assistant_vision_notice', 'runtime_context', 'image_perception',
    'minimax:tool_call', 'query', 'search_query', 'web_search',
    'tool_call', 'invoke', 'parameter'
  ];
  
  // Tags whose inner content should be routed to reasoning
  private routingTags = ['think'];

  /**
   * Process a chunk of text.
   * @param chunk The raw text chunk from the stream.
   * @param emitContent Callback to emit safe text to the main content channel.
   * @param emitReasoning Callback to emit safe text to the reasoning channel.
   */
  public processChunk(chunk: string, emitContent: (text: string) => void, emitReasoning: (text: string) => void) {
    this.buffer += chunk;
    
    while (this.buffer.length > 0) {
      if (this.insideHiddenTag) {
        const closeTag = `</${this.insideHiddenTag}>`;
        const closeIdx = this.buffer.toLowerCase().indexOf(closeTag.toLowerCase());
        if (closeIdx !== -1) {
          // Discard the hidden tag and its contents
          this.buffer = this.buffer.slice(closeIdx + closeTag.length);
          this.insideHiddenTag = null;
        } else {
          // Wait for the closing tag. Retain the end of the buffer just in case it's a partial close tag
          const discardUpTo = Math.max(0, this.buffer.length - closeTag.length);
          this.buffer = this.buffer.slice(discardUpTo);
          return;
        }
      } else if (this.insideRoutingTag) {
        const closeTag = `</${this.insideRoutingTag}>`;
        const closeIdx = this.buffer.toLowerCase().indexOf(closeTag.toLowerCase());
        if (closeIdx !== -1) {
          emitReasoning(this.buffer.slice(0, closeIdx));
          this.buffer = this.buffer.slice(closeIdx + closeTag.length);
          this.insideRoutingTag = null;
        } else {
          const safeLen = Math.max(0, this.buffer.length - closeTag.length);
          if (safeLen > 0) {
            emitReasoning(this.buffer.slice(0, safeLen));
            this.buffer = this.buffer.slice(safeLen);
          }
          return;
        }
      } else {
        const openIdx = this.buffer.indexOf('<');
        if (openIdx === -1) {
          // Fast path: no tags in buffer
          emitContent(this.buffer);
          this.buffer = '';
          return;
        }
        
        if (openIdx > 0) {
          emitContent(this.buffer.slice(0, openIdx));
          this.buffer = this.buffer.slice(openIdx);
        }
        
        let matchedHiddenTag: string | null = null;
        let matchedRoutingTag: string | null = null;
        let partialMatch = false;
        
        const lowerBuffer = this.buffer.toLowerCase();

        const checkTags = (tags: string[], isHidden: boolean) => {
          for (const tag of tags) {
            const openTag = `<${tag.toLowerCase()}`;
            const openStr1 = `${openTag}>`;
            const openStr2 = `${openTag} `;
            const openStr3 = `${openTag}\n`;
            
            if (lowerBuffer.startsWith(openStr1)) {
              if (isHidden) matchedHiddenTag = tag;
              else matchedRoutingTag = tag;
              this.buffer = this.buffer.slice(openStr1.length);
              return true;
            } else if (lowerBuffer.startsWith(openStr2) || lowerBuffer.startsWith(openStr3)) {
              const endBracket = this.buffer.indexOf('>');
              if (endBracket !== -1) {
                if (isHidden) matchedHiddenTag = tag;
                else matchedRoutingTag = tag;
                this.buffer = this.buffer.slice(endBracket + 1);
                return true;
              } else {
                partialMatch = true;
                return true;
              }
            } else if (openTag.startsWith(lowerBuffer)) {
              partialMatch = true;
              return true;
            }
          }
          return false;
        };

        if (checkTags(this.hiddenTags, true)) {
          if (partialMatch) return;
          this.insideHiddenTag = matchedHiddenTag;
          continue;
        }
        
        if (checkTags(this.routingTags, false)) {
          if (partialMatch) return;
          this.insideRoutingTag = matchedRoutingTag;
          continue;
        }
        
        // Not a hidden/routing tag. Emit the '<' and continue.
        if (this.buffer.length > 0) {
          emitContent(this.buffer[0]);
          this.buffer = this.buffer.slice(1);
        }
      }
    }
  }
  
  /**
   * Flush any remaining safe text at the end of the stream.
   */
  public flush(emitContent: (text: string) => void, emitReasoning: (text: string) => void) {
    if (this.insideRoutingTag && this.buffer.length > 0) {
      emitReasoning(this.buffer);
      this.buffer = '';
    } else if (!this.insideHiddenTag && this.buffer.length > 0) {
      emitContent(this.buffer);
      this.buffer = '';
    }
  }
}
