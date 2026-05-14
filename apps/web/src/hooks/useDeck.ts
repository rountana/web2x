import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useDeck(articleId: string) {
  return useQuery({
    queryKey: ['deck', articleId],
    queryFn: () => api.deck.get(articleId),
    enabled: !!articleId,
    retry: false,
  });
}

export function useCreateDeck(articleId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (count?: number) => api.deck.generate(articleId, { count }),
    onSuccess: (data) => {
      queryClient.setQueryData(['deck', articleId], data);
    },
  });
}
