import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, setWorkspaceId } from '@/lib/api';
import { useWorkspaceStore } from '@/store/workspaceStore';

const WORKSPACES_KEY = ['workspaces'] as const;

export function useWorkspaces() {
  const setWorkspaces = useWorkspaceStore((s) => s.setWorkspaces);
  const query = useQuery({
    queryKey: WORKSPACES_KEY,
    queryFn: () => api.workspaces.list(),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (query.data?.workspaces) {
      setWorkspaces(query.data.workspaces);
    }
  }, [query.data, setWorkspaces]);

  return query;
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  const { addWorkspace, setActiveWorkspaceId } = useWorkspaceStore();

  return useMutation({
    mutationFn: (name: string) => api.workspaces.create({ name }),
    onSuccess: (data) => {
      const ws = {
        id: data.id,
        name: data.name,
        userId: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      addWorkspace(ws);
      setActiveWorkspaceId(data.id);
      setWorkspaceId(data.id);
      qc.invalidateQueries({ queryKey: WORKSPACES_KEY });
    },
  });
}

export function useRenameWorkspace() {
  const qc = useQueryClient();
  const renameWorkspace = useWorkspaceStore((s) => s.renameWorkspace);

  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.workspaces.rename(id, { name }),
    onSuccess: (_, { id, name }) => {
      renameWorkspace(id, name);
      qc.invalidateQueries({ queryKey: WORKSPACES_KEY });
    },
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  const { removeWorkspace } = useWorkspaceStore();

  return useMutation({
    mutationFn: (id: string) => api.workspaces.delete(id),
    onSuccess: (_, id) => {
      removeWorkspace(id);
      // After removal, store auto-selects next workspace; sync localStorage
      const nextId = useWorkspaceStore.getState().activeWorkspaceId;
      if (nextId) setWorkspaceId(nextId);
      qc.invalidateQueries({ queryKey: WORKSPACES_KEY });
      qc.invalidateQueries({ queryKey: ['articles'] });
    },
  });
}

export function useSwitchWorkspace() {
  const { setActiveWorkspaceId } = useWorkspaceStore();
  const qc = useQueryClient();

  return (id: string) => {
    setActiveWorkspaceId(id);
    setWorkspaceId(id);
    qc.invalidateQueries({ queryKey: ['articles'] });
  };
}

export function useBootstrapWorkspace() {
  const { activeWorkspaceId, isBootstrapped, setActiveWorkspaceId, setBootstrapped, setWorkspaces } =
    useWorkspaceStore();
  const { mutateAsync: createWorkspace } = useCreateWorkspace();

  useEffect(() => {
    if (isBootstrapped && activeWorkspaceId) return;

    let cancelled = false;

    async function bootstrap() {
      try {
        const { workspaces } = await api.workspaces.list();
        if (cancelled) return;

        if (workspaces.length > 0) {
          setWorkspaces(workspaces);
          const current = activeWorkspaceId
            ? workspaces.find((w) => w.id === activeWorkspaceId)
            : null;
          const toActivate = current ?? workspaces[0];
          setActiveWorkspaceId(toActivate.id);
          setWorkspaceId(toActivate.id);
        } else {
          await createWorkspace('My Workspace');
        }

        if (!cancelled) setBootstrapped(true);
      } catch (err) {
        console.error('[Bootstrap] Failed to initialize workspace:', err);
      }
    }

    bootstrap();
    return () => { cancelled = true; };
  }, []);

  return { isBootstrapped: isBootstrapped && !!activeWorkspaceId };
}
