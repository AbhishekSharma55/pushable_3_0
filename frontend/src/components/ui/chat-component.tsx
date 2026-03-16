"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ArrowUpIcon,
  Paperclip,
  Bot,
  Search,
  MessageSquare,
  Users,
  Zap,
  Globe,
  Hash,
  Lock,
  ChevronRight,
  Plus,
  Check,
  History,
  Settings2,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChatWs } from "@/hooks/use-chat-ws";
import { useSessions, type Session } from "@/hooks/use-sessions";
import { useAgents, type Agent } from "@/hooks/use-agents";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { InlineBrowserPreview } from "@/components/ui/inline-browser-preview";
import { getAgentAvatarMeta } from "@/lib/agent-avatar";

// ─── Auto-resize textarea hook ────────────────────────────────────────────────

function useAutoResizeTextarea({ minHeight, maxHeight }: { minHeight: number; maxHeight?: number }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const adjustHeight = useCallback((reset?: boolean) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = `${minHeight}px`;
    if (!reset) {
      textarea.style.height = `${Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight ?? Infinity))}px`;
    }
  }, [minHeight, maxHeight]);

  useEffect(() => {
    if (textareaRef.current) textareaRef.current.style.height = `${minHeight}px`;
  }, [minHeight]);

  return { textareaRef, adjustHeight };
}

// ─── Thinking loader ──────────────────────────────────────────────────────────

const THINKING_MESSAGES = [
  "Thinking...",
  "Analyzing the prompt...",
  "Processing context...",
  "Reasoning step-by-step...",
  "Synthesizing information...",
  "Finalizing response...",
  "Connecting to agent…",
  "Analyzing your request…",
  "Securing workspace access…",
  "Gathering context…",
  "Reasoning through the problem…",
  "Preparing response…",
];

