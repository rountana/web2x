import { Hono } from 'hono';

export const shareTargetRouter = new Hono();

// PWA share target: redirect to the frontend which handles article creation
// with proper workspace context via the api client.
shareTargetRouter.get('/', (c) => {
  const url = c.req.query('url');
  if (!url) return c.redirect('/');
  return c.redirect(`/share-target?url=${encodeURIComponent(url)}`);
});
