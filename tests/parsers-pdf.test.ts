import { describe, it, expect } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PdfParser } from "../src/parsers/pdf.ts";
import { ParseError } from "../src/errors/index.ts";

async function writeTemp(content: Buffer): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rag-pdf-"));
  const filePath = path.join(dir, "sample.pdf");
  await fs.writeFile(filePath, content);
  return filePath;
}

describe("PdfParser", () => {
  it("should support .pdf extension", () => {
    const parser = new PdfParser();
    expect(parser.supports("file.pdf")).toBe(true);
    expect(parser.supports("file.txt")).toBe(false);
  });

  it("should throw ParseError for invalid PDF content", async () => {
    const parser = new PdfParser();
    const fakePdf = Buffer.from("%PDF-1.0\nnot a real pdf");
    const filePath = await writeTemp(fakePdf);

    await expect(parser.parse(filePath)).rejects.toThrow(ParseError);
  });

  it("should throw ParseError for missing file", async () => {
    const parser = new PdfParser();
    await expect(parser.parse("/nonexistent/file.pdf")).rejects.toThrow(
      ParseError
    );
  });

  it("should be registered in the parser factory", async () => {
    const { resolveParser } = await import("../src/parsers/index.ts");
    const parser = resolveParser("/path/to/report.pdf");
    expect(parser.supportedExtensions).toContain("pdf");
  });
});
