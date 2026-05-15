import type {
  Article,
  ArticleListResponse,
  CreateArticleRequest,
  CreateArticleResponse,
  IngestMarkdownRequest,
  Deck,
  CreateDeckRequest,
  Quiz,
  CreateQuizRequest,
  GradeRequest,
  GradeResponse,
  Summary,
  PdfResponse,
  WorkspaceListResponse,
  CreateWorkspaceRequest,
  CreateWorkspaceResponse,
  RenameWorkspaceRequest,
  Workspace,
  SearchResult,
} from '@web2x/shared';

export interface SearchRequest {
  query: string;
  algorithm: 'bm25' | 'vector' | 'hybrid' | 'rag' | 'csv' | 'metadata';
  topK?: number;
}

export interface SearchResponse {
  results: SearchResult[];
}

export interface CsvColumnSchemaItem {
  name: string;
  type: 'text' | 'numeric' | 'date' | 'boolean';
}

export interface CsvUploadSummary {
  id: string;
  filename: string;
  columnSchema: CsvColumnSchemaItem[];
  rowCount: number;
  createdAt: string;
}

export interface CsvUploadResponse {
  id: string;
  filename: string;
  rowCount: number;
  columnSchema: CsvColumnSchemaItem[];
}

const ANON_ID_KEY = 'web2x_anon_id';
const WORKSPACE_ID_KEY = 'web2x_active_workspace_id';

export function getAnonId(): string {
  let id = localStorage.getItem(ANON_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ANON_ID_KEY, id);
  }
  return id;
}

export function getWorkspaceId(): string | null {
  return localStorage.getItem(WORKSPACE_ID_KEY);
}

export function setWorkspaceId(id: string): void {
  localStorage.setItem(WORKSPACE_ID_KEY, id);
}

const anonId = getAnonId();

export const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const workspaceId = getWorkspaceId();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-anon-id': anonId,
  };
  if (workspaceId) headers['x-workspace-id'] = workspaceId;

  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string>) },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

async function requestFormData<T>(path: string, body: FormData): Promise<T> {
  const workspaceId = getWorkspaceId();
  const headers: Record<string, string> = { 'x-anon-id': anonId };
  if (workspaceId) headers['x-workspace-id'] = workspaceId;

  const res = await fetch(`${API_BASE}/api/v1${path}`, { method: 'POST', body, headers });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  workspaces: {
    list: () => request<WorkspaceListResponse>('/workspaces'),
    create: (body: CreateWorkspaceRequest) =>
      request<CreateWorkspaceResponse>('/workspaces', { method: 'POST', body: JSON.stringify(body) }),
    rename: (id: string, body: RenameWorkspaceRequest) =>
      request<Workspace>(`/workspaces/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id: string) => request<{ success: boolean }>(`/workspaces/${id}`, { method: 'DELETE' }),
  },

  articles: {
    create: (body: CreateArticleRequest) =>
      request<CreateArticleResponse>('/articles', { method: 'POST', body: JSON.stringify(body) }),

    ingestMarkdown: (body: IngestMarkdownRequest) =>
      request<CreateArticleResponse>('/articles/ingest/markdown', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    ingestPdf: (file: File, title?: string) => {
      const form = new FormData();
      form.append('file', file);
      if (title) form.append('title', title);
      return requestFormData<CreateArticleResponse>('/articles/ingest/pdf', form);
    },

    get: (id: string) => request<Article>(`/articles/${id}`),

    list: (page = 1) => request<ArticleListResponse>(`/articles?page=${page}`),

    chunkStatus: (id: string) => request<{ count: number }>(`/articles/${id}/chunks`),

    retry: (id: string) =>
      request<{ id: string; status: 'pending' }>(`/articles/${id}/retry`, { method: 'POST' }),

    delete: (id: string) => request<void>(`/articles/${id}`, { method: 'DELETE' }),
  },

  deck: {
    generate: (articleId: string, body: CreateDeckRequest = {}) =>
      request<Deck>(`/articles/${articleId}/deck`, { method: 'POST', body: JSON.stringify(body) }),
    get: (articleId: string) => request<Deck>(`/articles/${articleId}/deck`),
  },

  quiz: {
    generate: (articleId: string, body: CreateQuizRequest = {}) =>
      request<Quiz>(`/articles/${articleId}/quiz`, { method: 'POST', body: JSON.stringify(body) }),
    get: (articleId: string) => request<Quiz>(`/articles/${articleId}/quiz`),
    grade: (articleId: string, body: GradeRequest) =>
      request<GradeResponse>(`/articles/${articleId}/quiz/grade`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },

  summary: {
    generate: (articleId: string) =>
      request<Summary>(`/articles/${articleId}/summary`, { method: 'POST' }),
    get: (articleId: string) => request<Summary>(`/articles/${articleId}/summary`),
  },

  pdf: {
    generate: (articleId: string) =>
      request<PdfResponse>(`/articles/${articleId}/pdf`, { method: 'POST' }),
  },

  search: {
    run: (body: SearchRequest) =>
      request<SearchResponse>('/search', { method: 'POST', body: JSON.stringify(body) }),
  },

  csv: {
    list: () => request<{ uploads: CsvUploadSummary[] }>('/csv'),

    upload: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return requestFormData<CsvUploadResponse>('/csv/upload', form);
    },

    delete: (id: string) =>
      request<{ success: boolean }>(`/csv/${id}`, { method: 'DELETE' }),
  },
};
