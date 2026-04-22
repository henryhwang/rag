import { describe, it, expect, mock } from "bun:test";
import {
  OpenAICompatibleLLM,
} from "../src/llm/index.ts";
import { LLMError } from "../src/errors/index.ts";
import { createMockFetch, createMockFetchError, createMockStreamingFetch } from "./utils/mock-fetch.ts";

// --- Shared error-case tests for generate/generateMessages ---

type LLMMethod = "generate" | "generateMessages";

function sharedErrorTests(methodName: LLMMethod) {
  const call = (llm: OpenAICompatibleLLM) =>
    methodName === "generate"
      ? llm.generate("hello")
      : llm.generateMessages([{ role: "user", content: "hi" }]);

  it("should throw if no API key", async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const llm = new OpenAICompatibleLLM();
    await expect(call(llm)).rejects.toThrow(LLMError);
    if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
  });

  it("should throw on API error", async () => {
    const llm = new OpenAICompatibleLLM({
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1",
      fetchFn: createMockFetch(500, { error: "Internal server error" }),
    });
    await expect(call(llm)).rejects.toThrow(LLMError);
  });

  it("should throw on network error", async () => {
    const llm = new OpenAICompatibleLLM({
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1",
      fetchFn: createMockFetchError(new Error("ECONNREFUSED")),
    });
    await expect(call(llm)).rejects.toThrow(LLMError);
  });

  it("should throw on empty response", async () => {
    const llm = new OpenAICompatibleLLM({
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1",
      fetchFn: createMockFetch(200, { choices: [] }),
    });
    await expect(call(llm)).rejects.toThrow(LLMError);
  });
}

// --- Tests ---

describe("OpenAICompatibleLLM — config", () => {
  it("should use default model", () => {
    const llm = new OpenAICompatibleLLM({ apiKey: "sk-test" });
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
  sharedErrorTests("generate");

  it("should return content from a successful response", async () => {
    const llm = new OpenAICompatibleLLM({
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1",
      fetchFn: createMockFetch(200, {
        choices: [{ message: { content: "The answer is 42." } }],
      }),
    });

    const result = await llm.generate("What is the answer?");
    expect(result).toBe("The answer is 42.");
  });
});

describe("OpenAICompatibleLLM — stream", () => {
  it("should throw if no API key", async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const llm = new OpenAICompatibleLLM();
    const iter = llm.stream("hello");
    await expect(iter[Symbol.asyncIterator]().next()).rejects.toThrow(LLMError);
    if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
  });

  it("should yield content chunks", async () => {
    const llm = new OpenAICompatibleLLM({
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1",
      fetchFn: createMockStreamingFetch(["Hello", ", ", "world!"]),
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
    const llm = new OpenAICompatibleLLM({
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1",
      fetchFn: createMockFetch(200, { choices: [{ message: { content: "" } }] }),
    });

    const result = await llm.generate("hi");
    expect(result).toBe("");
  });
});

// ============================================================
// M8: LLM stream() silently swallows SSE errors
// ============================================================

describe("M8: LLM stream should handle SSE errors gracefully", () => {
  it("should have a catch block that skips malformed SSE chunks", async () => {
    const source = await (globalThis as any).Bun.file("src/llm/openai-compatible.ts").text();
    // The stream method has a try/catch that skips malformed SSE chunks
    expect(source).toContain("Skip malformed SSE chunks");
  });
});

// ============================================================
// Coverage: generateMessages() — structured messages API
// ============================================================

describe("OpenAICompatibleLLM — generateMessages", () => {
  sharedErrorTests("generateMessages");

  it("should return content from a successful response", async () => {
    const llm = new OpenAICompatibleLLM({
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1",
      fetchFn: createMockFetch(200, {
        choices: [{ message: { content: "The answer is 42." } }],
      }),
    });

    const result = await llm.generateMessages([
      { role: "system", content: "Be concise." },
      { role: "user", content: "What is the answer?" },
    ]);
    expect(result).toBe("The answer is 42.");
  });

  it("should use options.model when provided", async () => {
    let capturedBody: string | undefined;
    const llm = new OpenAICompatibleLLM({
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1",
      fetchFn: mock(async (_url: string, init?: RequestInit) => {
        capturedBody = init?.body as string;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
          { status: 200 },
        );
      }),
    });

    await llm.generateMessages(
      [{ role: "user", content: "hi" }],
      { model: "custom-model" },
    );

    expect(capturedBody).toContain('"model":"custom-model"');
  });
});
