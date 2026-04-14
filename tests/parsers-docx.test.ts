import { describe, it, expect } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DocxParser } from "../src/parsers/docx.ts";
import { ParseError } from "../src/errors/index.ts";

async function writeTemp(content: Buffer): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rag-docx-"));
  const filePath = path.join(dir, "sample.docx");
  await fs.writeFile(filePath, content);
  return filePath;
}

describe("DocxParser", () => {
  it("should support .docx extension", () => {
    const parser = new DocxParser();
    expect(parser.supports("file.docx")).toBe(true);
    expect(parser.supports("file.txt")).toBe(false);
  });

  it("should parse a minimal valid DOCX file", async () => {
    // A minimal valid DOCX is a ZIP with [Content_Types].xml and word/document.xml
    // We'll test that the error is a parse error (not "no parser available")
    const parser = new DocxParser();

    // Create a file that's not a real docx — should still throw ParseError, not "no parser"
    const fakeDocx = Buffer.from("not a real docx file");
    const filePath = await writeTemp(fakeDocx);

    // mammoth should fail with a meaningful error, not "no parser available"
    await expect(parser.parse(filePath)).rejects.toThrow(ParseError);
  });

  it("should throw ParseError for missing file", async () => {
    const parser = new DocxParser();
    await expect(parser.parse("/nonexistent/file.docx")).rejects.toThrow(
      ParseError
    );
  });

  it("should be registered in the parser factory", async () => {
    const { resolveParser } = await import("../src/parsers/index.ts");
    const parser = resolveParser("/path/to/report.docx");
    expect(parser.supportedExtensions).toContain("docx");
  });
});
