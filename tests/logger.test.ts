import { describe, it, expect } from "bun:test";
import { NoopLogger } from "../src/logger/index.ts";
import type { Logger } from "../src/types/index.ts";

describe("NoopLogger", () => {
  it("should not throw on any log level", () => {
    const logger = new NoopLogger();
    expect(() => logger.debug("debug msg")).not.toThrow();
    expect(() => logger.info("info msg")).not.toThrow();
    expect(() => logger.warn("warn msg")).not.toThrow();
    expect(() => logger.error("error msg")).not.toThrow();
  });

  it("should accept extra arguments", () => {
    const logger = new NoopLogger();
    expect(() => logger.debug("msg", 1, 2, 3)).not.toThrow();
    expect(() => logger.info("msg", { key: "val" })).not.toThrow();
  });
});

describe("Logger interface", () => {
  it("should allow custom implementations", () => {
    const messages: string[] = [];
    const customLogger: Logger = {
      debug: (msg) => messages.push(`debug: ${msg}`),
      info: (msg) => messages.push(`info: ${msg}`),
      warn: (msg) => messages.push(`warn: ${msg}`),
      error: (msg) => messages.push(`error: ${msg}`),
    };

    customLogger.info("hello");
    customLogger.error("oops");
    expect(messages).toEqual(["info: hello", "error: oops"]);
  });
});
