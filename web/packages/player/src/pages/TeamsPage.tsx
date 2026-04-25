import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  nakama,
  useRpcOptions,
  useAuthStore,
} from "@nakama/shared";
import type {
  NakamaGroup,
  UserGroupList,
  GroupUserList,
  GroupList,
} from "@nakama/shared";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Group member state (Nakama)                                        */
/*  0 = super-admin (creator)  1 = admin  2 = member  3 = join request */
/* ------------------------------------------------------------------ */

const ROLE_LABELS: Record<number, string> = {
  0: "Super Admin",
  1: "Admin",
  2: "Member",
  3: "Requested",
};
const ROLE_COLORS: Record<number, string> = {
  0: "bg-yellow-500/20 text-yellow-400",
  1: "bg-blue-500/20 text-blue-400",
  2: "bg-zinc-500/20 text-zinc-400",
  3: "bg-orange-500/20 text-orange-400",
};

type TabKey = "my-teams" | "browse" | "create";

const TABS: { key: TabKey; label: string }[] = [
  { key: "my-teams", label: "My Teams" },
  { key: "browse", label: "Browse" },
  { key: "create", label: "Create" },
];

function fmtDate(iso?: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/* ================================================================== */
/*  Create Team Form                                                   */
/* ================================================================== */

function CreateTeamForm({ onCreated }: { onCreated: () => void }) {
  const rpcOpts = useRpcOptions();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [open, setOpen] = useState(true);
  const [maxCount, setMaxCount] = useState(100);
  const [error, setError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () =>
      nakama.createGroup(
        { name, description, open, max_count: maxCount },
        rpcOpts,
      ),
    onSuccess: () => {
      setName("");
      setDescription("");
      setOpen(true);
      setMaxCount(100);
      setError(null);
      onCreated();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="space-y-1">
        <label className="text-sm font-medium">Team Name *</label>
        <input
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          placeholder="e.g. Dragon Slayers"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium">Description</label>
        <textarea
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          rows={3}
          placeholder="Tell people about your team..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
        <div>
          <p className="text-sm font-medium">Open Group</p>
          <p className="text-xs text-muted-foreground">
            Anyone can join without approval
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={open}
          onClick={() => setOpen(!open)}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
            open ? "bg-primary" : "bg-zinc-700",
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform",
              open ? "translate-x-5" : "translate-x-0",
            )}
          />
        </button>
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium">Max Members</label>
        <input
          type="number"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={maxCount}
          onChange={(e) => setMaxCount(Number(e.target.value) || 100)}
          min={1}
          max={1000}
        />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        disabled={!name.trim() || createMut.isPending}
        onClick={() => createMut.mutate()}
        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {createMut.isPending ? "Creating\u2026" : "Create Team"}
      </button>
    </div>
  );
}

/* ================================================================== */
/*  Team Detail View                                                   */
/* ================================================================== */

