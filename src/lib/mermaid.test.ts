import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Mermaid Security Level Regression Test', () => {
  it('should verify that ArtifactRenderer.tsx configures mermaid with securityLevel: "strict"', () => {
    const filePath = path.resolve(__dirname, '../components/ArtifactRenderer.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // We expect mermaid.initialize to contain securityLevel: 'strict'
    expect(content).toContain('mermaid.initialize');
    
    // Find the mermaid.initialize call
    const initIndex = content.indexOf('mermaid.initialize');
    const initBlock = content.substring(initIndex, initIndex + 300);
    
    expect(initBlock).toMatch(/securityLevel:\s*['"]strict['"]/);
  });

  it('should verify that ArtifactWorkspace.tsx configures mermaid with securityLevel: "strict"', () => {
    const filePath = path.resolve(__dirname, '../components/ArtifactWorkspace.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // We expect mermaid.initialize to contain securityLevel: 'strict'
    expect(content).toContain('mermaid.initialize');
    
    // Find the mermaid.initialize call
    const initIndex = content.indexOf('mermaid.initialize');
    const initBlock = content.substring(initIndex, initIndex + 300);
    
    expect(initBlock).toMatch(/securityLevel:\s*['"]strict['"]/);
  });
});
