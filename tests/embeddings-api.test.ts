import { describe, it, expect } from "bun:test";
import { OpenAICompatibleEmbeddings } from "../src/embeddings/index.ts";
import { EmbeddingError } from "../src/errors/index.ts";

describe("embedding api access using fetch", () => {
  const SKIP = !(process.env.OPENAI_API_KEY && process.env.OPENAI_BASE_URL && process.env.OPENAI_MODEL);

  // Note: Skip by default as these tests require live API access and can be slow/unreliable
  it.skip("should call real api and get back embedding with dimension of 2048", async () => {
    const baseURL = process.env.OPENAI_BASE_URL
    const apiKey = process.env.OPENAI_API_KEY
    const model = process.env.OPENAI_MODEL
    const dimensions = 2048
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
    expect(json.data[0].embedding).toHaveLength(2048)
  });
})

describe("embedding api access using OpenaiCompatibleEmbeddings", () => {
  const SKIP = !(process.env.OPENAI_API_KEY && process.env.OPENAI_BASE_URL && process.env.OPENAI_MODEL);

  // Note: Skip by default as these tests require live API access and can be slow/unreliable
  it.skip("get back embedding with dimension of 2048", async () => {
    const texts = ["Hello World", "Test 123", "How are you doing"]

    const emb = new OpenAICompatibleEmbeddings({
      baseURL: process.env.OPENAI_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL,
      dimensions: 2048,
      encodingFormat: "float"
    })

    const result = await emb.embed(texts)

    expect(result).toHaveLength(3)
    expect(result[0]).toHaveLength(2048)
  });
})