function ThinkingLoader() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % THINKING_MESSAGES.length);
    }, 4500);
    return () => clearInterval(interval);
  }, []);
  return (
    <TextShimmer className="font-mono text-sm" duration={1}>
      {THINKING_MESSAGES[index]}
    </TextShimmer>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the agentId from a canonical session key.
 * Format: "agent:<agentId>:<rest>"  →  agentId
 * Falls back to "" for legacy / non-agent keys.
 */
function parseAgentIdFromKey(key: string): string {
  const parts = key.trim().toLowerCase().split(":");
  if (parts.length >= 3 && parts[0] === "agent") {
    return parts[1] ?? "";
  }
  return "";
}

/**
 * Returns true when the session is a true agent-to-agent session
 * (sub-agent spawned by another agent, or an ACP inter-agent session).
 *
 * NOTE: `session.systemSent` is intentionally NOT used here.
 * OpenClaw sets systemSent=true on the session store entry whenever it injects
 * a skill snapshot on the first turn — this happens for ALL sessions including
 * normal user-initiated chats. It is NOT a reliable indicator of a2a sessions.
 */
function isAgentToAgent(session: Session): boolean {
  const key = (session.key ?? "").toLowerCase();
  // Sub-agent sessions: spawned by another agent
  if (key.includes(":subagent:") || key.startsWith("subagent:")) return true;
  // ACP sessions: inter-agent protocol
  if (key.includes(":acp:") || key.startsWith("acp:")) return true;
  return false;
}

/** Derive a human-readable channel label from the session. */
function getChannelLabel(session: Session): string {
  // Guard: channel/origin may arrive as a non-string (object) from the gateway
  const rawCh = session.channel ?? session.origin ?? "";
  const ch = (typeof rawCh === "string" ? rawCh : "").toLowerCase();
  if (!ch) {
    // Try to infer from session key
    const key = session.key.toLowerCase();
    if (key.includes("telegram")) return "Telegram";
    if (key.includes("discord")) return "Discord";
    if (key.includes("slack")) return "Slack";
    if (key.includes("signal")) return "Signal";
    if (key.includes("whatsapp")) return "WhatsApp";
    if (key.includes("skype")) return "Skype";
    if (key.includes("acp")) return "Agent";
    if (key.includes("subagent")) return "Sub-agent";
    return "Direct";
  }
  const map: Record<string, string> = {
    telegram: "Telegram",
    discord: "Discord",
    slack: "Slack",
    signal: "Signal",
    whatsapp: "WhatsApp",
    skype: "Skype",
    web: "Web",
    acp: "Agent",
    subagent: "Sub-agent",
    imessage: "iMessage",
    line: "LINE",
    matrix: "Matrix",
    msteams: "Teams",
  };
  for (const [k, v] of Object.entries(map)) {
    if (ch.includes(k)) return v;
  }
  // Capitalize first letter as fallback
  return ch.charAt(0).toUpperCase() + ch.slice(1);
}

/** Icon for the channel badge. */
function ChannelIcon({ session, className }: { session: Session; className?: string }) {
  const ch = getChannelLabel(session).toLowerCase();
  if (ch === "agent" || ch === "sub-agent") return <Zap className={cn("w-3 h-3", className)} />;
  if (ch === "web" || ch === "direct") return <Globe className={cn("w-3 h-3", className)} />;
  if (session.kind === "group") return <Users className={cn("w-3 h-3", className)} />;
  return <Hash className={cn("w-3 h-3", className)} />;
}

/** Format a timestamp (epoch ms or s) to a relative or short string. */
function formatTime(ts: number | null | undefined): string {
  if (!ts) return "";
  // openclaw returns seconds-based timestamps sometimes
  const ms = ts > 1e12 ? ts : ts * 1000;
  const now = Date.now();
  const diff = now - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Get initials for an avatar fallback. */
function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

// ─── Agent avatar ───────────────────────────────────────────────────────────

/**
 * Avatar for an agent or session.
 */
function AgentAvatar({
  agentId,
  agentName,
  avatarUrl,
  emoji,
  size = "sm",
  isBot = false,
}: {
  agentId: string;
  agentName: string;
  avatarUrl?: string;
  emoji?: string;
  size?: "sm" | "md";
  isBot?: boolean;
}) {
  const meta = getAgentAvatarMeta(agentId, agentName);
  const sizeClass = size === "md" ? "w-11 h-11" : "w-9 h-9";

  if (isBot) {
    return (
      <div className={cn(sizeClass, "rounded-full flex items-center justify-center font-semibold shrink-0 border border-border bg-muted text-muted-foreground")}>
        <Bot className="w-4 h-4" />
      </div>
    );
  }

  const src = avatarUrl ?? meta.avatarUrl;
  const fallback = emoji ?? meta.initials;

  return (
    <div className={cn(sizeClass, "relative rounded-full shrink-0 border border-border overflow-hidden bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground")}>
      <span className="select-none">{fallback}</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={agentName || "agent"}
        className="absolute inset-0 w-full h-full object-cover"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
      />
    </div>
  );
}

function SessionAvatar({
  session,
  agent,
  size = "sm",
}: {
  session: Session;
  agent?: Agent;
  size?: "sm" | "md";
}) {
  const a2a = isAgentToAgent(session);
  const agentId = agent?.id ?? parseAgentIdFromKey(session.key);
  const agentName = agent?.identity?.name ?? agent?.name ?? agent?.id ?? "";

  return (
    <AgentAvatar
      agentId={agentId || session.key}
      agentName={agentName}
      avatarUrl={agent?.identity?.avatarUrl}
      emoji={agent?.identity?.emoji}
      size={size}
      isBot={a2a}
    />
  );
}

// ─── Sidebar agent item ───────────────────────────────────────────────────────

function AgentItem({
  agent,
  isActive,
  onClick,
}: {
  agent: Agent;
  isActive: boolean;
  onClick: () => void;
}) {
  const agentName = agent.identity?.name ?? agent.name ?? agent.id;
  const avatarUrl = agent?.identity?.avatarUrl;
  const emoji = agent?.identity?.emoji;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left transition-colors",
        "hover:bg-accent/60 cursor-pointer",
        isActive && "bg-accent"
      )}
    >
      <AgentAvatar
        agentId={agent.id}
        agentName={agentName}
        avatarUrl={avatarUrl}
        emoji={emoji}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span className="text-sm font-medium truncate leading-tight">{agentName}</span>
        </div>
        <p className="text-xs text-muted-foreground truncate opacity-70">{agent.id}</p>
      </div>

      {isActive && (
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      )}
    </button>
  );
}

