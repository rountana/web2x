import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { v4 as uuidv4 } from 'uuid';
import type { FlashCard, QuizQuestion, GradeResponse } from '@web2x/shared';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash-lite';

function getModel() {
  return genAI.getGenerativeModel({ model: MODEL });
}

async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    await new Promise((r) => setTimeout(r, 500));
    return fn();
  }
}

export async function generateDeck(rawText: string, count: number): Promise<FlashCard[]> {
  const model = getModel();
  const result = await callWithRetry(() =>
    model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Generate exactly ${count} flashcard Q&A pairs covering the key concepts from the following article. Return a JSON object with a "cards" array where each item has "front" (the question) and "back" (the answer).\n\nArticle:\n${rawText.slice(0, 30000)}`,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            cards: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  front: { type: SchemaType.STRING },
                  back: { type: SchemaType.STRING },
                },
                required: ['front', 'back'],
              },
            },
          },
          required: ['cards'],
        },
      },
    })
  );

  const text = result.response.text();
  const parsed = JSON.parse(text) as { cards: FlashCard[] };
  return parsed.cards.slice(0, count);
}

export async function generateQuiz(rawText: string, count: number): Promise<QuizQuestion[]> {
  const model = getModel();
  const result = await callWithRetry(() =>
    model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Generate exactly ${count} multiple-choice quiz questions from the following article. Each question must have exactly 4 options (A, B, C, D). Return a JSON object with a "questions" array.\n\nArticle:\n${rawText.slice(0, 30000)}`,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            questions: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  question: { type: SchemaType.STRING },
                  options: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  correctAnswer: { type: SchemaType.STRING },
                  explanation: { type: SchemaType.STRING },
                },
                required: ['question', 'options', 'correctAnswer', 'explanation'],
              },
            },
          },
          required: ['questions'],
        },
      },
    })
  );

  const text = result.response.text();
  const parsed = JSON.parse(text) as {
    questions: Array<{
      question: string;
      options: string[];
      correctAnswer: string;
      explanation: string;
    }>;
  };

  return parsed.questions.slice(0, count).map((q) => ({
    id: uuidv4(),
    type: 'multiple_choice' as const,
    question: q.question,
    options: q.options.slice(0, 4) as [string, string, string, string],
    correctAnswer: q.correctAnswer,
    explanation: q.explanation,
  }));
}

export async function generateSummary(
  rawText: string
): Promise<{ keyPoints: string[]; overview: string }> {
  const model = getModel();
  const result = await callWithRetry(() =>
    model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Write a structured summary of the following article. Return a JSON object with "keyPoints" (array of 3-5 bullet strings) and "overview" (one paragraph of prose).\n\nArticle:\n${rawText.slice(0, 30000)}`,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            keyPoints: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING },
            },
            overview: { type: SchemaType.STRING },
          },
          required: ['keyPoints', 'overview'],
        },
      },
    })
  );

  const text = result.response.text();
  return JSON.parse(text) as { keyPoints: string[]; overview: string };
}

export async function gradeAnswer(
  question: string,
  modelAnswer: string,
  userAnswer: string
): Promise<GradeResponse> {
  const model = getModel();
  const result = await callWithRetry(() =>
    model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Grade this student answer against the model answer.\n\nQuestion: ${question}\nModel answer: ${modelAnswer}\nStudent answer: ${userAnswer}\n\nReturn a JSON object with "correct" (boolean), "score" (number 0-1), and "feedback" (string explaining the grade).`,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            correct: { type: SchemaType.BOOLEAN },
            score: { type: SchemaType.NUMBER },
            feedback: { type: SchemaType.STRING },
          },
          required: ['correct', 'score', 'feedback'],
        },
      },
    })
  );

  const text = result.response.text();
  return JSON.parse(text) as GradeResponse;
}
