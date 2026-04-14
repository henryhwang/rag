import { describe, it, expect } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  TextParser,
  MarkdownParser,
  resolveParser,
  parseFile,
} from "../src/parsers/index.ts";
import { ParseError } from "../src/errors/index.ts";

// -- Helpers to create temp files --

async function writeTemp(ext: string, content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rag-test-"));
  const filePath = path.join(dir, `sample.${ext}`);
  await fs.writeFile(filePath, content, "utf-8");
  return filePath;
}

// ============================================================
// TextParser
// ============================================================

describe("TextParser", () => {
  it("should parse a .txt file from a string path", async () => {
    const filePath = await writeTemp("txt", "Hello, world!");
    const parser = new TextParser();
    const result = await parser.parse(filePath);

    expect(result.content).toBe("Hello, world!");
    expect(result.metadata.fileName).toBe("sample.txt");
    expect(result.metadata.fileType).toBe("text/plain");
  });

  it("should parse a .txt file from { path } object", async () => {
    const filePath = await writeTemp("txt", "Content from object");
    const parser = new TextParser();
    const result = await parser.parse({ path: filePath });

    expect(result.content).toBe("Content from object");
  });

  it("should support .txt extension", () => {
    const parser = new TextParser();
    expect(parser.supports("file.txt")).toBe(true);
    expect(parser.supports("file.md")).toBe(false);
    expect(parser.supports("file.pdf")).toBe(false);
  });

  it("should throw ParseError for missing file", async () => {
    const parser = new TextParser();
    await expect(parser.parse("/nonexistent/file.txt")).rejects.toThrow(
      ParseError
    );
  });
});

// ============================================================
// MarkdownParser
// ============================================================

describe("MarkdownParser", () => {
  it("should parse a .md file", async () => {
    const filePath = await writeTemp("md", "# Title\n\nSome markdown content.");
    const parser = new MarkdownParser();
    const result = await parser.parse(filePath);

    expect(result.content).toBe("# Title\n\nSome markdown content.");
    expect(result.metadata.fileName).toBe("sample.md");
    expect(result.metadata.fileType).toBe("text/markdown");
  });

  it("should parse a .markdown file", async () => {
    const filePath = await writeTemp("markdown", "## Header");
    const parser = new MarkdownParser();
    const result = await parser.parse(filePath);

    expect(result.content).toBe("## Header");
  });

  it("should strip YAML front-matter", async () => {
    const content = `---
title: My Doc
author: Jane
---

# Actual Content
Body text here.`;
    const filePath = await writeTemp("md", content);
    const parser = new MarkdownParser();
    const result = await parser.parse(filePath);

    // Front-matter regex leaves a leading newline after the `---` block
    expect(result.content.trimStart()).toBe("# Actual Content\nBody text here.");
    expect(result.metadata.fileName).toBe("sample.md");
  });

  it("should leave content unchanged if no front-matter", async () => {
    const raw = "No front matter here.";
    const filePath = await writeTemp("md", raw);
    const parser = new MarkdownParser();
    const result = await parser.parse(filePath);

    expect(result.content).toBe(raw);
  });

  it("should support .md and .markdown extensions", () => {
    const parser = new MarkdownParser();
    expect(parser.supports("file.md")).toBe(true);
    expect(parser.supports("file.markdown")).toBe(true);
    expect(parser.supports("file.txt")).toBe(false);
  });
});

// ============================================================
// Parser factory
// ============================================================

describe("resolveParser", () => {
  it("should return TextParser for .txt files", () => {
    const parser = resolveParser("/path/to/file.txt");
    expect(parser).toBeInstanceOf(TextParser);
  });

  it("should return MarkdownParser for .md files", () => {
    const parser = resolveParser("/path/to/file.md");
    expect(parser).toBeInstanceOf(MarkdownParser);
  });

  it("should return MarkdownParser for .markdown files", () => {
    const parser = resolveParser("/path/to/file.markdown");
    expect(parser).toBeInstanceOf(MarkdownParser);
  });

  it("should throw ParseError for unsupported extensions", () => {
    expect(() => resolveParser("/path/to/file.xyz")).toThrow(ParseError);
    expect(() => resolveParser("/path/to/file.doc")).toThrow(ParseError);
  });
});

describe("parseFile", () => {
  it("should resolve parser and parse in one call", async () => {
    const filePath = await writeTemp("txt", "parseFile test");
    const result = await parseFile(filePath);

    expect(result.content).toBe("parseFile test");
    expect(result.metadata.fileType).toBe("text/plain");
  });

  it("should throw for unsupported extensions", async () => {
    await expect(parseFile("/path/to/file.xyz")).rejects.toThrow(ParseError);
  });
});

// ============================================================
// H4: FileInput Buffer gives confusing error
// ============================================================

describe("H4: parseFile with bare Buffer should give clear error", () => {
  it("should not say 'No parser available' for bare Buffer input", async () => {
    await expect(parseFile(Buffer.from("hello"))).rejects.toThrow(ParseError);

    try {
      await parseFile(Buffer.from("hello"));
    } catch (err: unknown) {
      const msg = (err as Error).message.toLowerCase();
      expect(msg).not.toContain("no parser available");
    }
  });
});
