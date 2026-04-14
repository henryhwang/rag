import { describe, test, expect } from 'bun:test';
import { SimpleQueryRewriter } from '../src/query/rewrite/simple-rewriter.js';
import { LLMQueryRewriter } from '../src/query/rewrite/llm-rewriter.js';
import type { LLMProvider } from '../src/types/index.js';

describe('SimpleQueryRewriter', () => {
  const rewriter = new SimpleQueryRewriter();

  test('returns multiple query variants', async () => {
    const queries = await rewriter.rewrite('How to configure the API endpoint');
    expect(queries.length).toBeGreaterThanOrEqual(2);
  });

  test('includes original query', async () => {
    const queries = await rewriter.rewrite('How to configure the API endpoint');
    expect(queries[0]).toBe('How to configure the API endpoint');
  });

  test('produces lowercase variant', async () => {
    const queries = await rewriter.rewrite('HELLO WORLD');
    expect(queries.some((q) => q === 'hello world')).toBe(true);
  });

  test('produces stop-word removed variant', async () => {
    const queries = await rewriter.rewrite('how to configure the api endpoint');
    // Should have a version with stop words removed
    expect(queries.some((q) => !q.includes(' the ') && !q.includes(' to '))).toBe(true);
  });

  test('deduplicates results', async () => {
    const queries = await rewriter.rewrite('hello world');
    const uniqueQueries = new Set(queries);
    expect(queries.length).toBe(uniqueQueries.size);
  });

  test('throws on empty query', async () => {
    await expect(rewriter.rewrite('')).rejects.toThrow('Query cannot be empty');
    await expect(rewriter.rewrite('   ')).rejects.toThrow('Query cannot be empty');
  });

  test('handles single-word query', async () => {
    const queries = await rewriter.rewrite('typescript');
    expect(queries.length).toBeGreaterThanOrEqual(1);
    expect(queries[0]).toBe('typescript');
  });

  test('extracts bigrams from content words', async () => {
    const queries = await rewriter.rewrite('how to use typescript for web development');
    // Should include a bigram variant
    const bigramQuery = queries.find((q) => q.includes('typescript web') || q.includes('web development'));
    expect(bigramQuery).toBeDefined();
  });
});

describe('LLMQueryRewriter', () => {
  // Mock LLM that returns predictable alternative queries
  const createMockLLM = (response: string): LLMProvider => ({
    async generate(): Promise<string> {
      return response;
    },
    async stream(): AsyncIterable<string> {
      throw new Error('Not implemented');
    },
  });

  test('uses LLM to generate alternatives', async () => {
    const mockLLM = createMockLLM('1. how to use typescript\n2. typescript configuration\n3. typescript setup');
    const rewriter = new LLMQueryRewriter({ llm: mockLLM, numQueries: 3 });
    const queries = await rewriter.rewrite('typescript');
    expect(queries.length).toBeGreaterThan(0);
  });

  test('includes original query first', async () => {
    const mockLLM = createMockLLM('alternative query\nanother alternative');
    const rewriter = new LLMQueryRewriter({ llm: mockLLM, numQueries: 3 });
    const queries = await rewriter.rewrite('original query');
    expect(queries[0]).toBe('original query');
  });

  test('respects numQueries limit', async () => {
    const mockLLM = createMockLLM('alt1\nalt2\nalt3\nalt4\nalt5');
    const rewriter = new LLMQueryRewriter({ llm: mockLLM, numQueries: 3 });
    const queries = await rewriter.rewrite('test query');
    expect(queries.length).toBeLessThanOrEqual(3);
  });

  test('deduplicates LLM responses', async () => {
    const mockLLM = createMockLLM('same query\nsame query\nsame query');
    const rewriter = new LLMQueryRewriter({ llm: mockLLM, numQueries: 5 });
    const queries = await rewriter.rewrite('test query');
    const unique = new Set(queries);
    expect(queries.length).toBe(unique.size);
  });

  test('strips numbering from LLM output', async () => {
    const mockLLM = createMockLLM('1. first alternative\n2. second alternative\n3. third alternative');
    const rewriter = new LLMQueryRewriter({ llm: mockLLM, numQueries: 4 });
    const queries = await rewriter.rewrite('test');
    // None should start with a number
    expect(queries.some((q) => /^\d+[\.\)]/.test(q))).toBe(false);
  });

  test('strips bullet points from LLM output', async () => {
    const mockLLM = createMockLLM('- first alternative\n* second alternative\n- third alternative');
    const rewriter = new LLMQueryRewriter({ llm: mockLLM, numQueries: 4 });
    const queries = await rewriter.rewrite('test');
    expect(queries.some((q) => /^[-*]/.test(q))).toBe(false);
  });

  test('throws on empty query', async () => {
    const mockLLM = createMockLLM('alternative');
    const rewriter = new LLMQueryRewriter({ llm: mockLLM });
    await expect(rewriter.rewrite('')).rejects.toThrow('Query cannot be empty');
  });

  test('throws when numQueries < 1', () => {
    const mockLLM = createMockLLM('alternative');
    expect(() => new LLMQueryRewriter({ llm: mockLLM, numQueries: 0 })).toThrow(
      'numQueries must be at least 1',
    );
  });

  test('defaults numQueries to 3', () => {
    const mockLLM = createMockLLM('alt1\nalt2');
    const rewriter = new LLMQueryRewriter({ llm: mockLLM });
    // Should not throw; default is 3
    expect(rewriter).toBeDefined();
  });

  test('passes model option to LLM', async () => {
    let receivedOptions: { model?: string } | undefined;
    const mockLLM: LLMProvider = {
      async generate(_prompt: string, options?: { model?: string }): Promise<string> {
        receivedOptions = options;
        return 'alternative';
      },
      async stream(): AsyncIterable<string> {
        throw new Error('Not implemented');
      },
    };
    const rewriter = new LLMQueryRewriter({ llm: mockLLM, model: 'gpt-4o' });
    await rewriter.rewrite('test query');
    expect(receivedOptions?.model).toBe('gpt-4o');
  });
});
