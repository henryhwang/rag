import { describe, it, expect } from "bun:test";
import {
  RAGError,
  ParseError,
  ChunkingError,
  EmbeddingError,
  VectorStoreError,
  LLMError,
  QueryError,
} from "../src/errors/index.ts";

describe("RAGError", () => {
  it("should create an error with a message", () => {
    const err = new RAGError("something went wrong");
    expect(err.message).toBe("something went wrong");
    expect(err.name).toBe("RAGError");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RAGError);
  });

  it("should support a cause error", () => {
    const cause = new Error("root cause");
    const err = new RAGError("wrapper", { cause });
    expect(err.cause).toBe(cause);
  });

  it("should work without a cause", () => {
    const err = new RAGError("no cause");
    expect(err.cause).toBeUndefined();
  });
});

describe("ParseError", () => {
  it("should inherit from RAGError", () => {
    const err = new ParseError("bad format");
    expect(err).toBeInstanceOf(RAGError);
    expect(err.name).toBe("ParseError");
  });

  it("should support a cause", () => {
    const cause = new Error("underlying");
    const err = new ParseError("parse failed", { cause });
    expect(err.cause).toBe(cause);
  });
});

describe("ChunkingError", () => {
  it("should inherit from RAGError", () => {
    const err = new ChunkingError("bad chunk");
    expect(err).toBeInstanceOf(RAGError);
    expect(err.name).toBe("ChunkingError");
  });
});

describe("EmbeddingError", () => {
  it("should inherit from RAGError", () => {
    const err = new EmbeddingError("embed failed");
    expect(err).toBeInstanceOf(RAGError);
    expect(err.name).toBe("EmbeddingError");
  });
});

describe("VectorStoreError", () => {
  it("should inherit from RAGError", () => {
    const err = new VectorStoreError("store failed");
    expect(err).toBeInstanceOf(RAGError);
    expect(err.name).toBe("VectorStoreError");
  });
});

describe("LLMError", () => {
  it("should inherit from RAGError", () => {
    const err = new LLMError("llm failed");
    expect(err).toBeInstanceOf(RAGError);
    expect(err.name).toBe("LLMError");
  });
});

describe("QueryError", () => {
  it("should inherit from RAGError", () => {
    const err = new QueryError("query failed");
    expect(err).toBeInstanceOf(RAGError);
    expect(err.name).toBe("QueryError");
  });
});
