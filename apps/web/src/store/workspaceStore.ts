import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Workspace } from '@web2x/shared';

interface WorkspaceStore {
  activeWorkspaceId: string | null;
  workspaces: Workspace[];
  isBootstrapped: boolean;

  setActiveWorkspaceId: (id: string) => void;
  setWorkspaces: (ws: Workspace[]) => void;
  addWorkspace: (ws: Workspace) => void;
  removeWorkspace: (id: string) => void;
  renameWorkspace: (id: string, name: string) => void;
  setBootstrapped: (v: boolean) => void;
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set) => ({
      activeWorkspaceId: null,
      workspaces: [],
      isBootstrapped: false,

      setActiveWorkspaceId: (id) => set({ activeWorkspaceId: id }),

      setWorkspaces: (ws) => set({ workspaces: ws }),

      addWorkspace: (ws) => set((s) => ({ workspaces: [...s.workspaces, ws] })),

      removeWorkspace: (id) =>
        set((s) => {
          const remaining = s.workspaces.filter((w) => w.id !== id);
          const nextActive =
            s.activeWorkspaceId === id ? (remaining[0]?.id ?? null) : s.activeWorkspaceId;
          return { workspaces: remaining, activeWorkspaceId: nextActive };
        }),

      renameWorkspace: (id, name) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, name } : w)),
        })),

      setBootstrapped: (v) => set({ isBootstrapped: v }),
    }),
    {
      name: 'web2x-workspace',
      // Only persist the active workspace ID — workspace list is always fetched fresh
      partialize: (s) => ({ activeWorkspaceId: s.activeWorkspaceId }),
    }
  )
);
