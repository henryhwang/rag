import { describe, it, expect } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  TextParser,
  MarkdownParser,
  resolveParser,
  parseFile,
  getAvailableParsers,
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
// getAvailableParsers - error handling
// ============================================================

describe("getAvailableParsers", () => {
  it("should return parsers without crashing when optional deps missing", () => {
    // Should not crash, should have at least text/markdown parsers
    const parsers = getAvailableParsers();
    expect(Array.isArray(parsers)).toBe(true);
    expect(parsers.length).toBeGreaterThanOrEqual(2);
  });

  it("should include TextParser and MarkdownParser by default", () => {
    const parsers = getAvailableParsers();
    
    const hasText = parsers.some((p) => p.constructor.name === 'TextParser');
    const hasMarkdown = parsers.some((p) => p.constructor.name === 'MarkdownParser');
    
    expect(hasText).toBe(true);
    expect(hasMarkdown).toBe(true);
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

// ============================================================
// BaseDocumentParser.resolveInput edge cases
// ============================================================

describe("BaseDocumentParser.resolveInput", () => {
  it("should use pre-loaded buffer from { path, content } object", async () => {
    const filePath = await writeTemp("txt", "Original file content");
    const customContent = Buffer.from("My custom content");
    
    const parser = new TextParser();
    const result = await parser.parse({ path: filePath, content: customContent });

    // Should use custom content, not read from disk
    expect(result.content).toBe("My custom content");
  });

  it("should handle { path } without content by reading file", async () => {
    const filePath = await writeTemp("txt", "Read from file");
    const parser = new TextParser();
    const result = await parser.parse({ path: filePath });
    expect(result.content).toBe("Read from file");
  });

  it("should throw ParseError when fs.readFile fails", async () => {
    const parser = new TextParser();
    await expect(parser.parse("/nonexistent/path/file.txt")).rejects.toThrow(ParseError);
  });

  it("should include error cause on read failures", async () => {
    const parser = new TextParser();
    try {
      await parser.parse("/nonexistent/path/file.txt");
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect((err as Error & { cause?: Error }).cause).toBeDefined();
    }
  });
});

describe("BaseDocumentParser.supports", () => {
  it(".txt support works correctly with case insensitivity", () => {
    const parser = new TextParser();
    expect(parser.supports("test.txt")).toBe(true);
    expect(parser.supports("TEST.TXT")).toBe(true);
  });
});

// ============================================================
// DocxParser - explicit parse() and supports() coverage
// ============================================================

describe("DocxParser - function coverage", () => {
  async function createDocxParser(): Promise<any> {
    const mod = await import("../src/parsers/docx.ts");
    return new mod.DocxParser();
  }

  it("parse method exists and is callable (will fail without valid docx)", async () => {
    const docxParser = await createDocxParser();
    // Ensure the parse() function itself is covered even though parse will fail
    await expect(docxParser.parse("/missing.docx")).rejects.toThrow(ParseError);
  });

  it("supports method works for .docx", async () => {
    const docxParser = await createDocxParser();
    expect(docxParser.supports("file.docx")).toBe(true);
    expect(docxParser.supports("FILE.DOCX")).toBe(true);
    expect(docxParser.supports("file.txt")).toBe(false);
  });
});

describe("PdfParser - function coverage", () => {
  async function createPdfParser(): Promise<any> {
    const mod = await import("../src/parsers/pdf.ts");
    return new mod.PdfParser();
  }

  it("parse method exists and is callable (will fail without valid pdf)", async () => {
    const pdfParser = await createPdfParser();
    // Ensure the parse() function itself is covered even though parse will fail
    await expect(pdfParser.parse("/missing.pdf")).rejects.toThrow(ParseError);
  });

  it("supports method works for .pdf", async () => {
    const pdfParser = await createPdfParser();
    expect(pdfParser.supports("file.pdf")).toBe(true);
    expect(pdfParser.supports("FILE.PDF")).toBe(true);
    expect(pdfParser.supports("file.txt")).toBe(false);
  });
});

describe("MarkdownParser - explicit parse() and supports() coverage", () => {
  it("parse method exists on MarkdownParser", async () => {
    const filePath = await writeTemp("md", "# Test");
    const parser = new MarkdownParser();
    await expect(parser.parse(filePath)).resolves.toBeDefined();
  });

  it("supports method works for all markdown extensions", () => {
    const parser = new MarkdownParser();
    expect(parser.supports("file.md")).toBe(true);
    expect(parser.supports("file.markdown")).toBe(true);
    expect(parser.supports("FILE.MD")).toBe(true);
  });
});

describe("TextParser - explicit parse() and supports() coverage", () => {
  it("parse method exists on TextParser", async () => {
    const filePath = await writeTemp("txt", "test");
    const parser = new TextParser();
    await expect(parser.parse(filePath)).resolves.toBeDefined();
  });

  it("supports method works for txt extension variations", () => {
    const parser = new TextParser();
    expect(parser.supports("file.txt")).toBe(true);
    expect(parser.supports("FILE.TXT")).toBe(true);
  });
});

// ============================================================
// Strip front-matter helper - function coverage
// ============================================================

describe("stripFrontMatter - function coverage", async () => {
  const { stripFrontMatter } = await import("../src/parsers/index.ts");

  it("removes YAML frontmatter completely", () => {
    const input = `---
title: My Doc
author: Jane
---

# Content`;
    const output = stripFrontMatter(input);
    // Front-matter regex leaves a leading newline after the --- block, then trimsStart is needed
    expect(output.trim()).toBe("# Content");
    expect(output).not.toContain("---");
  });

  it("leaves text without frontmatter unchanged", () => {
    const input = "Just regular text";
    expect(stripFrontMatter(input)).toBe(input);
  });

  it("handles Windows line endings in frontmatter", () => {
    const input = "---\r\ntitle: Test\r\n---\r\nContent here";
    const output = stripFrontMatter(input);
    expect(output).toBe("Content here");
  });

  it("does not match when frontmatter has no content between dashes", () => {
    // The regex requires at least minimal content or a newline between --- blocks
    const input = "---\n---\nSome content";
    const output = stripFrontMatter(input);
    // Empty frontmatter is not stripped by the regex pattern
    expect(output).toBe(input);
  });

  it("strips frontmatter with at least one line of metadata", () => {
    const input = "---\ntitle: Only One Field\n---\nContent after";
    const output = stripFrontMatter(input);
    expect(output).toBe("Content after");
  });
});