function TeamDetail({
  group,
  myState,
  onBack,
}: {
  group: NakamaGroup;
  myState: number;
  onBack: () => void;
}) {
  const rpcOpts = useRpcOptions();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState(group.name);
  const [editDesc, setEditDesc] = useState(group.description);
  const [editOpen, setEditOpen] = useState(group.open);
  const [addUserId, setAddUserId] = useState("");

  const isAdmin = myState <= 1;
  const isSuperAdmin = myState === 0;

  const { data: membersData, isLoading: membersLoading } =
    useQuery<GroupUserList>({
      queryKey: ["nakama", "group-users", group.id],
      queryFn: () =>
        nakama.listGroupUsers(group.id, { ...rpcOpts, limit: 100 }),
      staleTime: 15_000,
    });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ["nakama", "group-users", group.id],
    });
    queryClient.invalidateQueries({ queryKey: ["nakama", "my-groups"] });
  }, [queryClient, group.id]);

  const updateMut = useMutation({
    mutationFn: () =>
      nakama.updateGroup(
        group.id,
        { name: editName, description: editDesc, open: editOpen },
        rpcOpts,
      ),
    onSuccess: () => {
      setEditMode(false);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["nakama", "browse-groups"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: () => nakama.deleteGroup(group.id, rpcOpts),
    onSuccess: () => {
      invalidate();
      onBack();
    },
  });

  const leaveMut = useMutation({
    mutationFn: () => nakama.leaveGroup(group.id, rpcOpts),
    onSuccess: () => {
      invalidate();
      onBack();
    },
  });

  const kickMut = useMutation({
    mutationFn: (userId: string) =>
      nakama.kickGroupUsers(group.id, [userId], rpcOpts),
    onSuccess: invalidate,
  });

  const promoteMut = useMutation({
    mutationFn: (userId: string) =>
      nakama.promoteGroupUsers(group.id, [userId], rpcOpts),
    onSuccess: invalidate,
  });

  const demoteMut = useMutation({
    mutationFn: (userId: string) =>
      nakama.demoteGroupUsers(group.id, [userId], rpcOpts),
    onSuccess: invalidate,
  });

  const banMut = useMutation({
    mutationFn: (userId: string) =>
      nakama.banGroupUsers(group.id, [userId], rpcOpts),
    onSuccess: invalidate,
  });

  const addMut = useMutation({
    mutationFn: (userId: string) =>
      nakama.addGroupUsers(group.id, [userId], rpcOpts),
    onSuccess: () => {
      setAddUserId("");
      invalidate();
    },
  });

  const members = useMemo(
    () => (membersData?.group_users ?? []).sort((a, b) => a.state - b.state),
    [membersData],
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"
        >
          &larr; Back
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-semibold">{group.name}</h3>
          <p className="text-xs text-muted-foreground">
            {group.edge_count}/{group.max_count} members &middot;{" "}
            {group.open ? "Open" : "Closed"} &middot; Created{" "}
            {fmtDate(group.create_time)}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
            ROLE_COLORS[myState] ?? ROLE_COLORS[2],
          )}
        >
          {ROLE_LABELS[myState] ?? "Member"}
        </span>
      </div>

      {group.description && (
        <p className="text-sm text-muted-foreground">{group.description}</p>
      )}

      {/* Action bar */}
      <div className="flex flex-wrap gap-2">
        {isAdmin && (
          <button
            onClick={() => setEditMode(!editMode)}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"
          >
            {editMode ? "Cancel Edit" : "Edit Team"}
          </button>
        )}
        {isSuperAdmin && (
          <button
            onClick={() => {
              if (confirm("Delete this team permanently?"))
                deleteMut.mutate();
            }}
            className="rounded-md border border-red-800 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/30"
          >
            Delete Team
          </button>
        )}
        <button
          onClick={() => {
            if (confirm("Leave this team?")) leaveMut.mutate();
          }}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-orange-400 hover:bg-orange-900/20"
        >
          Leave Team
        </button>
      </div>

      {/* Inline edit form */}
      {editMode && isAdmin && (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
          />
          <textarea
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            rows={2}
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <label className="text-sm">Open:</label>
            <button
              type="button"
              role="switch"
              aria-checked={editOpen}
              onClick={() => setEditOpen(!editOpen)}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                editOpen ? "bg-primary" : "bg-zinc-700",
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform",
                  editOpen ? "translate-x-5" : "translate-x-0",
                )}
              />
            </button>
          </div>
          <button
            onClick={() => updateMut.mutate()}
            disabled={updateMut.isPending}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {updateMut.isPending ? "Saving\u2026" : "Save"}
          </button>
        </div>
      )}

      {/* Add member (admin) */}
      {isAdmin && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (addUserId.trim()) addMut.mutate(addUserId.trim());
          }}
          className="flex gap-2"
        >
          <input
            className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            placeholder="Add user by ID\u2026"
            value={addUserId}
            onChange={(e) => setAddUserId(e.target.value)}
          />
          <button
            type="submit"
            disabled={!addUserId.trim() || addMut.isPending}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Add
          </button>
        </form>
      )}

      {/* Members list */}
      <div>
        <h4 className="mb-2 text-sm font-semibold">
          Members ({members.length})
        </h4>
        {membersLoading ? (
          <p className="text-sm text-muted-foreground">Loading\u2026</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No members found.</p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {members.map((gu) => {
              const u = gu.user;
              const isMe = u.user_id === currentUser?.user_id;
              const canManage = isAdmin && !isMe && gu.state > myState;

              return (
                <div
                  key={u.user_id}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold uppercase">
                    {(u.display_name || u.username)?.[0] ?? "?"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {u.display_name || u.username}
                      {isMe && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          (you)
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      @{u.username}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                      ROLE_COLORS[gu.state] ?? ROLE_COLORS[2],
                    )}
                  >
                    {ROLE_LABELS[gu.state] ?? "Member"}
                  </span>

                  {/* Role management */}
                  {canManage && gu.state !== 3 && (
                    <div className="flex gap-1">
                      {gu.state > 1 && (
                        <button
                          onClick={() => promoteMut.mutate(u.user_id)}
                          className="rounded border border-border px-2 py-0.5 text-[10px] hover:bg-accent"
                          title="Promote"
                        >
                          &uarr;
                        </button>
                      )}
                      {gu.state > 0 && gu.state < 3 && (
                        <button
                          onClick={() => demoteMut.mutate(u.user_id)}
                          className="rounded border border-border px-2 py-0.5 text-[10px] hover:bg-accent"
                          title="Demote"
                        >
                          &darr;
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (
                            confirm(
                              `Kick ${u.display_name || u.username}?`,
                            )
                          )
                            kickMut.mutate(u.user_id);
                        }}
                        className="rounded border border-border px-2 py-0.5 text-[10px] text-orange-400 hover:bg-orange-900/20"
                        title="Kick"
                      >
                        Kick
                      </button>
                      <button
                        onClick={() => {
                          if (
                            confirm(
                              `Ban ${u.display_name || u.username}?`,
                            )
                          )
                            banMut.mutate(u.user_id);
                        }}
                        className="rounded border border-border px-2 py-0.5 text-[10px] text-red-400 hover:bg-red-900/20"
                        title="Ban"
                      >
                        Ban
                      </button>
                    </div>
                  )}

                  {/* Join-request accept/reject */}
                  {isAdmin && gu.state === 3 && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => addMut.mutate(u.user_id)}
                        className="rounded border border-green-800 px-2 py-0.5 text-[10px] text-green-400 hover:bg-green-900/20"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => kickMut.mutate(u.user_id)}
                        className="rounded border border-red-800 px-2 py-0.5 text-[10px] text-red-400 hover:bg-red-900/20"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Page                                                               */
/* ================================================================== */

export function TeamsPage() {
  const rpcOpts = useRpcOptions();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<TabKey>("my-teams");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<{
    group: NakamaGroup;
    state: number;
  } | null>(null);

  /* ---------- My Teams ---------- */
  const { data: myGroupsData, isLoading: myGroupsLoading } =
    useQuery<UserGroupList>({
      queryKey: ["nakama", "my-groups"],
      queryFn: () =>
        nakama.listUserGroups(currentUser!.user_id, {
          ...rpcOpts,
          limit: 100,
        }),
      enabled: !!currentUser,
      staleTime: 15_000,
    });

  const myGroups = useMemo(
    () => myGroupsData?.group_users ?? [],
    [myGroupsData],
  );

  /* ---------- Browse ---------- */
  const [browseQuery, setBrowseQuery] = useState("");
  const {
    data: browseData,
    isLoading: browseLoading,
    refetch: browseRefetch,
  } = useQuery<GroupList>({
    queryKey: ["nakama", "browse-groups", browseQuery],
    queryFn: () =>
      nakama.listGroups({
        ...rpcOpts,
        name: browseQuery ? `${browseQuery}%` : undefined,
        limit: 50,
      }),
    staleTime: 30_000,
  });

  const browseGroups = useMemo(() => browseData?.groups ?? [], [browseData]);

  const joinMut = useMutation({
    mutationFn: (groupId: string) => nakama.joinGroup(groupId, rpcOpts),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nakama", "my-groups"] });
      queryClient.invalidateQueries({ queryKey: ["nakama", "browse-groups"] });
    },
  });

  const myGroupIds = useMemo(
    () => new Set(myGroups.map((ug) => ug.group.id)),
    [myGroups],
  );

  /* ---------- Filtered my teams ---------- */
  const filteredMyGroups = useMemo(() => {
    if (!search) return myGroups;
    const q = search.toLowerCase();
    return myGroups.filter(
      (ug) =>
        ug.group.name.toLowerCase().includes(q) ||
        ug.group.description?.toLowerCase().includes(q),
    );
  }, [myGroups, search]);

  /* ---------- Detail view ---------- */
  if (selected) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Teams</h2>
          <p className="text-muted-foreground">
            Guild management and clan challenges.
          </p>
        </div>
        <TeamDetail
          group={selected.group}
          myState={selected.state}
          onBack={() => {
            setSelected(null);
            queryClient.invalidateQueries({ queryKey: ["nakama", "my-groups"] });
          }}
        />
      </div>
    );
  }

  /* ---------- Main list view ---------- */
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Teams</h2>
        <p className="text-muted-foreground">
          Guild management and clan challenges.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-border p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setSearch("");
            }}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === t.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {t.label}
            {t.key === "my-teams" && myGroups.length > 0 && (
              <span className="ml-1.5 text-xs opacity-70">
                ({myGroups.length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ---- My Teams ---- */}
      {tab === "my-teams" && (
        <div className="space-y-4">
          {myGroups.length > 3 && (
            <input
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="Filter teams\u2026"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
          {myGroupsLoading ? (
            <p className="py-8 text-center text-muted-foreground">
              Loading\u2026
            </p>
          ) : filteredMyGroups.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
              {search
                ? "No teams match your filter."
                : "You haven\u2019t joined any teams yet. Browse or create one!"}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {filteredMyGroups.map((ug) => (
                <button
                  key={ug.group.id}
                  onClick={() =>
                    setSelected({ group: ug.group, state: ug.state })
                  }
                  className="rounded-lg border border-border p-4 text-left transition-colors hover:bg-accent/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">
                        {ug.group.name}
                      </p>
                      {ug.group.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {ug.group.description}
                        </p>
                      )}
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                        ROLE_COLORS[ug.state] ?? ROLE_COLORS[2],
                      )}
                    >
                      {ROLE_LABELS[ug.state] ?? "Member"}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      {ug.group.edge_count}/{ug.group.max_count} members
                    </span>
                    <span>{ug.group.open ? "Open" : "Closed"}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---- Browse ---- */}
      {tab === "browse" && (
        <div className="space-y-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              browseRefetch();
            }}
            className="flex gap-2"
          >
            <input
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="Search teams by name\u2026"
              value={browseQuery}
              onChange={(e) => setBrowseQuery(e.target.value)}
            />
            <button
              type="submit"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Search
            </button>
          </form>
          {browseLoading ? (
            <p className="py-8 text-center text-muted-foreground">
              Loading\u2026
            </p>
          ) : browseGroups.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
              No teams found. Try a different search or create your own!
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {browseGroups.map((g) => {
                const alreadyMember = myGroupIds.has(g.id);
                return (
                  <div
                    key={g.id}
                    className="rounded-lg border border-border p-4"
                  >
                    <p className="truncate font-semibold">{g.name}</p>
                    {g.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {g.description}
                      </p>
                    )}
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {g.edge_count}/{g.max_count} &middot;{" "}
                        {g.open ? "Open" : "Closed"}
                      </span>
                      {alreadyMember ? (
                        <span className="text-xs text-green-400">Joined</span>
                      ) : (
                        <button
                          onClick={() => joinMut.mutate(g.id)}
                          disabled={joinMut.isPending}
                          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
                        >
                          {g.open ? "Join" : "Request"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ---- Create ---- */}
      {tab === "create" && (
        <CreateTeamForm
          onCreated={() => {
            queryClient.invalidateQueries({ queryKey: ["nakama", "my-groups"] });
            setTab("my-teams");
          }}
        />
      )}
    </div>
  );
}

export { TeamsPage as default };

export default TeamsPage;
