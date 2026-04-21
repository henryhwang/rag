import * as fs from 'node:fs/promises';
import * as path from 'node:path';


// -- Recursive Markdown File Loader ----------------------------------

/**
 * Recursively scan a directory for all .md files
 * Returns array of absolute paths
 */
async function findMarkdownFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function scan(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }
  }

  await scan(dir);
  return results;
}

const files = await findMarkdownFiles('/home/henry/projects/qwen-code/docs/users')

console.log(files.length)
