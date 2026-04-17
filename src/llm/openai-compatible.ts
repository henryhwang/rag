// ============================================================
// OpenAI-compatible LLM provider
// Works with OpenAI, Ollama, vLLM, LiteLLM, etc.
// With retry, timeout support and enhanced error messages
// ============================================================

import { LLMProvider, LLMOptions } from '../types/index.ts';
import { LLMError } from '../errors/index.ts';
import { retryAsync } from '../utils/retry.ts';

export interface OpenAICompatibleLLMConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  timeout?: number;         // Request timeout in ms (default: 30000)
  maxRetries?: number;      // Max retry attempts (default: 3)
}

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_RETRIES = 3;

export class OpenAICompatibleLLM implements LLMProvider {
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly model: string;
  private readonly timeout: number;
  private readonly maxRetries: number;

  constructor(config: OpenAICompatibleLLMConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.baseURL = config.baseURL ?? DEFAULT_BASE_URL;
    this.model = config.model ?? DEFAULT_MODEL;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  async generate(prompt: string, options?: LLMOptions): Promise<string> {
    if (!this.apiKey) {
      throw new LLMError(
        `API key is required for LLM generation.\n` +
        `Set via config.apiKey or OPENAI_API_KEY environment variable.\n` +
        `Endpoint: ${this.baseURL}\n` +
        `Model: ${this.model}`,
        { metadata: { model: this.model, endpoint: this.baseURL } }
      );
    }

    const url = `${this.baseURL.replace(/\/+$/, '')}/chat/completions`;
    const model = options?.model ?? this.model;
    const requestBody = {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
      stop: options?.stop,
    };

    let response: Response;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const result = await retryAsync(
          () => fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          }),
          { maxRetries: this.maxRetries }
        );
        clearTimeout(timeoutId);
        response = result;
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }
    } catch (err) {
      throw new LLMError(
        `Network error calling LLM API after ${this.maxRetries} attempt(s).\n` +
        `Endpoint: ${url}\n` +
        `Troubleshooting:\n` +
        `  1. Check network connectivity to ${this.baseURL}\n` +
        `  2. Verify firewall/proxy settings\n` +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
        {
          cause: err as Error,
          metadata: { endpoint: url, model, timeout: this.timeout },
        }
      );
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      const retryAfter = response.headers.get('Retry-After');
      
      let troubleshooting = [
        'Check API key validity',
        `Verify quota/credits for model: ${model}`,
      ];
      
      if (response.status === 429) {
        troubleshooting.unshift(`Rate limit exceeded${retryAfter ? `. Retry after: ${retryAfter}s` : ''}`);
      } else if (response.status >= 500) {
        troubleshooting.push('This may be a temporary server issue - try again later');
      } else if (response.status === 401 || response.status === 403) {
        troubleshooting.unshift('Authentication failed - verify API key is correct');
      }
      
      throw new LLMError(
        `LLM API returned HTTP ${response.status}${bodyText ? ': ' + bodyText.substring(0, 150) : ''}.\n` +
        `Endpoint: ${url}\n` +
        `Troubleshooting:\n` +
        troubleshooting.map(t => `  ${t}`).join('\n'),
        {
          metadata: {
            endpoint: url,
            status: response.status,
            model,
            ...(retryAfter && { retryAfter: Number(retryAfter) }),
          },
        }
      );
    }

    const json = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = json.choices[0]?.message?.content;
    if (content == null) {
      throw new LLMError('LLM API returned an empty response', {
        metadata: { endpoint: url, model },
      });
    }
    return content;
  }

  async generateMessages(
    messages: { role: string; content: string }[],
    options?: LLMOptions,
  ): Promise<string> {
    if (!this.apiKey) {
      throw new LLMError(
        `API key is required for LLM generation.\n` +
        `Set via config.apiKey or OPENAI_API_KEY environment variable.\n` +
        `Endpoint: ${this.baseURL}\n` +
        `Model: ${this.model}`,
        { metadata: { model: this.model, endpoint: this.baseURL } }
      );
    }

    const url = `${this.baseURL.replace(/\/+$/, '')}/chat/completions`;
    const model = options?.model ?? this.model;

    let response: Response;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const result = await retryAsync(
          () => fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({ model, messages }),
            signal: controller.signal,
          }),
          { maxRetries: this.maxRetries }
        );
        clearTimeout(timeoutId);
        response = result;
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }
    } catch (err) {
      throw new LLMError(
        `Network error calling LLM API after ${this.maxRetries} attempt(s).\n` +
        `Endpoint: ${url}\n` +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
        {
          cause: err as Error,
          metadata: { endpoint: url, model, timeout: this.timeout },
        }
      );
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new LLMError(`LLM API returned HTTP ${response.status}: ${bodyText.substring(0, 150)}`,
        { metadata: { endpoint: url, status: response.status, model } }
      );
    }

    const json = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = json.choices[0]?.message?.content;
    if (content == null) {
      throw new LLMError('LLM API returned an empty response', {
        metadata: { endpoint: url, model },
      });
    }
    return content;
  }

  async *stream(
    prompt: string,
    options?: LLMOptions,
  ): AsyncIterable<string> {
    if (!this.apiKey) {
      throw new LLMError(
        `API key is required for LLM streaming.\n` +
        `Set via config.apiKey or OPENAI_API_KEY environment variable.`,
        { metadata: { model: this.model, endpoint: this.baseURL } }
      );
    }

    const url = `${this.baseURL.replace(/\/+$/, '')}/chat/completions`;
    const model = options?.model ?? this.model;

    let response: Response;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const result = await retryAsync(
          () => fetch(url, {
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
            signal: controller.signal,
          }),
          { maxRetries: this.maxRetries }
        );
        clearTimeout(timeoutId);
        response = result;
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }
    } catch (err) {
      throw new LLMError(
        `Network error calling LLM API (streaming) after ${this.maxRetries} attempt(s).\n` +
        `Endpoint: ${url}\n` +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
        {
          cause: err as Error,
          metadata: { endpoint: url, model, timeout: this.timeout },
        }
      );
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new LLMError(`LLM API returned HTTP ${response.status}: ${bodyText.substring(0, 150)}`,
        { metadata: { endpoint: url, status: response.status, model } }
      );
    }

    if (!response.body) {
      throw new LLMError('LLM API response body is null (streaming not supported)', {
        metadata: { endpoint: url, model },
      });
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
            // Skip malformed SSE chunks (e.g., error events, keep-alives)
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
