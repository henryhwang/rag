import { describe, it, expect } from "bun:test";
import { OpenAICompatibleEmbeddings } from "../src/embeddings/index.ts";
import { EmbeddingError } from "../src/errors/index.ts";

describe("embedding with BAAI/bge-m3 from siliconflow", () => {
  const SKIP = !(process.env.EMBEDDING_API_KEY);

  // Note: Skip by default as these tests require live API access and can be slow/unreliable
  it.skipIf(SKIP)("should work with embedding endpoint", async () => {
    const baseURL = "https://api.siliconflow.cn/v1"
    const apiKey = process.env.EMBEDDING_API_KEY
    const model = "BAAI/bge-m3"
    const dimensions = 1024
    const encodingFormat = "float"
    const texts = ["Hello World", "Test 123", "How are you doing"]


    const body = {
      model: model,
      dimensions: dimensions,
      encoding_format: encodingFormat,
      input: texts
    }
    const url = baseURL + "/embeddings"

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new EmbeddingError(`Network error calling embeddings API: ${url}`, {
        cause: err as Error,
      });
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new EmbeddingError(
        `Embeddings API error ${response.status}: ${bodyText}`,
      );
    }

    const json = (await response.json()) as { data: Array<{ embedding: number[] }> };

    expect(json.data).toHaveLength(3)
    expect(json.data[0].embedding).toHaveLength(1024)
  });
})

describe("embedding api access using OpenaiCompatibleEmbeddings", () => {
  const SKIP = !(process.env.EMBEDDING_API_KEY);

  it.skipIf(SKIP)("should return always dimension 1024 with model bge-3m from siliconflow", async () => {
    const texts = ["Hello World", "Test 123", "How are you doing"]

    const emb = new OpenAICompatibleEmbeddings({
      baseURL: "https://api.siliconflow.cn/v1",
      apiKey: process.env.EMBEDDING_API_KEY,
      model: "BAAI/bge-m3",
      dimensions: 768,
      encodingFormat: "float"
    })

    const result = await emb.embed(texts)

    expect(result).toHaveLength(3)
    expect(result[0]).toHaveLength(1024)
  });
})
