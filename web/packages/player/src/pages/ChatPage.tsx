import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  nakama,
  useRpcOptions,
  useAuthStore,
} from "@nakama/shared";
import type {
  Friend,
  FriendList,
  ChannelMessage,
  ChannelPresenceEvent,
  ChannelPresence,
  Channel,
  UserGroupList,
} from "@nakama/shared";
import { useNakamaSocket } from "../hooks/use-nakama-socket";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Conversation {
  kind: "dm" | "group";
  target: string;
  label: string;
  avatarUrl?: string;
  channelType: number; // 2 = DM, 3 = Group
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmtTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function parseContent(raw: string): string {
  try {
    const obj = JSON.parse(raw);
    return typeof obj.message === "string" ? obj.message : raw;
  } catch {
    return raw;
  }
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";
}

/* ------------------------------------------------------------------ */
/*  Icons (inline SVGs to avoid extra deps)                            */
/* ------------------------------------------------------------------ */

function SendIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4"
    >
      <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086L2.28 16.762a.75.75 0 0 0 .826.95l15.5-5.5a.75.75 0 0 0 0-1.424l-15.5-5.5Z" />
    </svg>
  );
}

function HashIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="h-3.5 w-3.5"
    >
      <path
        fillRule="evenodd"
        d="M6.455 1.45A.5.5 0 0 1 6.952 1h.096a.5.5 0 0 1 .497.55L7.223 4H9.88l.344-2.45A.5.5 0 0 1 10.72 1h.097a.5.5 0 0 1 .496.55L10.992 4H13.5a.5.5 0 0 1 .5.5v.067a.5.5 0 0 1-.55.497L11.137 5l-.281 2H13.5a.5.5 0 0 1 .5.5v.067a.5.5 0 0 1-.55.497L11 8.001l-.344 2.45a.5.5 0 0 1-.497.45h-.096a.5.5 0 0 1-.497-.55L9.888 8.4H7.23l-.344 2.45A.5.5 0 0 1 6.39 11.3h-.097a.5.5 0 0 1-.496-.55L6.118 8.4H3.5a.5.5 0 0 1-.5-.5v-.067a.5.5 0 0 1 .55-.497L5.972 7l.282-2H3.5a.5.5 0 0 1-.5-.5v-.067a.5.5 0 0 1 .55-.497L6.118 4l.337-2.55ZM7.368 5l-.282 2h2.658l.282-2H7.368Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export function ChatPage() {
  const rpcOpts = useRpcOptions();
  const user = useAuthStore((s) => s.user);
  const myId = user?.user_id ?? "";

  const socket = useNakamaSocket();

  const [tab, setTab] = useState<"dm" | "group">("dm");
  const [activeConvo, setActiveConvo] = useState<Conversation | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [presences, setPresences] = useState<ChannelPresence[]>([]);
  const [input, setInput] = useState("");
  const [joining, setJoining] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const channelIdRef = useRef<string | null>(null);

  useEffect(() => {
    channelIdRef.current = channelId;
  }, [channelId]);

  /* ---- Fetch mutual friends for DM list ---- */
  const { data: friendsData } = useQuery<FriendList>({
    queryKey: ["nakama", "friends", 0],
    queryFn: () => nakama.listFriends({ ...rpcOpts, limit: 100, state: 0 }),
    staleTime: 30_000,
  });

  const friends = useMemo(() => friendsData?.friends ?? [], [friendsData]);

  /* ---- Fetch user groups for group chat ---- */
  const { data: groupsData } = useQuery<UserGroupList>({
    queryKey: ["nakama", "userGroups", myId],
    queryFn: () => nakama.listUserGroups(myId, { ...rpcOpts, limit: 100 }),
    enabled: !!myId,
    staleTime: 30_000,
  });

  const groups = useMemo(() => groupsData?.user_groups ?? [], [groupsData]);

  /* ---- Build conversation list ---- */
  const conversations = useMemo<Conversation[]>(() => {
    if (tab === "dm") {
      return friends.map((f: Friend) => ({
        kind: "dm" as const,
        target: f.user.user_id,
        label: f.user.display_name || f.user.username || f.user.user_id,
        avatarUrl: f.user.avatar_url,
        channelType: 2,
      }));
    }
    return groups.map((ug) => ({
      kind: "group" as const,
      target: ug.group.id,
      label: ug.group.name,
      avatarUrl: ug.group.avatar_url,
      channelType: 3,
    }));
  }, [tab, friends, groups]);

  /* ---- Join channel when selecting a conversation ---- */
  const openConversation = useCallback(
    async (convo: Conversation) => {
      if (channelIdRef.current) {
        socket.leaveChannel(channelIdRef.current);
      }

      setActiveConvo(convo);
      setMessages([]);
      setPresences([]);
      setChannelId(null);
      setJoining(true);

      try {
        const ch: Channel = await socket.joinChannel(
          convo.target,
          convo.channelType,
          true,
          false,
        );
        setChannelId(ch.id);
        setPresences(ch.presences ?? []);

        try {
          const history = await nakama.listChannelMessages(ch.id, {
            ...rpcOpts,
            limit: 50,
            forward: false,
          });
          setMessages((history.messages ?? []).reverse());
        } catch {
          /* no history yet */
        }
      } catch (err) {
        console.error("Failed to join channel", err);
      } finally {
        setJoining(false);
      }
    },
    [socket, rpcOpts],
  );

  /* ---- Real-time incoming messages ---- */
  useEffect(() => {
    return socket.onMessage((msg: ChannelMessage) => {
      if (msg.channel_id === channelIdRef.current) {
        setMessages((prev) => [...prev, msg]);
      }
    });
  }, [socket]);

  /* ---- Presence join / leave ---- */
  useEffect(() => {
    return socket.onPresence((evt: ChannelPresenceEvent) => {
      if (evt.channel_id !== channelIdRef.current) return;
      setPresences((prev) => {
        let next = [...prev];
        for (const l of evt.leaves ?? []) {
          next = next.filter((p) => p.session_id !== l.session_id);
        }
        for (const j of evt.joins ?? []) {
          if (!next.some((p) => p.session_id === j.session_id)) {
            next.push(j);
          }
        }
        return next;
      });
    });
  }, [socket]);

  /* ---- Auto-scroll on new messages ---- */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* ---- Send ---- */
  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || !channelId) return;
    socket.sendMessage(channelId, { message: text });
    setInput("");
  };

  /* ---- Leave channel on unmount ---- */
  useEffect(() => {
    return () => {
      if (channelIdRef.current) {
        socket.leaveChannel(channelIdRef.current);
      }
    };
  }, [socket]);

  /* ---- Switch tabs ---- */
  const switchTab = useCallback(
    (t: "dm" | "group") => {
      if (channelIdRef.current) {
        socket.leaveChannel(channelIdRef.current);
      }
      setTab(t);
      setActiveConvo(null);
      setChannelId(null);
      setMessages([]);
      setPresences([]);
    },
    [socket],
  );

  const TABS: { key: "dm" | "group"; label: string; count: number }[] = [
    { key: "dm", label: "Friends", count: friends.length },
    { key: "group", label: "Groups", count: groups.length },
  ];

  /* ================================================================ */
  /*  Render                                                          */
  /* ================================================================ */

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Chat</h2>
        <p className="text-muted-foreground">
          Messages with friends and groups.
        </p>
      </div>

      {/* Connection banner */}
      {!socket.connected && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-600 dark:text-yellow-400">
          Connecting to chat server&hellip;
        </div>
      )}

      <div className="flex h-[calc(100vh-220px)] min-h-[480px] overflow-hidden rounded-lg border border-border">
        {/* ============== Sidebar ============== */}
        <div className="flex w-72 shrink-0 flex-col border-r border-border bg-muted/30">
          {/* Tab switcher */}
          <div className="flex border-b border-border">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => switchTab(t.key)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors",
                  tab === t.key
                    ? "border-b-2 border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                {t.count > 0 && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold leading-none">
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                <p className="text-sm text-muted-foreground">
                  {tab === "dm"
                    ? "No friends yet. Add friends to start chatting!"
                    : "You haven't joined any groups yet."}
                </p>
              </div>
            )}
            {conversations.map((c) => {
              const active = activeConvo?.target === c.target;
              return (
                <button
                  key={c.target}
                  onClick={() => openConversation(c)}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
                    active
                      ? "bg-primary/10 dark:bg-primary/5"
                      : "hover:bg-muted/60",
                  )}
                >
                  {c.avatarUrl ? (
                    <img
                      src={c.avatarUrl}
                      alt=""
                      className="h-9 w-9 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <div
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                        c.kind === "dm"
                          ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                          : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                      )}
                    >
                      {c.kind === "group" ? (
                        <HashIcon />
                      ) : (
                        initials(c.label)
                      )}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.kind === "dm" ? "Direct message" : "Group chat"}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ============== Chat area ============== */}
        <div className="flex flex-1 flex-col">
          {!activeConvo ? (
            /* Empty state */
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                className="h-12 w-12 opacity-30"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
                />
              </svg>
              <p className="text-sm">Select a conversation to start chatting</p>
            </div>
          ) : (
            <>
              {/* ---- Chat header ---- */}
              <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                {activeConvo.avatarUrl ? (
                  <img
                    src={activeConvo.avatarUrl}
                    alt=""
                    className="h-8 w-8 rounded-full object-cover"
                  />
                ) : (
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold",
                      activeConvo.kind === "dm"
                        ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                        : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    {activeConvo.kind === "group" ? (
                      <HashIcon />
                    ) : (
                      initials(activeConvo.label)
                    )}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {activeConvo.label}
                  </p>
                  {channelId && (
                    <p className="text-xs text-muted-foreground">
                      {presences.length}{" "}
                      {presences.length === 1 ? "member" : "members"} online
                    </p>
                  )}
                </div>
              </div>

              {/* ---- Messages ---- */}
              <div className="flex-1 space-y-1 overflow-y-auto px-4 py-3">
                {joining && (
                  <div className="flex justify-center py-12 text-sm text-muted-foreground">
                    Joining channel&hellip;
                  </div>
                )}

                {!joining && messages.length === 0 && channelId && (
                  <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
                    <p className="text-sm">No messages yet. Say hello!</p>
                  </div>
                )}

                {messages.map((msg, idx) => {
                  const isMe = msg.sender_id === myId;
                  const prevMsg = idx > 0 ? messages[idx - 1] : null;
                  const sameSender =
                    prevMsg?.sender_id === msg.sender_id;

                  return (
                    <div
                      key={msg.message_id}
                      className={cn(
                        "flex",
                        isMe ? "justify-end" : "justify-start",
                        !sameSender && idx > 0 && "mt-3",
                      )}
                    >
                      <div
                        className={cn(
                          "max-w-[70%] rounded-xl px-3.5 py-2",
                          isMe
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted",
                        )}
                      >
                        {!isMe && !sameSender && (
                          <p className="mb-0.5 text-xs font-semibold opacity-70">
                            {msg.username}
                          </p>
                        )}
                        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                          {parseContent(msg.content)}
                        </p>
                        <p
                          className={cn(
                            "mt-0.5 text-right text-[10px]",
                            isMe
                              ? "text-primary-foreground/50"
                              : "text-muted-foreground/70",
                          )}
                        >
                          {fmtTime(msg.create_time)}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              {/* ---- Input ---- */}
              <form
                onSubmit={handleSend}
                className="flex items-center gap-2 border-t border-border px-4 py-3"
              >
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={
                    channelId ? "Type a message…" : "Connecting…"
                  }
                  disabled={!channelId}
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!channelId || !input.trim()}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
                  title="Send"
                >
                  <SendIcon />
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export { ChatPage as default };

export default ChatPage;
