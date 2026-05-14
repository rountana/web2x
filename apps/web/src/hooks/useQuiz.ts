import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useQuiz(articleId: string) {
  return useQuery({
    queryKey: ['quiz', articleId],
    queryFn: () => api.quiz.get(articleId),
    enabled: !!articleId,
    retry: false,
  });
}

export function useCreateQuiz(articleId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (count?: number) => api.quiz.generate(articleId, { count }),
    onSuccess: (data) => {
      queryClient.setQueryData(['quiz', articleId], data);
    },
  });
}

export function useGradeAnswer(articleId: string) {
  return useMutation({
    mutationFn: ({ questionId, userAnswer }: { questionId: string; userAnswer: string }) =>
      api.quiz.grade(articleId, { questionId, userAnswer }),
  });
}
