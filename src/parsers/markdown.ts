// ============================================================
// Markdown (.md) parser — reads content and optionally strips
// front-matter.  Structure is preserved as plain text so the
// chunker can split on headings / paragraphs.
// ============================================================

import { FileInput, ParsedDocument } from '../types/index.ts';
import { ParseError } from '../errors/index.ts';
import { BaseDocumentParser } from './base.ts';
import * as path from 'node:path';

export class MarkdownParser extends BaseDocumentParser {
  readonly supportedExtensions = ['md', 'markdown'];

  async parse(file: FileInput): Promise<ParsedDocument> {
    const { filePath, buffer } = await this.resolveInput(file);

    let raw: string;
    try {
      raw = buffer.toString('utf-8');
    } catch (err) {
      throw new ParseError(`Failed to decode markdown: ${filePath}`, { cause: err as Error });
    }

    // Strip YAML front-matter if present (simple --- delimited block)
    const content = stripFrontMatter(raw);

    return {
      content,
      metadata: {
        fileName: path.basename(filePath),
        fileType: 'text/markdown',
      },
    };
  }
}

/** Remove a leading `---\n...\n---` block if present. */
export function stripFrontMatter(text: string): string {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  return match ? match[2] : text;
}
