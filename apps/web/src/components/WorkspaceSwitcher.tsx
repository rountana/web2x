import { useState, useRef, useEffect } from 'react';
import { Check, ChevronDown, Pencil, Plus, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/store/workspaceStore';
import {
  useWorkspaces,
  useCreateWorkspace,
  useRenameWorkspace,
  useDeleteWorkspace,
  useSwitchWorkspace,
} from '@/hooks/useWorkspace';

export function WorkspaceSwitcher() {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  useWorkspaces(); // keeps store in sync with server

  const switchWorkspace = useSwitchWorkspace();
  const { mutate: createWorkspace, isPending: isCreating } = useCreateWorkspace();
  const { mutate: renameWorkspace } = useRenameWorkspace();
  const { mutate: deleteWorkspace } = useDeleteWorkspace();

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (!dropdownRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setEditingId(null);
        setConfirmDeleteId(null);
        setShowNew(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function handleSwitch(id: string) {
    switchWorkspace(id);
    setOpen(false);
  }

  function startEdit(id: string, name: string) {
    setEditingId(id);
    setEditName(name);
    setConfirmDeleteId(null);
  }

  function submitRename(id: string) {
    const trimmed = editName.trim();
    if (trimmed) renameWorkspace({ id, name: trimmed });
    setEditingId(null);
  }

  function submitCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    createWorkspace(trimmed, {
      onSuccess: () => {
        setShowNew(false);
        setNewName('');
        setOpen(false);
      },
    });
  }

  function handleDelete(id: string) {
    deleteWorkspace(id, { onSuccess: () => setOpen(false) });
    setConfirmDeleteId(null);
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors max-w-[160px]"
      >
        <span className="truncate">{activeWorkspace?.name ?? 'Workspace'}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-64 rounded-lg border bg-popover shadow-md py-1">
          {workspaces.map((ws) => (
            <div key={ws.id} className="group px-2 py-0.5">
              {editingId === ws.id ? (
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitRename(ws.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className="flex-1 text-sm px-2 py-1 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    onClick={() => submitRename(ws.id)}
                    className="text-primary hover:text-primary/80 p-1"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="text-muted-foreground hover:text-foreground p-1"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : confirmDeleteId === ws.id ? (
                <div className="text-xs px-1 py-1">
                  <p className="text-destructive font-medium mb-1">
                    Delete "{ws.name}"? All articles will be deleted.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDelete(ws.id)}
                      className="text-destructive hover:underline font-medium"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1 rounded-md hover:bg-accent">
                  <button
                    onClick={() => handleSwitch(ws.id)}
                    className="flex-1 flex items-center gap-2 px-2 py-1.5 text-sm text-left"
                  >
                    <Check
                      className={cn(
                        'h-3.5 w-3.5 shrink-0',
                        ws.id === activeWorkspaceId ? 'opacity-100 text-primary' : 'opacity-0'
                      )}
                    />
                    <span className="truncate">{ws.name}</span>
                  </button>
                  <div className="flex items-center gap-0.5 pr-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => startEdit(ws.id, ws.name)}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      title="Rename"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(ws.id)}
                      disabled={workspaces.length <= 1}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Delete workspace"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          <div className="border-t mt-1 pt-1 px-2">
            {showNew ? (
              <div className="flex items-center gap-1 py-0.5">
                <input
                  autoFocus
                  placeholder="Workspace name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitCreate();
                    if (e.key === 'Escape') { setShowNew(false); setNewName(''); }
                  }}
                  className="flex-1 text-sm px-2 py-1 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  onClick={submitCreate}
                  disabled={isCreating || !newName.trim()}
                  className="text-primary hover:text-primary/80 p-1 disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => { setShowNew(false); setNewName(''); }}
                  className="text-muted-foreground hover:text-foreground p-1"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowNew(true)}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                New workspace
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
