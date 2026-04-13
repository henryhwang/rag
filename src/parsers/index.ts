// ============================================================
// Parser factory — selects the right parser by file extension
// ============================================================

import { DocumentParser, FileInput, ParsedDocument } from '../types/index.ts';
import { ParseError } from '../errors/index.ts';
import { BaseDocumentParser } from './base.ts';
import { TextParser } from './text.ts';
import { MarkdownParser } from './markdown.ts';

/** Registry of available parsers. */
const BUILTIN_PARSERS: BaseDocumentParser[] = [
  new TextParser(),
  new MarkdownParser(),
];

/**
 * Resolve a parser for the given file path.
 * Throws `ParseError` if no parser supports the extension.
 */
export function resolveParser(filePath: string, parsers?: BaseDocumentParser[]): DocumentParser {
  const candidates = parsers ?? BUILTIN_PARSERS;
  const parser = candidates.find((p) => p.supports(filePath));
  if (!parser) {
    throw new ParseError(`No parser available for file: ${filePath}`);
  }
  return parser;
}

/** Convenience helper — parse a file in one call. */
export async function parseFile(file: FileInput, parsers?: BaseDocumentParser[]): Promise<ParsedDocument> {
  const pathStr = typeof file === 'string' ? file : ('path' in file ? file.path : '');
  const parser = resolveParser(pathStr, parsers);
  return parser.parse(file);
}

export { TextParser } from './text.ts';
export { MarkdownParser } from './markdown.ts';
export { BaseDocumentParser } from './base.ts';
