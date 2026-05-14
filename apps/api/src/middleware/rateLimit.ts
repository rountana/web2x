import type { MiddlewareHandler } from 'hono';
import { getRedis } from '../services/redis.js';

const IP_LIMIT = 10;
const LLM_LIMIT = 5;
const WINDOW_SECONDS = 3600;

const LLM_PATHS = ['/deck', '/quiz', '/summary', '/pdf', '/chat'];

export const rateLimitMiddleware: MiddlewareHandler = async (c, next) => {
  if (process.env.NODE_ENV === 'development') {
    return next();
  }

  const redis = getRedis();
  const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';

  const ipKey = `rl:ip:${ip}`;
  const count = await redis.incr(ipKey);
  if (count === 1) await redis.expire(ipKey, WINDOW_SECONDS);

  if (count > IP_LIMIT) {
    return c.json({ error: 'Rate limit exceeded', code: 'RATE_LIMIT' }, 429);
  }

  const isLlmRoute = LLM_PATHS.some((p) => c.req.path.endsWith(p));
  if (isLlmRoute && c.req.method === 'POST') {
    const anonId = c.req.header('x-anon-id') ?? ip;
    const llmKey = `rl:llm:${anonId}`;
    const llmCount = await redis.incr(llmKey);
    if (llmCount === 1) await redis.expire(llmKey, WINDOW_SECONDS);
    if (llmCount > LLM_LIMIT) {
      return c.json({ error: 'LLM generation limit exceeded', code: 'LLM_RATE_LIMIT' }, 429);
    }
  }

  await next();
};
