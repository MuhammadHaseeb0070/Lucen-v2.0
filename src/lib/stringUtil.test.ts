import { describe, it, expect } from 'vitest';
import { sanitizeMinimaxTags } from './stringUtil';

describe('sanitizeMinimaxTags', () => {
  it('should pass normal markdown text through unchanged', () => {
    const text = 'Hello world! This is a simple response.';
    expect(sanitizeMinimaxTags(text)).toBe(text);
  });

  it('should strip paired web_search tags and all their content', () => {
    const text = 'Search complete.\n<web_search>\n  <query>Bronco-F cough syrup</query>\n  <max_results>5</max_results>\n</web_search>\nHere is what I found.';
    expect(sanitizeMinimaxTags(text)).toBe('Search complete.\n\nHere is what I found.');
  });

  it('should strip unpaired web_search tag openings and parameters', () => {
    const text = '<web_search>\n<query>Bronco-F</query>\n<max_results>5</max_results>';
    // query is in tags, so it is stripped paired/unpaired
    // max_results is in tags, so it is stripped paired/unpaired
    // web_search is in tags, so it is stripped
    const result = sanitizeMinimaxTags(text);
    expect(result.trim()).toBe('');
  });

  it('should strip partial tag openings at the end of the stream', () => {
    const text = 'I want to search for <web_search';
    expect(sanitizeMinimaxTags(text)).toBe('I want to search for ');
  });

  it('should strip other leaked parameter tags like search_title and file_id', () => {
    const text = 'Retrieving <search_title>Checking weather</search_title> <file_id>file-uuid-123</file_id>';
    expect(sanitizeMinimaxTags(text).trim()).toBe('Retrieving');
  });

  it('should handle malformed tag closures like query>', () => {
    const text = 'query>some query content\nDone.';
    expect(sanitizeMinimaxTags(text)).toBe('\nDone.');
  });
});
