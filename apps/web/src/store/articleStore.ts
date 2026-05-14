import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ArticleStore {
  articleIds: string[];
  articleCount: number;
  showInstallPrompt: boolean;
  addArticleId: (id: string) => void;
  removeArticleId: (id: string) => void;
  setShowInstallPrompt: (show: boolean) => void;
}

export const useArticleStore = create<ArticleStore>()(
  persist(
    (set) => ({
      articleIds: [],
      articleCount: 0,
      showInstallPrompt: false,

      addArticleId: (id) =>
        set((state) => ({
          articleIds: [id, ...state.articleIds.filter((x) => x !== id)],
          articleCount: state.articleCount + 1,
        })),

      removeArticleId: (id) =>
        set((state) => ({
          articleIds: state.articleIds.filter((x) => x !== id),
        })),

      setShowInstallPrompt: (show) => set({ showInstallPrompt: show }),
    }),
    { name: 'web2x-articles' },
  ),
);
