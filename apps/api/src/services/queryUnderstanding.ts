import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { QueryIntent, RetrievalMode } from '@web2x/shared';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash-lite';

const VALID_MODES: RetrievalMode[] = [
  'semantic_search',
  'list_then_summarize',
  'hybrid',
  'bm25',
  'vector',
  'rag',
  'csv',
  'knowledge_graph',
];

function fallback(query: string): QueryIntent {
  return { retrieval_mode: 'semantic_search', filters: {}, reformulated_query: query, context_hint: '' };
}

export async function parseQueryIntent(query: string): Promise<QueryIntent> {
  const today = new Date().toISOString().split('T')[0];

  try {
    const model = genAI.getGenerativeModel({ model: MODEL });

    const prompt =
      `Today's date is ${today}. Analyze this user query and classify how to retrieve content for it.\n\n` +
      `retrieval_mode choices:\n` +
      `- "semantic_search": specific conceptual question about content ("what does X say about Y", "explain Z")\n` +
      `- "list_then_summarize": enumerate or summarize articles in a time window ("summarize last week", "what did I read this month")\n` +
      `- "hybrid": topic question fusing keyword + semantic recall ("machine learning embeddings", broad research queries)\n` +
      `- "bm25": exact keyword or code lookup — query contains quoted phrases, identifiers, or rare proper nouns ("\"pgvector\" HNSW", "TypeError: cannot read")\n` +
      `- "vector": paraphrase-heavy semantic question where exact wording is unlikely to match ("articles about neural networks" when corpus says "deep learning")\n` +
      `- "rag": user asks for a generated explanation or synthesis ("explain what I read about X", "summarise the key ideas on Y", "tell me about Z")\n` +
      `- "csv": query targets tabular/spreadsheet data ("rows where status = done", "show high priority tasks", "filter by column")\n` +
      `- "knowledge_graph": entity-centric — mentions people, organisations, or relationships ("articles mentioning OpenAI", "who wrote about X", "related to Sam Altman")\n\n` +
      `For dateFrom/dateTo: resolve relative phrases ("last week", "yesterday") to absolute ISO 8601 dates. ` +
      `Leave them as empty strings if no temporal constraint is present.\n\n` +
      `reformulated_query: strip temporal phrases, keep the semantic core.\n` +
      `context_hint: one sentence for the AI about user intent.\n\n` +
      `Query: "${query}"`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            retrieval_mode: { type: SchemaType.STRING },
            filters: {
              type: SchemaType.OBJECT,
              properties: {
                dateFrom: { type: SchemaType.STRING },
                dateTo:   { type: SchemaType.STRING },
              },
              required: ['dateFrom', 'dateTo'],
            },
            reformulated_query: { type: SchemaType.STRING },
            context_hint:       { type: SchemaType.STRING },
          },
          required: ['retrieval_mode', 'filters', 'reformulated_query', 'context_hint'],
        },
      },
    });

    const raw = JSON.parse(result.response.text()) as {
      retrieval_mode: string;
      filters: { dateFrom: string; dateTo: string };
      reformulated_query: string;
      context_hint: string;
    };

    const mode: RetrievalMode = VALID_MODES.includes(raw.retrieval_mode as RetrievalMode)
      ? (raw.retrieval_mode as RetrievalMode)
      : 'semantic_search';

    return {
      retrieval_mode: mode,
      filters: {
        dateFrom: raw.filters?.dateFrom || undefined,
        dateTo:   raw.filters?.dateTo   || undefined,
      },
      reformulated_query: raw.reformulated_query || query,
      context_hint: raw.context_hint || '',
    };
  } catch (err) {
    console.warn('[QueryUnderstanding] Failed to parse intent, falling back to semantic_search:', err);
    return fallback(query);
  }
}
