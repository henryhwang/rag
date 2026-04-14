// ============================================================
// PDF (.pdf) parser — uses pdf-parse (v2) to extract text from pages
// Loaded lazily so the core library stays lightweight.
// ============================================================

import { FileInput, ParsedDocument } from '../types/index.ts';
import { ParseError } from '../errors/index.ts';
import { BaseDocumentParser } from './base.ts';
import * as path from 'node:path';

export class PdfParser extends BaseDocumentParser {
  readonly supportedExtensions = ['pdf'];

  async parse(file: FileInput): Promise<ParsedDocument> {
    const { filePath, buffer } = await this.resolveInput(file);

    let pdfParseModule: typeof import('pdf-parse');
    try {
      pdfParseModule = await import('pdf-parse');
    } catch {
      throw new ParseError(
        'pdf-parse is required for .pdf parsing. Install it with: bun add pdf-parse',
      );
    }

    const { PDFParse } = pdfParseModule;
    const parser = new PDFParse({ data: new Uint8Array(buffer) });

    try {
      const result = await parser.getText();
      const pageCount = result.pages?.length ?? 0;

      return {
        content: result.text ?? '',
        metadata: {
          fileName: path.basename(filePath),
          fileType: 'application/pdf',
          pages: pageCount,
        },
      };
    } catch (err) {
      throw new ParseError(`Failed to parse PDF: ${filePath}`, {
        cause: err as Error,
      });
    } finally {
      await parser.destroy();
    }
  }
}
