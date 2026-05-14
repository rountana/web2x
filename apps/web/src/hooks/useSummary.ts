import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useSummary(articleId: string) {
  return useQuery({
    queryKey: ['summary', articleId],
    queryFn: () => api.summary.get(articleId),
    enabled: !!articleId,
    retry: false,
  });
}

export function useCreateSummary(articleId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.summary.generate(articleId),
    onSuccess: (data) => {
      queryClient.setQueryData(['summary', articleId], data);
    },
  });
}
