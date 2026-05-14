import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { articles, quizzes } from '../db/schema.js';
import { NotFoundError, ValidationError } from '../middleware/error.js';
import { generateQuiz, gradeAnswer } from '../services/llm.js';
import type { GradeResponse } from '@web2x/shared';
import type { WorkspaceEnv } from '../middleware/workspace.js';

const createSchema = z.object({ count: z.number().int().min(3).max(15).default(8) });
const gradeSchema = z.object({ questionId: z.string(), userAnswer: z.string().min(1) });

export const quizRouter = new Hono<WorkspaceEnv>();

quizRouter.post('/:id/quiz', async (c) => {
  const workspace = c.get('workspace');
  const articleId = c.req.param('id');
  const [article] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.workspaceId, workspace.id)));
  if (!article) throw new NotFoundError('Article');
  if (article.status !== 'ready') return c.json({ error: 'Article not ready yet' }, 409);

  const existing = await db.select().from(quizzes).where(eq(quizzes.articleId, articleId));
  if (existing[0]) return c.json(existing[0]);

  const body = await c.req.json().catch(() => ({}));
  const { count } = createSchema.parse(body);

  const questions = await generateQuiz(article.rawText, count);
  const [quiz] = await db.insert(quizzes).values({ articleId, questions }).returning();
  return c.json(quiz);
});

quizRouter.get('/:id/quiz', async (c) => {
  const workspace = c.get('workspace');
  const articleId = c.req.param('id');
  const [article] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.workspaceId, workspace.id)));
  if (!article) throw new NotFoundError('Article');

  const [quiz] = await db.select().from(quizzes).where(eq(quizzes.articleId, articleId));
  if (!quiz) throw new NotFoundError('Quiz');
  return c.json(quiz);
});

quizRouter.post('/:id/quiz/grade', async (c) => {
  const workspace = c.get('workspace');
  const articleId = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const parsed = gradeSchema.safeParse(body);
  if (!parsed.success) throw new ValidationError('questionId and userAnswer are required');

  const [article] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.workspaceId, workspace.id)));
  if (!article) throw new NotFoundError('Article');

  const [quiz] = await db.select().from(quizzes).where(eq(quizzes.articleId, articleId));
  if (!quiz) throw new NotFoundError('Quiz');

  const question = quiz.questions.find((q) => q.id === parsed.data.questionId);
  if (!question) throw new NotFoundError('Question');
  if (question.type !== 'open_ended') {
    return c.json({ error: 'Only open-ended questions can be graded via API' }, 400);
  }

  const result = await gradeAnswer(question.question, question.correctAnswer, parsed.data.userAnswer);
  return c.json<GradeResponse>(result);
});
