import { describe, it, expect } from 'bun:test';
import { SimpleQueryRewriter } from '../src/query/rewrite/simple-rewriter.ts';
import { LLMQueryRewriter } from '../src/query/rewrite/llm-rewriter.ts';
import type { LLMProvider } from '../src/types/index.ts';

describe('SimpleQueryRewriter', () => {
  const rewriter = new SimpleQueryRewriter();

  it('returns multiple query variants', async () => {
    const queries = await rewriter.rewrite('How to configure the API endpoint');
    expect(queries.length).toBeGreaterThanOrEqual(2);
  });

  it('includes original query', async () => {
    const queries = await rewriter.rewrite('How to configure the API endpoint');
    expect(queries[0]).toBe('How to configure the API endpoint');
  });

  it('produces lowercase variant', async () => {
    const queries = await rewriter.rewrite('HELLO WORLD');
    expect(queries.some((q) => q === 'hello world')).toBe(true);
  });

  it('produces stop-word removed variant', async () => {
    const queries = await rewriter.rewrite('how to configure the api endpoint');
    // Should have a version with stop words removed
    expect(queries.some((q) => !q.includes(' the ') && !q.includes(' to '))).toBe(true);
  });

  it('deduplicates results', async () => {
    const queries = await rewriter.rewrite('hello world');
    const uniqueQueries = new Set(queries);
    expect(queries.length).toBe(uniqueQueries.size);
  });

  it('throws on empty query', async () => {
    await expect(rewriter.rewrite('')).rejects.toThrow('Query cannot be empty');
    await expect(rewriter.rewrite('   ')).rejects.toThrow('Query cannot be empty');
  });

  it('handles single-word query', async () => {
    const queries = await rewriter.rewrite('typescript');
    expect(queries.length).toBeGreaterThanOrEqual(1);
    expect(queries[0]).toBe('typescript');
  });

  it('extracts bigrams from content words', async () => {
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
    async *stream(): AsyncIterable<string> {
      throw new Error('Not implemented');
    },
  });

  it('uses LLM to generate alternatives', async () => {
    const mockLLM = createMockLLM('1. how to use typescript\n2. typescript configuration\n3. typescript setup');
    const rewriter = new LLMQueryRewriter({ llm: mockLLM, numQueries: 3 });
    const queries = await rewriter.rewrite('typescript');
    expect(queries.length).toBeGreaterThan(0);
  });

  it('includes original query first', async () => {
    const mockLLM = createMockLLM('alternative query\nanother alternative');
    const rewriter = new LLMQueryRewriter({ llm: mockLLM, numQueries: 3 });
    const queries = await rewriter.rewrite('original query');
    expect(queries[0]).toBe('original query');
  });

  it('respects numQueries limit', async () => {
    const mockLLM = createMockLLM('alt1\nalt2\nalt3\nalt4\nalt5');
    const rewriter = new LLMQueryRewriter({ llm: mockLLM, numQueries: 3 });
    const queries = await rewriter.rewrite('test query');
    expect(queries.length).toBeLessThanOrEqual(3);
  });

  it('deduplicates LLM responses', async () => {
    const mockLLM = createMockLLM('same query\nsame query\nsame query');
    const rewriter = new LLMQueryRewriter({ llm: mockLLM, numQueries: 5 });
    const queries = await rewriter.rewrite('test query');
    const unique = new Set(queries);
    expect(queries.length).toBe(unique.size);
  });

  it('strips numbering from LLM output', async () => {
    const mockLLM = createMockLLM('1. first alternative\n2. second alternative\n3. third alternative');
    const rewriter = new LLMQueryRewriter({ llm: mockLLM, numQueries: 4 });
    const queries = await rewriter.rewrite('test');
    // None should start with a number
    expect(queries.some((q) => /^\d+[\.\)]/.test(q))).toBe(false);
  });

  it('strips bullet points from LLM output', async () => {
    const mockLLM = createMockLLM('- first alternative\n* second alternative\n- third alternative');
    const rewriter = new LLMQueryRewriter({ llm: mockLLM, numQueries: 4 });
    const queries = await rewriter.rewrite('test');
    expect(queries.some((q) => /^[-*]/.test(q))).toBe(false);
  });

  it('throws on empty query', async () => {
    const mockLLM = createMockLLM('alternative');
    const rewriter = new LLMQueryRewriter({ llm: mockLLM });
    await expect(rewriter.rewrite('')).rejects.toThrow('Query cannot be empty');
  });

  it('throws when numQueries < 1', () => {
    const mockLLM = createMockLLM('alternative');
    expect(() => new LLMQueryRewriter({ llm: mockLLM, numQueries: 0 })).toThrow(
      'numQueries must be at least 1',
    );
  });

  it('defaults numQueries to 3', () => {
    const mockLLM = createMockLLM('alt1\nalt2');
    const rewriter = new LLMQueryRewriter({ llm: mockLLM });
    // Should not throw; default is 3
    expect(rewriter).toBeDefined();
  });

  it('passes model option to LLM', async () => {
    let receivedOptions: { model?: string } | undefined;
    const mockLLM: LLMProvider = {
      async generate(_prompt: string, options?: { model?: string }): Promise<string> {
        receivedOptions = options;
        return 'alternative';
      },
      async *stream(): AsyncIterable<string> {
        throw new Error('Not implemented');
      },
    };
    const rewriter = new LLMQueryRewriter({ llm: mockLLM, model: 'gpt-4o' });
    await rewriter.rewrite('test query');
    expect(receivedOptions?.model).toBe('gpt-4o');
  });
});
