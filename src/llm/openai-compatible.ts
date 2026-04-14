// ============================================================
// OpenAI-compatible LLM provider
// Works with OpenAI, Ollama, vLLM, LiteLLM, etc.
// ============================================================

import { LLMProvider, LLMOptions } from '../types/index.ts';
import { LLMError } from '../errors/index.ts';

export interface OpenAICompatibleLLMConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export class OpenAICompatibleLLM implements LLMProvider {
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly model: string;

  constructor(config: OpenAICompatibleLLMConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.baseURL = config.baseURL ?? DEFAULT_BASE_URL;
    this.model = config.model ?? DEFAULT_MODEL;
  }

  async generate(prompt: string, options?: LLMOptions): Promise<string> {
    if (!this.apiKey) {
      throw new LLMError(
        'API key is required. Set it via config.apiKey or the OPENAI_API_KEY env var.',
      );
    }

    const url = `${this.baseURL.replace(/\/+$/, '')}/chat/completions`;
    const model = options?.model ?? this.model;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: options?.temperature,
          max_tokens: options?.maxTokens,
          stop: options?.stop,
        }),
      });
    } catch (err) {
      throw new LLMError(`Network error calling LLM API: ${url}`, {
        cause: err as Error,
      });
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new LLMError(`LLM API error ${response.status}: ${body}`);
    }

    const json = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = json.choices[0]?.message?.content;
    if (content == null) {
      throw new LLMError('LLM API returned an empty response');
    }
    return content;
  }

  async *stream(
    prompt: string,
    options?: LLMOptions,
  ): AsyncIterable<string> {
    if (!this.apiKey) {
      throw new LLMError(
        'API key is required. Set it via config.apiKey or the OPENAI_API_KEY env var.',
      );
    }

    const url = `${this.baseURL.replace(/\/+$/, '')}/chat/completions`;
    const model = options?.model ?? this.model;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          stream: true,
          temperature: options?.temperature,
          max_tokens: options?.maxTokens,
          stop: options?.stop,
        }),
      });
    } catch (err) {
      throw new LLMError(`Network error calling LLM API: ${url}`, {
        cause: err as Error,
      });
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new LLMError(`LLM API error ${response.status}: ${body}`);
    }

    if (!response.body) {
      throw new LLMError('LLM API response body is null (streaming not supported)');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const json = JSON.parse(trimmed.slice(6));
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch {
            // Skip malformed SSE chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
