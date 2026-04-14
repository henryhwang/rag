import { describe, test, expect, mock, afterEach } from 'bun:test';
import { OpenAICompatibleReranker } from '../src/reranking/openai-compatible.js';

describe('OpenAICompatibleReranker', () => {
  afterEach(() => {
    mock.restore();
  });

  describe('construction', () => {
    test('creates with default config', () => {
      const reranker = new OpenAICompatibleReranker();
      expect(reranker.name).toBe('OpenAICompatibleReranker');
    });

    test('accepts custom config', () => {
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
    test('returns empty array for empty documents', async () => {
      const reranker = new OpenAICompatibleReranker();
      const scores = await reranker.rerank('query', []);
      expect(scores).toEqual([]);
    });

    test('throws on empty query', async () => {
      const reranker = new OpenAICompatibleReranker();
      await expect(reranker.rerank('', ['doc'])).rejects.toThrow('Query cannot be empty');
    });

    test('parses valid score from API response', async () => {
      const mockFetch = mock(async (url: string, opts: { body: string }) => {
        const body = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '75' } }],
          }),
        };
      });
      globalThis.fetch = mockFetch;

      const reranker = new OpenAICompatibleReranker({ apiKey: 'test' });
      const scores = await reranker.rerank('query', ['doc1', 'doc2']);

      expect(scores).toHaveLength(2);
      expect(scores).toEqual([0.75, 0.75]);
    });

    test('normalizes score from 0-100 to 0-1 range', async () => {
      let callIndex = 0;
      const responses = ['0', '50', '100'];
      const mockFetch = mock(async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: responses[callIndex++] } }],
        }),
      }));
      globalThis.fetch = mockFetch;

      const reranker = new OpenAICompatibleReranker({ apiKey: 'test' });
      const scores = await reranker.rerank('query', ['doc1', 'doc2', 'doc3']);

      expect(scores).toEqual([0, 0.5, 1]);
    });

    test('returns 0 on API error', async () => {
      const mockFetch = mock(async () => ({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      }));
      globalThis.fetch = mockFetch;

      const reranker = new OpenAICompatibleReranker({ apiKey: 'test' });
      const scores = await reranker.rerank('query', ['doc1', 'doc2']);

      expect(scores).toHaveLength(2);
      expect(scores).toEqual([0, 0]);
    });

    test('returns 0 on invalid score from LLM', async () => {
      const mockFetch = mock(async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'not a number' } }],
        }),
      }));
      globalThis.fetch = mockFetch;

      const reranker = new OpenAICompatibleReranker({ apiKey: 'test' });
      const scores = await reranker.rerank('query', ['doc1']);

      expect(scores).toEqual([0]);
    });

    test('sends correct request body to API', async () => {
      let capturedBody: string | undefined;
      const mockFetch = mock(async (_url: string, opts: { body: string; headers: Record<string, string> }) => {
        capturedBody = opts.body;
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '50' } }],
          }),
        };
      });
      globalThis.fetch = mockFetch;

      const reranker = new OpenAICompatibleReranker({
        apiKey: 'test-key',
        baseUrl: 'http://localhost:11434',
        model: 'llama3',
      });
      await reranker.rerank('test query', ['doc1']);

      const body = JSON.parse(capturedBody!);
      expect(body.model).toBe('llama3');
      expect(body.messages[0].content).toContain('test query');
      expect(body.temperature).toBe(0);
      expect(body.max_tokens).toBe(10);
    });

    test('sends Authorization header when apiKey is provided', async () => {
      let capturedHeaders: Record<string, string> | undefined;
      const mockFetch = mock(async (_url: string, opts: { headers: Record<string, string> }) => {
        capturedHeaders = opts.headers;
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '50' } }],
          }),
        };
      });
      globalThis.fetch = mockFetch;

      const reranker = new OpenAICompatibleReranker({ apiKey: 'secret-key' });
      await reranker.rerank('query', ['doc']);

      expect(capturedHeaders?.['Authorization']).toBe('Bearer secret-key');
    });

    test('does not send Authorization header when apiKey is empty', async () => {
      let capturedHeaders: Record<string, string> | undefined;
      const mockFetch = mock(async (_url: string, opts: { headers: Record<string, string> }) => {
        capturedHeaders = opts.headers;
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '50' } }],
          }),
        };
      });
      globalThis.fetch = mockFetch;

      const reranker = new OpenAICompatibleReranker();
      await reranker.rerank('query', ['doc']);

      expect(capturedHeaders?.['Authorization']).toBeUndefined();
    });

    test('truncates documents longer than 2000 chars', async () => {
      let capturedBody: string | undefined;
      const mockFetch = mock(async (_url: string, opts: { body: string }) => {
        capturedBody = opts.body;
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '50' } }],
          }),
        };
      });
      globalThis.fetch = mockFetch;

      const reranker = new OpenAICompatibleReranker({ apiKey: 'test' });
      const longDoc = 'x'.repeat(5000);
      await reranker.rerank('query', [longDoc]);

      const body = JSON.parse(capturedBody!);
      const promptText = body.messages[0].content as string;
      // The doc is truncated to 2000 chars + the prompt template overhead
      const docPart = promptText.split('Document: ')[1]?.split('\n\nScore:')[0] ?? '';
      expect(docPart.length).toBeLessThanOrEqual(2000);
    });

    test('processes documents in batches', async () => {
      let callCount = 0;
      const mockFetch = mock(async () => {
        callCount++;
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '50' } }],
          }),
        };
      });
      globalThis.fetch = mockFetch;

      const reranker = new OpenAICompatibleReranker({ apiKey: 'test', batchSize: 2 });
      const docs = ['doc1', 'doc2', 'doc3', 'doc4', 'doc5'];
      await reranker.rerank('query', docs);

      // 5 docs / batchSize 2 = 3 batches
      expect(callCount).toBe(5); // Each doc is one fetch call (parallel within batch)
    });
  });
});
