import type { QueryRewriter } from '../../types/index.ts';
import { QueryError } from '../../errors/index.ts';

// Common English stop words
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'need', 'must',
  'that', 'this', 'these', 'those', 'it', 'its', 'i', 'me', 'my', 'we',
  'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'they', 'them',
  'their', 'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some',
  'such', 'no', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'about', 'above', 'after', 'again', 'also', 'any', 'as', 'because',
  'before', 'between', 'during', 'if', 'into', 'new', 'now', 'once', 'out',
  'over', 'then', 'there', 'through', 'under', 'until', 'up', 'while',
]);

export class SimpleQueryRewriter implements QueryRewriter {
  readonly name = 'SimpleQueryRewriter';

  async rewrite(query: string): Promise<string[]> {
    if (!query.trim()) {
      throw new QueryError('Query cannot be empty');
    }

    const results: string[] = [query];

    // Variant 1: lowercased
    const lowercased = query.toLowerCase().trim();
    results.push(lowercased);

    // Variant 2: stop words removed
    const noStopWords = query
      .split(/\s+/)
      .filter((word) => !STOP_WORDS.has(word.toLowerCase()))
      .join(' ');

    if (noStopWords.trim().length > 0) {
      results.push(noStopWords);
    }

    // Variant 3: add bigrams from the original query
    const bigrams = this.extractBigrams(query);
    if (bigrams.length > 0) {
      results.push(bigrams.join(' '));
    }

    // Deduplicate while preserving order
    return Array.from(new Set(results));
  }

  private extractBigrams(query: string): string[] {
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => !STOP_WORDS.has(word) && word.length > 0);

    const bigrams: string[] = [];
    for (let i = 0; i < words.length - 1; i++) {
      bigrams.push(`${words[i]} ${words[i + 1]}`);
    }
    return bigrams;
  }
}
