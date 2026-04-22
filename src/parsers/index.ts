// ============================================================
// Parser factory — selects the right parser by file extension
// ============================================================

import type { DocumentParser, FileInput, ParsedDocument } from '../types/index.ts';
import { ParseError } from '../errors/index.ts';
import { BaseDocumentParser } from './base.ts';
import { TextParser } from './text.ts';
import { MarkdownParser } from './markdown.ts';

/** Registry of available parsers. */
const BUILTIN_PARSERS: BaseDocumentParser[] = [
  new TextParser(),
  new MarkdownParser(),
];

/** Lazily-loaded optional parsers. */
let docxParser: import('./docx.ts').DocxParser | undefined;
let pdfParser: import('./pdf.ts').PdfParser | undefined;

/**
 * Get all available parsers including optional ones.
 * Optional parsers are loaded lazily so missing peer deps
 * don't break core functionality.
 * Exported for testing.
 */
export function getAvailableParsers(): BaseDocumentParser[] {
  const parsers = [...BUILTIN_PARSERS];

  try {
    if (!docxParser) {
      // Dynamic import so the module isn't eagerly loaded
      const { DocxParser } = require('./docx.ts');
      docxParser = new DocxParser();
    }
    parsers.push(docxParser!);
  } catch (err: any) {
    // Only silently skip if the module is not installed
    // Re-throw all other errors (syntax errors, missing exports, etc.)
    if (err?.code !== 'MODULE_NOT_FOUND') throw err;
    // mammoth not installed — skip silently
  }

  try {
    if (!pdfParser) {
      const { PdfParser } = require('./pdf.ts');
      pdfParser = new PdfParser();
    }
    parsers.push(pdfParser!);
  } catch (err: any) {
    // Only silently skip if the module is not installed
    // Re-throw all other errors (syntax errors, missing exports, etc.)
    if (err?.code !== 'MODULE_NOT_FOUND') throw err;
    // pdf-parse not installed — skip silently
  }

  return parsers;
}

/**
 * Resolve a parser for the given file path.
 * Throws `ParseError` if no parser supports the extension.
 */
export function resolveParser(filePath: string, parsers?: BaseDocumentParser[]): DocumentParser {
  const candidates = parsers ?? getAvailableParsers();
  const parser = candidates.find((p) => p.supports(filePath));
  if (!parser) {
    throw new ParseError(`No parser available for file: ${filePath}`);
  }
  return parser;
}

/** Convenience helper — parse a file in one call. */
export async function parseFile(file: FileInput, parsers?: BaseDocumentParser[]): Promise<ParsedDocument> {
  if (Buffer.isBuffer(file)) {
    const { ParseError } = await import('../errors/index.ts');
    throw new ParseError(
      'Buffer input requires a path override. Use { path, content } instead.',
    );
  }
  const pathStr = typeof file === 'string' ? file : ('path' in file ? file.path : '');
  const parser = resolveParser(pathStr, parsers);
  return parser.parse(file);
}

export { TextParser } from './text.ts';
export { MarkdownParser, stripFrontMatter } from './markdown.ts';
export { BaseDocumentParser } from './base.ts';
export { DocxParser } from './docx.ts';
export { PdfParser } from './pdf.ts';
