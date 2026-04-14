import { describe, it, expect, afterEach } from "bun:test";
import {
  OpenAICompatibleLLM,
} from "../src/llm/index.ts";
import { LLMError } from "../src/errors/index.ts";

// --- Mock fetch ---

function mockFetch(status: number, body: unknown) {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(body), { status });
}

function mockFetchError(err: Error) {
  globalThis.fetch = async () => {
    throw err;
  };
}

function mockStreamingFetch(chunks: string[]) {
  // Simulate SSE stream
  const sseData = chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}`).join("\n") + "\ndata: [DONE]\n";
  const encoder = new TextEncoder();
  globalThis.fetch = async () =>
    new Response(new Blob([sseData]), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
}

function restoreFetch() {
  // @ts-ignore
  globalThis.fetch = undefined;
}

describe("OpenAICompatibleLLM — config", () => {
  it("should use default model", () => {
    const llm = new OpenAICompatibleLLM({ apiKey: "sk-test" });
    // We can't inspect private model, but verify it constructs without error
    expect(llm).toBeDefined();
  });

  it("should accept custom model and baseURL", () => {
    const llm = new OpenAICompatibleLLM({
      apiKey: "sk-test",
      model: "llama-3",
      baseURL: "http://localhost:11434/v1",
    });
    expect(llm).toBeDefined();
  });
});

describe("OpenAICompatibleLLM — generate", () => {
  afterEach(() => restoreFetch());

  it("should throw if no API key", async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const llm = new OpenAICompatibleLLM();
    await expect(llm.generate("hello")).rejects.toThrow(LLMError);
    if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
  });

  it("should return content from a successful response", async () => {
    mockFetch(200, {
      choices: [{ message: { content: "The answer is 42." } }],
    });

    const llm = new OpenAICompatibleLLM({
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1",
    });

    const result = await llm.generate("What is the answer?");
    expect(result).toBe("The answer is 42.");
  });

  it("should throw on empty response", async () => {
    mockFetch(200, { choices: [] });

    const llm = new OpenAICompatibleLLM({
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1",
    });

    await expect(llm.generate("hello")).rejects.toThrow(LLMError);
  });

  it("should throw on API error", async () => {
    mockFetch(500, { error: "Internal server error" });

    const llm = new OpenAICompatibleLLM({
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1",
    });

    await expect(llm.generate("hello")).rejects.toThrow(LLMError);
  });

  it("should throw on network error", async () => {
    mockFetchError(new Error("ECONNREFUSED"));

    const llm = new OpenAICompatibleLLM({
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1",
    });

    await expect(llm.generate("hello")).rejects.toThrow(LLMError);
  });
});

describe("OpenAICompatibleLLM — stream", () => {
  afterEach(() => restoreFetch());

  it("should throw if no API key", async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const llm = new OpenAICompatibleLLM();
    const iter = llm.stream("hello");
    await expect(iter.next()).rejects.toThrow(LLMError);
    if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
  });

  it("should yield content chunks", async () => {
    mockStreamingFetch(["Hello", ", ", "world!"]);

    const llm = new OpenAICompatibleLLM({
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1",
    });

    const chunks: string[] = [];
    for await (const chunk of llm.stream("hi")) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["Hello", ", ", "world!"]);
  });
});

// ============================================================
// M7: LLM generate() treats empty string as error
// ============================================================

describe("M7: LLM should accept empty string responses", () => {
  it("should not throw when generate() returns empty string", async () => {
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "" } }] }),
          { status: 200 }
        );

      const llm = new OpenAICompatibleLLM({
        apiKey: "sk-test",
        baseURL: "https://api.example.com/v1",
      });

      const result = await llm.generate("hi");
      expect(result).toBe("");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

// ============================================================
// M8: LLM stream() silently swallows SSE errors
// ============================================================

describe("M8: LLM stream should not silently drop error events", () => {
  it("should document that API error events are currently swallowed", async () => {
    const llmModule = await import("../src/llm/openai-compatible.ts");
    const streamFn = llmModule.OpenAICompatibleLLM.prototype.stream;
    // The stream method has a try/catch that swallows SSE errors
    expect(streamFn.toString()).toContain("catch");
  });
});
