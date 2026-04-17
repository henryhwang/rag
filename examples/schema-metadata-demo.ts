// ============================================================
// Schema Metadata Feature Demo
// 
// Shows how schema metadata enables decoupled creation/consumption
// and provides better error messages for dimension mismatches.
// ============================================================

import { RAG, InMemoryVectorStore } from '../src/index.ts';

// Mock embedding provider with configurable dimensions
class ConfigurableEmbeddings {
  readonly encodingFormat = 'float32';
  
  constructor(readonly dimensions: number) {}
  
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => Array.from({ length: this.dimensions }, () => Math.random()));
  }
}

async function demonstrateFeatures() {
  console.log('========================================');
  console.log('SCHEMA METADATA FEATURE DEMONSTRATION');
  console.log('========================================\n');

  // -- Feature 1: Schema is automatically captured ---------------
  
  console.log('1️⃣  Schema is auto-captured on first add:');
  console.log('─'.repeat(50));

  const store1 = new InMemoryVectorStore();
  const rag1 = new RAG({
    embeddings: new ConfigurableEmbeddings(1536),
    vectorStore: store1,
    chunking: { strategy: 'fixed', size: 100, overlap: 10 },
  });

  await rag1.addDocument({
    path: 'test.md',
    content: Buffer.from('# Test\nThis is test content for schema demonstration.'),
  });

  console.log('✓ Added document with 1536D vectors');
  console.log('  Store metadata:', JSON.stringify(store1.metadata, null, 2));
  console.log();

  // -- Feature 2: Persisted stores include schema -----------------
  
  console.log('2️⃣  Stores persist WITH schema metadata:');
  console.log('─'.repeat(50));

  await store1.save('./temp-store-with-schema.json');
  console.log('✓ Saved to temp-store-with-schema.json');
  console.log('  (inspect file: it now has _meta object!)');
  console.log();

  // -- Feature 3: Load and inspect schema before use -------------
  
  console.log('3️⃣  Load store and inspect schema before adding/querying:');
  console.log('─'.repeat(50));

  const store2 = new InMemoryVectorStore();
  await store2.load('./temp-store-with-schema.json');
  
  const loadedMeta = store2.metadata;
  if (loadedMeta) {
    console.log('✓ Loaded store schema:');
    console.log(`  • Dimension: ${loadedMeta.embeddingDimension}`);
    console.log(`  • Model: ${loadedMeta.embeddingModel}`);
    console.log(`  • Version: ${loadedMeta.version}`);
    console.log(`  • Created: ${loadedMeta.createdAt.toLocaleString()}`);
  }
  console.log();

  // -- Feature 4: Validation catches mismatch early --------------
  
  console.log('4️⃣  validateConfiguration() catches mismatches BEFORE query:');
  console.log('─'.repeat(50));

  const rag2 = new RAG({
    embeddings: new ConfigurableEmbeddings(768),  // ❌ WRONG DIMENSION!
    vectorStore: store2,
  });

  const validation = await rag2.validateConfiguration();
  if (!validation.isValid) {
    console.log('❌ Configuration validation FAILED:');
    console.log(validation.error);
  } else {
    console.log('✅ Configuration OK');
  }
  console.log();

  // -- Feature 5: Proper config works perfectly ------------------
  
  console.log('5️⃣  Matching configuration passes validation:');
  console.log('─'.repeat(50));

  const rag3 = new RAG({
    embeddings: new ConfigurableEmbeddings(1536),  // ✅ CORRECT
    vectorStore: store2,
  });

  const validation2 = await rag3.validateConfiguration();
  if (validation2.isValid) {
    console.log('✅ Configuration validated successfully!');
    console.log('   Can safely proceed to query operations');
    
    // Show knowledge base info
    const kbInfo = rag3.getKnowledgeBaseInfo();
    console.log('\n   Knowledge Base Summary:');
    console.log(`   • Documents: ${kbInfo.documentCount}`);
    console.log(`   • Embedding Dim: ${kbInfo.embeddingDimension}D`);
    console.log(`   • Chunk Strategy: ${kbInfo.chunkStrategy}`);
  }
  console.log();

  // -- Feature 6: Add more docs to existing store ---------------
  
  console.log('6️⃣  Add more documents to existing store:');
  console.log('─'.repeat(50));

  await rag3.addDocument({
    path: 'test2.md',
    content: Buffer.from('## Another section\nMore content here for testing.'),
  });
  console.log('✓ Successfully added second document to loaded store');
  console.log('  Metadata updated_at timestamp refreshed');
  console.log();

  // -- Feature 7: Save re-upgrades schema ------------------------
  
  console.log('7️⃣  Re-saving upgrades schema version:');
  console.log('─'.repeat(50));

  await store2.save('./temp-store-upgraded.json');
  console.log('✓ Saved upgraded store to temp-store-upgraded.json');
  console.log('  Contains complete schema + all records');
  console.log();

  // -- Feature 8: Decoupled consumption pattern ------------------
  
  console.log('8️⃣  Decoupled pattern: consumer discovers required model:');
  console.log('─'.repeat(50));

  // Simulate different process/team loading the store
  const consumerStore = new InMemoryVectorStore();
  await consumerStore.load('./temp-store-upgraded.json');
  
  const consumerMeta = consumerStore.metadata;
  if (consumerMeta && consumerMeta.embeddingDimension > 0) {
    console.log('✓ Consumer loaded store WITHOUT knowing original config');
    console.log(`  Auto-discovered requirement: ${consumerMeta.embeddingDimension}D vectors`);
    console.log(`  Recommended model hint: ${consumerMeta.embeddingModel}`);
    
    // Consumer creates matching provider
    const consumerRag = new RAG({
      embeddings: new ConfigurableEmbeddings(consumerMeta.embeddingDimension),
      vectorStore: consumerStore,
    });
    
    const val = await consumerRag.validateConfiguration();
    if (val.isValid) {
      console.log('  ✅ Auto-configured provider matches stored schema!');
    }
  }
  console.log();

  // Cleanup
  try {
    await import('node:fs/promises').then(fs => fs.unlink('./temp-store-with-schema.json'));
    await import('node:fs/promises').then(fs => fs.unlink('./temp-store-upgraded.json'));
  } catch {}

  console.log('========================================');
  console.log('DEMO COMPLETE - All features working! ✓');
  console.log('========================================');
}

demonstrateFeatures().catch(console.error);
