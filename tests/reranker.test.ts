import { describe, it, expect, mock } from 'bun:test';
import { createMockFetch } from './utils/mock-fetch.ts';
import { OpenAICompatibleReranker } from '../src/reranking/openai-compatible.ts';

describe('OpenAICompatibleReranker', () => {
  describe('construction', () => {
    it('creates with default config', () => {
      const reranker = new OpenAICompatibleReranker({ apiKey: 'test-key' });
      expect(reranker.name).toBe('OpenAICompatibleReranker');
    });

    it('accepts custom config', () => {
      const reranker = new OpenAICompatibleReranker({
        apiKey: 'test-key',
        baseUrl: 'http://localhost:11434',
        model: 'llama3',
        batchSize: 5,
      });
      expect(reranker.name).toBe('OpenAICompatibleReranker');
    });
  });

  describe('rerank', () => {
    it('returns empty array for empty documents', async () => {
      const reranker = new OpenAICompatibleReranker({ apiKey: 'test-key' });
      const scores = await reranker.rerank('query', []);
      expect(scores).toEqual([]);
    });

    it('throws on empty query', async () => {
      const reranker = new OpenAICompatibleReranker({ apiKey: 'test-key' });
      await expect(reranker.rerank('', ['doc'])).rejects.toThrow('Query cannot be empty');
    });

    it('parses valid score from API response', async () => {
      const mockFetch = mock(async (_url: string, opts?: RequestInit) => {
        JSON.parse((opts as RequestInit).body as string);
        return new Response(JSON.stringify({ choices: [{ message: { content: '75' } }] }), { status: 200 });
      });
      const reranker = new OpenAICompatibleReranker({ apiKey: 'test', fetchFn: mockFetch });
      const scores = await reranker.rerank('query', ['doc1', 'doc2']);

      expect(scores).toHaveLength(2);
      expect(scores).toEqual([0.75, 0.75]);
    });

    it('normalizes score from 0-100 to 0-1 range', async () => {
      let callIndex = 0;
      const responses = ['0', '50', '100'];
      const mockFetch = mock(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: responses[callIndex++] } }] }), { status: 200 })
      );
      const reranker = new OpenAICompatibleReranker({ apiKey: 'test', fetchFn: mockFetch });
      const scores = await reranker.rerank('query', ['doc1', 'doc2', 'doc3']);

      expect(scores).toEqual([0, 0.5, 1]);
    });

    it('returns 0 on API error', async () => {
      const mockFetch = createMockFetch(500, { error: 'Internal Server Error' });
      const reranker = new OpenAICompatibleReranker({ apiKey: 'test', fetchFn: mockFetch });
      const scores = await reranker.rerank('query', ['doc1', 'doc2']);

      expect(scores).toHaveLength(2);
      expect(scores).toEqual([0, 0]);
    });

    it('returns 0 on invalid score from LLM', async () => {
      const mockFetch = createMockFetch(200, { choices: [{ message: { content: 'not a number' } }] });
      const reranker = new OpenAICompatibleReranker({ apiKey: 'test', fetchFn: mockFetch });
      const scores = await reranker.rerank('query', ['doc1']);

      expect(scores).toEqual([0]);
    });

    it('sends correct request body to API', async () => {
      let capturedBody: string | undefined;
      const mockFetch = mock(async (_url: string, init?: RequestInit) => {
        capturedBody = (init as RequestInit).body as string;
        return new Response(JSON.stringify({ choices: [{ message: { content: '50' } }] }), { status: 200 });
      });
      const reranker = new OpenAICompatibleReranker({
        apiKey: 'test-key',
        baseUrl: 'http://localhost:11434',
        model: 'llama3',
        fetchFn: mockFetch,
      });
      await reranker.rerank('test query', ['doc1']);

      const body = JSON.parse(capturedBody!);
      expect(body.model).toBe('llama3');
      expect(body.messages[0].content).toContain('test query');
      expect(body.temperature).toBe(0);
      expect(body.max_tokens).toBe(10);
    });

    it('sends Authorization header when apiKey is provided', async () => {
      let capturedHeaders: Record<string, string> | undefined;
      const mockFetch = mock(async (_url: string, init?: RequestInit) => {
        capturedHeaders = (init as RequestInit).headers as Record<string, string>;
        return new Response(JSON.stringify({ choices: [{ message: { content: '50' } }] }), { status: 200 });
      });
      const reranker = new OpenAICompatibleReranker({ apiKey: 'secret-key', fetchFn: mockFetch });
      await reranker.rerank('query', ['doc']);

      expect(capturedHeaders?.['Authorization']).toBe('Bearer secret-key');
    });

    it('does not send Authorization header when apiKey is empty', async () => {
      // This test should now throw an error because API key is required
      const reranker = new OpenAICompatibleReranker({ apiKey: '' });
      await expect(reranker.rerank('query', ['doc'])).rejects.toThrow('API key is required');
    });

    it('truncates documents longer than 2000 chars', async () => {
      let capturedBody: string | undefined;
      const mockFetch = mock(async (_url: string, init?: RequestInit) => {
        capturedBody = (init as RequestInit).body as string;
        return new Response(JSON.stringify({ choices: [{ message: { content: '50' } }] }), { status: 200 });
      });
      const reranker = new OpenAICompatibleReranker({ apiKey: 'test', fetchFn: mockFetch });
      const longDoc = 'x'.repeat(5000);
      await reranker.rerank('query', [longDoc]);

      const body = JSON.parse(capturedBody!);
      const promptText = body.messages[0].content as string;
      // The doc is truncated to 2000 chars + the prompt template overhead
      const docPart = promptText.split('Document: ')[1]?.split('\n\nScore:')[0] ?? '';
      expect(docPart.length).toBeLessThanOrEqual(2000);
    });

    it('processes documents in batches', async () => {
      const mockFetch = createMockFetch(200, { choices: [{ message: { content: '50' } }] });
      const reranker = new OpenAICompatibleReranker({ apiKey: 'test', batchSize: 2, fetchFn: mockFetch });
      const docs = ['doc1', 'doc2', 'doc3', 'doc4', 'doc5'];
      await reranker.rerank('query', docs);

      // 5 docs / batchSize 2 = 3 batches, but each doc is one fetch call (parallel within batch)
      expect(mockFetch).toHaveBeenCalledTimes(5);
    });
  });
});
