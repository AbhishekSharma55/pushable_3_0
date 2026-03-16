import { logger } from "./logger.ts";

// Route through OpenRouter which proxies OpenAI embedding models
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/embeddings";
const MODEL = "openai/text-embedding-3-small";
const BATCH_SIZE = 20;

export async function generateEmbeddings(
    texts: string[]
): Promise<number[][]> {
    const apiKey = process.env.OPENROUTER_KEY;
    if (!apiKey) {
        throw new Error("OPENROUTER_KEY is not set");
    }

    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);

        logger.info(
            { batchIndex: i / BATCH_SIZE, batchSize: batch.length, totalTexts: texts.length },
            "Generating embeddings batch"
        );

        const response = await fetch(OPENROUTER_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
                "HTTP-Referer": "https://pushable.ai",
                "X-Title": "Pushable AI",
            },
            body: JSON.stringify({
                model: MODEL,
                input: batch,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error(
                { status: response.status, error: errorText, model: MODEL },
                "OpenRouter embedding API error"
            );
            throw new Error(
                `Embedding API error: ${response.status} ${errorText}`
            );
        }

        const data = (await response.json()) as {
            data: { embedding: number[]; index: number }[];
        };

        // Sort by index to maintain order
        const sorted = data.data.sort((a, b) => a.index - b.index);
        for (const item of sorted) {
            allEmbeddings.push(item.embedding);
        }
    }

    logger.info(
        { totalEmbeddings: allEmbeddings.length, dimensions: allEmbeddings[0]?.length },
        "Embeddings generated successfully"
    );

    return allEmbeddings;
}

export async function generateEmbedding(text: string): Promise<number[]> {
    const results = await generateEmbeddings([text]);
    return results[0];
}
