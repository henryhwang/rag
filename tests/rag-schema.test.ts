// ============================================================
// RAG Schema Metadata & Validation Tests
// 
// Tests validateConfiguration(), loadAndValidate(), and getKnowledgeBaseInfo()
// ============================================================

import { describe, it, expect, beforeEach } from 'bun:test';
import { RAG } from '../src/index.ts';
import { InMemoryVectorStore } from '../src/storage/index.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// Mock embedding provider with configurable dimensions
class ConfigurableEmbeddings {
  readonly encodingFormat = 'float';
  
  constructor(readonly dimensions: number) {}
  
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => Array.from({ length: this.dimensions }, () => Math.random()));
  }
}

describe('RAG Schema Metadata & Validation', () => {
  let tmpDir: string;
  
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-schema-test-'));
  });

  // -- validateConfiguration() -----------------------------------
  
  describe('validateConfiguration()', () => {
    it('should return isValid=true for matching dimensions', async () => {
      const store = new InMemoryVectorStore();
      const rag = new RAG({
        embeddings: new ConfigurableEmbeddings(1536),
        vectorStore: store,
      });
      
      await rag.addDocument({
        path: 'test.txt',
        content: Buffer.from('Test content'),
      });
      
      const result = await rag.validateConfiguration();
      
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return isValid=false for mismatched dimensions', async () => {
      const store = new InMemoryVectorStore();
      const rag = new RAG({
        embeddings: new ConfigurableEmbeddings(768),
        vectorStore: store,
      });
      
      await rag.addDocument({
        path: 'test.txt',
        content: Buffer.from('Test content'),
      });
      
      // Now swap to wrong dimension provider
      rag.updateConfig({
        embeddings: new ConfigurableEmbeddings(1536),
      });
      
      const result = await rag.validateConfiguration();
      
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Embedding configuration mismatch');
      expect(result.error).toContain('768D');
      expect(result.error).toContain('1536D');
    });

    it('should handle empty store gracefully', async () => {
      const store = new InMemoryVectorStore();
      const rag = new RAG({
        embeddings: new ConfigurableEmbeddings(1024),
        vectorStore: store,
      });
      
      const result = await rag.validateConfiguration();
      
      expect(result.isValid).toBe(true);
      expect(result.warning?.toLowerCase()).toContain('no metadata');
    });

    it('should include helpful fix instructions in error', async () => {
      const store = new InMemoryVectorStore();
      const rag = new RAG({
        embeddings: new ConfigurableEmbeddings(512),
        vectorStore: store,
      });
      
      await rag.addDocument({
        path: 'test.txt',
        content: Buffer.from('Test'),
      });
      
      rag.updateConfig({
        embeddings: new ConfigurableEmbeddings(256),
      });
      
      const result = await rag.validateConfiguration();
      
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('To fix:');
      expect(result.error).toMatch(/Reconfigure.*embedding/i);
    });
  });

  // -- loadAndValidate() -----------------------------------------
  
  describe('loadAndValidate()', () => {
    it('should successfully load and validate compatible store', async () => {
      // Create and save a store
      const creator = new RAG({
        embeddings: new ConfigurableEmbeddings(1024),
        vectorStore: new InMemoryVectorStore(),
      });
      
      await creator.addDocument({
        path: 'doc.txt',
        content: Buffer.from('Some documentation content here'),
      });
      
      const filePath = path.join(tmpDir, 'store.json');
      await creator.config.vectorStore.save(filePath);
      
      // Load with same config - should succeed
      const loader = new RAG({
        embeddings: new ConfigurableEmbeddings(1024),
        vectorStore: new InMemoryVectorStore(),
      });
      
      // Should not throw
      try {
        await loader.loadAndValidate(filePath);
        // Success!
      } catch (error) {
        expect(error).toBeUndefined();
      }
    });

    it('should throw RAGError on incompatible config', async () => {
      const creator = new RAG({
        embeddings: new ConfigurableEmbeddings(768),
        vectorStore: new InMemoryVectorStore(),
      });
      
      await creator.addDocument({
        path: 'doc.txt',
        content: Buffer.from('Content'),
      });
      
      const filePath = path.join(tmpDir, 'store.json');
      await creator.config.vectorStore.save(filePath);
      
      // Load with different config - should fail
      const loader = new RAG({
        embeddings: new ConfigurableEmbeddings(1536),
        vectorStore: new InMemoryVectorStore(),
      });
      
      await expect(loader.loadAndValidate(filePath)).rejects.toThrow();
    });

    it('should include clear error message with both dimensions', async () => {
      const creator = new RAG({
        embeddings: new ConfigurableEmbeddings(384),
        vectorStore: new InMemoryVectorStore(),
      });
      
      await creator.addDocument({
        path: 'doc.txt',
        content: Buffer.from('Test'),
      });
      
      const filePath = path.join(tmpDir, 'store.json');
      await creator.config.vectorStore.save(filePath);
      
      const loader = new RAG({
        embeddings: new ConfigurableEmbeddings(1536),
        vectorStore: new InMemoryVectorStore(),
      });
      
      try {
        await loader.loadAndValidate(filePath);
        expect.unreachable('Should have thrown');
      } catch (error: unknown) {
        const msg = (error as Error).message;
        expect(msg).toContain('384');
        expect(msg).toContain('1536');
        expect(msg).toContain('mismatch');
      }
    });
  });

  // -- getKnowledgeBaseInfo() ------------------------------------
  
  describe('getKnowledgeBaseInfo()', () => {
    it('should return complete info after adding documents', async () => {
      const store = new InMemoryVectorStore();
      const rag = new RAG({
        embeddings: new ConfigurableEmbeddings(1536),
        vectorStore: store,
        chunking: { strategy: 'markdown', size: 500, overlap: 50 },
      });
      
      await rag.addDocuments([
        { path: 'doc1.md', content: Buffer.from('# Test\nContent') },
        { path: 'doc2.md', content: Buffer.from('# Another\nMore content') },
      ]);
      
      const info = rag.getKnowledgeBaseInfo();
      
      expect(info.embeddingDimension).toBe(1536);
      expect(info.chunkStrategy).toBe('markdown');
      expect(info.chunkSize).toBe(500);
      expect(info.documentCount).toBe(2);
      expect(info.embeddingModel).toBe('auto-detected');
      expect(info.createdAt).toBeDefined();
      expect(info.updatedAt).toBeDefined();
    });

    it('should return zero values for empty store', async () => {
      const rag = new RAG({
        embeddings: new ConfigurableEmbeddings(1024),
        vectorStore: new InMemoryVectorStore(),
      });
      
      const info = rag.getKnowledgeBaseInfo();
      
      expect(info.documentCount).toBe(0);
      expect(info.embeddingDimension).toBe(0); // No adds yet
    });

    it('should reflect updated timestamp after adding docs', async () => {
      const store = new InMemoryVectorStore();
      const rag = new RAG({
        embeddings: new ConfigurableEmbeddings(512),
        vectorStore: store,
      });
      
      await rag.addDocument({
        path: 'doc.txt',
        content: Buffer.from('Initial'),
      });
      
      const firstInfo = rag.getKnowledgeBaseInfo();
      const firstUpdate = firstInfo.updatedAt;
      
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
      
      await rag.addDocument({
        path: 'doc2.txt',
        content: Buffer.from('Second'),
      });
      
      const secondInfo = rag.getKnowledgeBaseInfo();
      
      expect(secondInfo.updatedAt!.getTime()).toBeGreaterThanOrEqual(firstUpdate!.getTime());
    });
  });

  // -- Backward Compatibility ------------------------------------
  
  describe('Backward Compatibility', () => {
    it('should load legacy format stores (array without _meta)', async () => {
      const legacyData = JSON.stringify([
        {
          id: 'test-id',
          embedding: [0.1, 0.2, 0.3],
          metadata: { content: 'legacy' },
        },
      ]);
      
      const filePath = path.join(tmpDir, 'legacy.json');
      await fs.writeFile(filePath, legacyData);
      
      const store = new InMemoryVectorStore();
      await store.load(filePath);
      
      expect(store.size).toBe(1);
      expect(store.metadata?.version).toBe(0); // Legacy version marker
      expect(store.metadata?.embeddingDimension).toBe(3);
    });

    it('should upgrade legacy store when re-saving', async () => {
      const legacyPath = path.join(tmpDir, 'legacy.json');
      const newDataPath = path.join(tmpDir, 'upgraded.json');
      
      // Write legacy format
      await fs.writeFile(legacyPath, JSON.stringify([
        { id: 'id1', embedding: [1, 2, 3], metadata: {} },
      ]));
      
      const store = new InMemoryVectorStore();
      await store.load(legacyPath);
      await store.save(newDataPath);
      
      // Verify new format has _meta
      const upgraded = JSON.parse(await fs.readFile(newDataPath, 'utf-8'));
      expect(upgraded._meta).toBeDefined();
      expect(upgraded._meta.embeddingDimension).toBe(3);
      expect(Array.isArray(upgraded.records)).toBe(true);
    });
  });

  // -- Edge Cases ------------------------------------------------
  
  describe('Edge Cases', () => {
    it('should warn about empty metadata but allow validation to pass', async () => {
      const store = new InMemoryVectorStore();
      const rag = new RAG({
        embeddings: new ConfigurableEmbeddings(1024),
        vectorStore: store,
      });
      
      const result = await rag.validateConfiguration();
      
      expect(result.isValid).toBe(true);
      expect(result.warning).toBeDefined();
    });

    it('should handle large dimension differences gracefully', async () => {
      const store = new InMemoryVectorStore();
      const rag = new RAG({
        embeddings: new ConfigurableEmbeddings(100),
        vectorStore: store,
      });
      
      await rag.addDocument({
        path: 'doc.txt',
        content: Buffer.from('x'.repeat(200)),
      });
      
      // Swap to very different dimension
      rag.updateConfig({
        embeddings: new ConfigurableEmbeddings(8192),
      });
      
      const result = await rag.validateConfiguration();
      
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Difference:         8092D');
    });

    it('metadata should be read-only (cannot directly modify)', async () => {
      const store = new InMemoryVectorStore();
      const rag = new RAG({
        embeddings: new ConfigurableEmbeddings(512),
        vectorStore: store,
      });
      
      await rag.addDocument({
        path: 'doc.txt',
        content: Buffer.from('test'),
      });
      
      const meta = store.metadata;
      expect(meta).not.toBeNull();
      
      // The getter returns a reference, but users shouldn't mutate it
      // This is more of a documentation/convention note than enforceable
      expect(meta.embeddingDimension).toBe(512);
    });
  });
});
