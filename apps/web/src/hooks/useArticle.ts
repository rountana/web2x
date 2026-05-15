import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useArticleStore } from '@/store/articleStore';
import { useWorkspaceStore } from '@/store/workspaceStore';

export function useArticle(id: string, chunkCount?: number) {
  return useQuery({
    queryKey: ['article', id],
    queryFn: () => api.articles.get(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Poll while extracting; also poll while ready-but-unchunked so we detect final failure.
      if (status === 'pending') return 2000;
      if (status === 'ready' && (chunkCount ?? 0) === 0) return 3000;
      return false;
    },
    enabled: !!id,
  });
}

export function useCreateArticle() {
  const queryClient = useQueryClient();
  const addArticleId = useArticleStore((s) => s.addArticleId);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  return useMutation({
    mutationFn: (url: string) => api.articles.create({ url }),
    onSuccess: (data) => {
      addArticleId(data.id);
      queryClient.invalidateQueries({ queryKey: ['articles', activeWorkspaceId] });
    },
  });
}

export function useIngestMarkdown() {
  const queryClient = useQueryClient();
  const addArticleId = useArticleStore((s) => s.addArticleId);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  return useMutation({
    mutationFn: (params: { content: string; title?: string }) =>
      api.articles.ingestMarkdown(params),
    onSuccess: (data) => {
      addArticleId(data.id);
      queryClient.invalidateQueries({ queryKey: ['articles', activeWorkspaceId] });
    },
  });
}

export function useIngestPdf() {
  const queryClient = useQueryClient();
  const addArticleId = useArticleStore((s) => s.addArticleId);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  return useMutation({
    mutationFn: (params: { file: File; title?: string }) =>
      api.articles.ingestPdf(params.file, params.title),
    onSuccess: (data) => {
      addArticleId(data.id);
      queryClient.invalidateQueries({ queryKey: ['articles', activeWorkspaceId] });
    },
  });
}

export function useArticleList(page = 1) {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  return useQuery({
    queryKey: ['articles', activeWorkspaceId, page],
    queryFn: () => api.articles.list(page),
    enabled: !!activeWorkspaceId,
    refetchInterval: (query) => {
      const hasPending = query.state.data?.articles.some((a) => a.status === 'pending');
      return hasPending ? 3000 : false;
    },
  });
}

export function useArticleChunkStatus(id: string) {
  return useQuery({
    queryKey: ['article-chunks', id],
    queryFn: () => api.articles.chunkStatus(id),
    enabled: !!id,
    refetchInterval: (query) =>
      (query.state.data?.count ?? 0) === 0 ? 3000 : false,
  });
}

export function useRetryArticle() {
  const queryClient = useQueryClient();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  return useMutation({
    mutationFn: (id: string) => api.articles.retry(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['article', id] });
      queryClient.invalidateQueries({ queryKey: ['article-chunks', id] });
      queryClient.invalidateQueries({ queryKey: ['articles', activeWorkspaceId] });
    },
  });
}