// ─── New chat dialog ──────────────────────────────────────────────────────────

function NewChatDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new session key once the user confirms. */
  onCreated: (sessionKey: string) => void;
}) {
  const { data, loading } = useAgents();
  const agents: Agent[] = data?.agents ?? [];
  const defaultId = data?.defaultId ?? "";

  const [selectedId, setSelectedId] = useState<string>("");
  const [search, setSearch] = useState("");

  // Pre-select the default agent when the dialog opens
  useEffect(() => {
    if (open && defaultId && !selectedId) {
      setSelectedId(defaultId);
    }
  }, [open, defaultId, selectedId]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setSearch("");
      setSelectedId("");
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return agents;
    return agents.filter((a) => {
      const name = (a.identity?.name ?? a.name ?? a.id).toLowerCase();
      return name.includes(q) || a.id.toLowerCase().includes(q);
    });
  }, [agents, search]);

  const handleCreate = () => {
    if (!selectedId) return;
    // Build a unique session key: agent:<agentId>:<uuid-short>
    // crypto.randomUUID() requires a secure context (HTTPS); fall back to
    // Math.random-based generation when running over plain HTTP.
    const generateUid = () => {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
      }
      // Fallback: generate a 12-char hex string
      return Array.from({ length: 12 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join("");
    };
    const uid = generateUid();
    const newKey = `agent:${selectedId}:chat-${uid}`;
    onCreated(newKey);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Chat</DialogTitle>
          <DialogDescription>
            Choose an agent to start a new conversation with.
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents…"
            className="pl-8 h-9 text-sm"
            autoFocus
          />
        </div>

        {/* Agent list */}
        <ScrollArea className="max-h-64 -mx-1 px-1">
          {loading && agents.length === 0 && (
            <div className="space-y-2 py-1">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-2 py-2">
                  <Skeleton className="w-8 h-8 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-2.5 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
              <Bot className="w-7 h-7 opacity-30" />
              <p className="text-xs">{search ? "No agents found" : "No agents available"}</p>
            </div>
          )}

          <div className="space-y-0.5 py-1">
            {filtered.map((agent) => {
              const name = agent.identity?.name ?? agent.name ?? agent.id;
              const avatarUrl = agent.identity?.avatarUrl;
              const emoji = agent.identity?.emoji;
              const isSelected = agent.id === selectedId;
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => setSelectedId(agent.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors cursor-pointer",
                    "hover:bg-accent/60",
                    isSelected && "bg-accent"
                  )}
                >
                  {/* Agent avatar UI with real avatar/emoji */}
                  <AgentAvatar
                    agentId={agent.id}
                    agentName={name}
                    avatarUrl={avatarUrl}
                    emoji={emoji}
                    size="sm"
                  />

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{name}</p>
                    <p className="text-xs text-muted-foreground truncate">{agent.id}</p>
                  </div>

                  {isSelected && (
                    <Check className="w-4 h-4 text-primary shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </ScrollArea>

        <Separator />

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!selectedId}
            onClick={handleCreate}
          >
            Start Chat
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Agent sidebar ────────────────────────────────────────────────────────────

function AgentSidebar({
  currentAgentId,
  onSelect,
  onNewChat,
}: {
  currentAgentId: string;
  onSelect: (agentId: string) => void;
  onNewChat: () => void;
}) {
  const { data, loading } = useAgents();
  const agents = data?.agents ?? [];

  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return agents;
    return agents.filter((a) => {
      const name = (a.identity?.name ?? a.name ?? a.id).toLowerCase();
      return name.includes(q) || a.id.toLowerCase().includes(q);
    });
  }, [agents, search]);

  return (
    <div className="flex flex-col h-full border-r border-border bg-background w-72 shrink-0">
      {/* Sidebar header */}
      <div className="px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold">Agents</h2>
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8 shrink-0"
            onClick={onNewChat}
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents…"
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>

      {/* Agent list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-0.5">
          {loading && agents.length === 0 && (
            <div className="space-y-2 px-1 pt-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-2 py-2">
                  <Skeleton className="w-9 h-9 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-2.5 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
              <Bot className="w-8 h-8 opacity-30" />
              <p className="text-xs">{search ? "No agents found" : "No agents available"}</p>
            </div>
          )}

          {filtered.map((agent) => (
            <AgentItem
              key={agent.id}
              agent={agent}
              isActive={agent.id.toLowerCase() === currentAgentId.toLowerCase()}
              onClick={() => onSelect(agent.id)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Chat area header ─────────────────────────────────────────────────────────

function ChatHeader({
  session,
  agent,
  sessionKey,
  sessions = [],
  onSessionChange,
  onCreateSession,
}: {
  session: Session | undefined;
  agent?: Agent;
  sessionKey?: string;
  sessions?: Session[];
  onSessionChange?: (key: string) => void;
  onCreateSession?: () => void;
}) {
  const agentName = agent?.identity?.name ?? agent?.name ?? agent?.id ?? "";
  const agentId = agent?.id ?? (sessionKey ? parseAgentIdFromKey(sessionKey) : "");

  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border bg-background/95 backdrop-blur shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        {agent || agentId ? (
          <AgentAvatar
            agentId={agentId}
            agentName={agentName}
            avatarUrl={agent?.identity?.avatarUrl}
            emoji={agent?.identity?.emoji}
            size="md"
          />
        ) : (
          <div className="w-11 h-11 rounded-full bg-muted border border-border flex items-center justify-center shrink-0">
            <Bot className="w-5 h-5 text-muted-foreground" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold truncate">
              {agentName || agentId || "Select an agent"}
            </h2>
            {session && isAgentToAgent(session) && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5 gap-1">
                <Lock className="w-2.5 h-2.5" />
                Read-only
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {session ? (
              <>
                <Badge variant="outline" className="h-4 px-1 text-[10px] gap-0.5 font-normal">
                  <ChannelIcon session={session} />
                  {getChannelLabel(session)}
                </Badge>
                <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                  {session.derivedTitle || session.label || session.displayName || "Direct Chat"}
                </span>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">
                {agentId ? "No active session" : "Welcome back"}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Session Dropdown and New Button */}
      {agentId && (
        <div className="flex items-center gap-2">
          {sessions.length > 0 && (
            <Select value={sessionKey} onValueChange={onSessionChange}>
              <SelectTrigger className="w-[180px] h-9 text-xs focus:ring-0">
                <div className="flex items-center gap-2 truncate">
                  <History className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="Select session" />
                </div>
              </SelectTrigger>
              <SelectContent>
                {sessions.map((s, index) => {
                  const sessionNumber = sessions.length - index;
                  return (
                    <SelectItem key={s.key} value={s.key} className="text-xs">
                      <div className="flex gap-2 min-w-0 pr-6 justify-between items-center w-full">
                        <div className="truncate font-medium">
                          {`Session ${sessionNumber}`}
                        </div>
                        <div className="text-[10px] text-muted-foreground opacity-70">
                          ({formatTime(s.updatedAt)} ago)
                        </div>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          )}

          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-2 text-xs font-medium cursor-pointer bg-background"
            onClick={onCreateSession}
          >
            <Plus className="w-3.5 h-3.5" />
            New Chat
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  msg,
}: {
  msg: { id: string; role: "user" | "assistant"; content: string; status?: string };
}) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex gap-3", isUser ? "justify-end" : "justify-start")}>
      {/* Assistant avatar */}
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-primary/10 border border-border flex items-center justify-center shrink-0 mt-1">
          <Bot className="w-4 h-4 text-primary" />
        </div>
      )}

      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-secondary/50 text-foreground border border-border rounded-bl-sm"
        )}
      >
        {!isUser ? (
          <>
            {msg.content === "" && msg.status === "thinking" ? (
              <ThinkingLoader />
            ) : (
              <>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    p: ({ children }) => {
                      if (typeof children === "string") {
                        const trimmed = children.trim();
                        if (trimmed.startsWith("MEDIA:") || trimmed.startsWith("FILE:")) {
                          const filePath = trimmed.slice(trimmed.indexOf(":") + 1).trim();
                          const fileName = filePath.split("/").pop() || "download";
                          return (
                            <div className="my-2 p-3 rounded-lg border border-border bg-background/50 flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2 overflow-hidden">
                                <Paperclip className="w-4 h-4 text-muted-foreground shrink-0" />
                                <span className="text-xs font-mono truncate">{fileName}</span>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 gap-2 shrink-0"
                                asChild
                              >
                                <a href={`/api/containers/download?path=${encodeURIComponent(filePath)}`} target="_blank" rel="noopener noreferrer">
                                  Download
                                </a>
                              </Button>
                            </div>
                          );
                        }
                      }
                      return <p className="mb-2 last:mb-0">{children}</p>;
                    },
                    ul: ({ children }) => <ul className="mb-2 list-disc pl-5">{children}</ul>,
                    ol: ({ children }) => <ol className="mb-2 list-decimal pl-5">{children}</ol>,
                    li: ({ children }) => <li className="mb-1">{children}</li>,
                    a: ({ children, href }) => (
                      <a href={href} className="text-primary underline underline-offset-2 hover:opacity-80">
                        {children}
                      </a>
                    ),
                    code: ({ children }) => (
                      <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">{children}</code>
                    ),
                    blockquote: ({ children }) => (
                      <blockquote className="border-l-4 border-border pl-4 mb-2 italic text-muted-foreground">
                        {children}
                      </blockquote>
                    ),
                  }}
                >
                  {msg.content}
                </ReactMarkdown>
                {msg.status === "thinking" && <ThinkingLoader />}
              </>
            )}
            {msg.status === "error" && (
              <p className="text-xs text-destructive mt-1">⚠ Error occurred</p>
            )}
          </>
        ) : (
          <p>{msg.content}</p>
        )}
      </div>
    </div>
  );
}

// ─── Main ChatComponent ───────────────────────────────────────────────────────

export function ChatComponent({
  sessionKey,
  agentId: initialAgentId,
}: { sessionKey?: string; agentId?: string } = {}) {
  const { data: sessionsData } = useSessions(100);
  const sessions = sessionsData?.sessions ?? [];

  const { data: agentsData } = useAgents();
  const agentMap = useMemo<Map<string, Agent>>(() => {
    const map = new Map<string, Agent>();
    for (const a of agentsData?.agents ?? []) {
      map.set(a.id.toLowerCase(), a);
    }
    return map;
  }, [agentsData]);

  const [currentAgentId, setCurrentAgentId] = useState<string>("");
  const [currentSessionKey, setCurrentSessionKey] = useState(sessionKey || "main");
  const [isNewChatDialogOpen, setIsNewChatDialogOpen] = useState(false);

  // Sync with initialAgentId from props
  useEffect(() => {
    if (initialAgentId) {
      setCurrentAgentId(initialAgentId);
    } else if (!currentAgentId && agentsData?.defaultId) {
      setCurrentAgentId(agentsData.defaultId);
    }
  }, [initialAgentId, agentsData]);

  // When agentId or sessions change, ensure we are on a session for this agent
  useEffect(() => {
    if (!currentAgentId || sessions.length === 0) return;

    // Check if currentSessionKey belongs to currentAgentId
    if (parseAgentIdFromKey(currentSessionKey) !== currentAgentId.toLowerCase()) {
      // Find most recent session for this agent
      const match = sessions.find((s) => parseAgentIdFromKey(s.key) === currentAgentId.toLowerCase());
      if (match) {
        setCurrentSessionKey(match.key);
      } else {
        // No session found for this agent — open a new empty session for this agent
        if (currentAgentId.toLowerCase() === agentsData?.defaultId?.toLowerCase()) {
          const hasMain = sessions.some((s) => s.key === "main");
          if (hasMain) {
            setCurrentSessionKey("main");
            return;
          }
        }
        const generateUid = () => {
          if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
            return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
          }
          return Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
        };
        const newKey = `agent:${currentAgentId}:chat-${generateUid()}`;
        setCurrentSessionKey(newKey);
      }
    }
  }, [currentAgentId, sessions, agentsData]);

  // Sessions filtered for the current agent
  const agentSessions = useMemo(() => {
    if (!currentAgentId) return [];
    return sessions.filter((s) => parseAgentIdFromKey(s.key) === currentAgentId.toLowerCase() || (currentAgentId.toLowerCase() === agentsData?.defaultId?.toLowerCase() && s.key === "main"));
  }, [sessions, currentAgentId, agentsData]);

  const currentSession = sessions.find((s) => s.key === currentSessionKey);
  const currentAgent = agentMap.get(currentAgentId.toLowerCase());
  const readOnly = currentSession ? isAgentToAgent(currentSession) : false;

  const [value, setValue] = useState("");
  const [sendCount, setSendCount] = useState(0);
  const { messages, sendMessage, isLoading, historyLoaded } = useChatWs(currentSessionKey);
  const { textareaRef, adjustHeight } = useAutoResizeTextarea({ minHeight: 52, maxHeight: 200 });
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastScrolledAssistantIdRef = useRef<string | null>(null);

  // Auto-scroll only once when a new assistant message starts (similar to ChatGPT).
  // Streaming updates to the same message won't retrigger scrolling, so users
  // can freely scroll up while the response streams.
  useEffect(() => {
    if (!historyLoaded) return;
    const lastAssistant = messages.filter((m) => m.role === "assistant").at(-1);
    if (!lastAssistant) return;
    if (lastAssistant.id === lastScrolledAssistantIdRef.current) return;
    lastScrolledAssistantIdRef.current = lastAssistant.id;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, historyLoaded]);

  // Reset input when switching sessions
  useEffect(() => {
    setValue("");
    adjustHeight(true);
  }, [currentSessionKey, adjustHeight]);

  // Filter out internal system/browser control messages and tool result blobs
  const isHiddenMessage = (content: string) => {
    const trimmed = content.trimStart();
    // Browser control / security notice injected by openclaw
    if (trimmed.startsWith("SECURITY NOTICE:")) return true;
    if (trimmed.includes("<<<EXTERNAL_UNTRUSTED_CONTENT")) return true;
    // Tool result JSON blobs emitted by openclaw (e.g. {"status":"error","tool":"read",...})
    // They always start with '{' and contain a "tool" key
    if (trimmed.startsWith("{") && trimmed.includes('"tool"')) return true;
    // Tool result arrays (e.g. [{"status":...}])
    if (trimmed.startsWith("[") && trimmed.includes('"tool"')) return true;
    return false;
  };

  const visibleMessages = messages.filter((m) => {
    // Hide assistant messages that ended up with no visible content.
    // This commonly happens when the model only produced tool / QMD outputs
    // that are stripped out by the gateway / client filters.
    if (m.role === "assistant" && m.status !== "thinking" && !m.content.trim()) {
      return false;
    }
    return !isHiddenMessage(m.content);
  });

  // Last assistant content for browser preview
  const lastAssistantContent = messages.filter((m) => m.role === "assistant").at(-1)?.content ?? "";

  const handleSend = () => {
    if (!value.trim() || isLoading || readOnly) return;
    setSendCount((c) => c + 1);
    sendMessage(value.trim());
    setValue("");
    adjustHeight(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      <NewChatDialog
        open={isNewChatDialogOpen}
        onOpenChange={setIsNewChatDialogOpen}
        onCreated={(newKey) => {
          const newAgentId = parseAgentIdFromKey(newKey) || currentAgentId;
          if (newAgentId) {
            setCurrentAgentId(newAgentId);
          }
          setCurrentSessionKey(newKey);
        }}
      />
      <div className="flex h-full w-full overflow-hidden">
      {/* ── Sidebar ── */}
      <AgentSidebar
        currentAgentId={currentAgentId}
        onSelect={(id) => setCurrentAgentId(id)}
        onNewChat={() => setIsNewChatDialogOpen(true)}
      />

      {/* ── Main chat area ── */}
      <div className="flex flex-col flex-1 min-w-0 h-full">
        {/* Header */}
        <ChatHeader
          session={currentSession}
          agent={currentAgent}
          sessionKey={currentSessionKey}
          sessions={agentSessions}
          onSessionChange={(key) => setCurrentSessionKey(key)}
          onCreateSession={() => {
            const generateUid = () => {
              if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
                return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
              }
              return Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
            };
            const newKey = `agent:${currentAgentId}:chat-${generateUid()}`;
            setCurrentSessionKey(newKey);
          }}
        />

        {/* Messages */}
        <div className="flex-1 overflow-y-auto py-6 px-5 space-y-4">
          {!historyLoaded && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <Bot className="w-10 h-10 opacity-30 animate-pulse" />
              <p className="text-sm">Loading conversation…</p>
            </div>
          )}

          {historyLoaded && visibleMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <Bot className="w-10 h-10 opacity-30" />
              <p className="text-sm">
                {readOnly ? "No messages in this session" : "Send a message to start chatting"}
              </p>
            </div>
          )}

          {visibleMessages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}

          {/* Browser activity button / dialog */}
          <InlineBrowserPreview
            isAgentWorking={isLoading}
            streamingContent={lastAssistantContent}
            sendCount={sendCount}
          />

          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        {readOnly ? (
          <div className="shrink-0 px-5 pb-4 pt-2 border-t border-border">
            <div className="flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-border bg-muted/30 text-muted-foreground">
              <Lock className="w-4 h-4" />
              <span className="text-sm">This is an agent-to-agent session — read-only</span>
            </div>
          </div>
        ) : (
          <div className="shrink-0 px-5 pb-4 pt-2 bg-background border-t border-border">
            <div className="relative bg-secondary/30 rounded-xl border border-border">
              <Textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => { setValue(e.target.value); adjustHeight(); }}
                onKeyDown={handleKeyDown}
                placeholder="Ask your agent…"
                className={cn(
                  "w-full px-4 py-3 resize-none bg-transparent border-none",
                  "text-foreground text-sm focus:outline-none",
                  "focus-visible:ring-0 focus-visible:ring-offset-0",
                  "placeholder:text-muted-foreground/60 min-h-[52px]"
                )}
              />
              <div className="flex items-center justify-between px-3 pb-3">
                <button type="button" className="p-2 hover:bg-accent rounded-lg transition-colors cursor-pointer">
                  <Paperclip className="w-4 h-4 text-muted-foreground" />
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!value.trim() || isLoading}
                  className={cn(
                    "px-1.5 py-1.5 rounded-lg text-sm border border-border transition-colors cursor-pointer",
                    value.trim() && !isLoading
                      ? "bg-primary text-primary-foreground hover:opacity-90"
                      : "text-muted-foreground opacity-50 cursor-not-allowed"
                  )}
                >
                  <ArrowUpIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
