import { mock } from 'bun:test';

/**
 * Creates a mock fetch function that returns a Response with the given status and JSON body.
 */
export function createMockFetch(status: number, body: unknown): (url: string, init?: RequestInit) => Promise<Response> {
  return mock(async () =>
    new Response(JSON.stringify(body), { status })
  );
}

/**
 * Creates a mock fetch function that throws the given error (simulates network failure).
 */
export function createMockFetchError(err: Error): (url: string, init?: RequestInit) => Promise<Response> {
  return mock(async () => {
    throw err;
  });
}

/**
 * Creates a mock fetch function that returns an SSE streaming response.
 */
export function createMockStreamingFetch(chunks: string[]): (url: string, init?: RequestInit) => Promise<Response> {
  const sseData = chunks
    .map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}`)
    .join('\n') + '\ndata: [DONE]\n';
  return mock(async () =>
    new Response(new Blob([sseData]), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  );
}
