"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { AgentDebugInfo, DebugLogEntry } from "@/hooks/use-chat-ws";
import { Badge } from "@/components/ui/badge";
import { getAgentDebugContext } from "@/lib/api/agents";
import {
  Bug,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Wrench,
  Brain,
  MessageSquare,
  AlertTriangle,
  Zap,
  FileText,
  Server,
  BookOpen,
  RefreshCw,
  Database,
} from "lucide-react";

// ─── Sub-components ─────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function CollapsibleSection({
  title,
  icon,
  children,
  defaultOpen = false,
  badge,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string | number;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-border/30 last:border-b-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
      >
        {isOpen ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        {icon}
        <span>{title}</span>
        {badge !== undefined && (
          <Badge
            variant="secondary"
            className="ml-auto text-[10px] h-4 px-1.5"
          >
            {badge}
          </Badge>
        )}
      </button>
      {isOpen && (
        <div className="px-3 pb-2 text-xs text-muted-foreground">{children}</div>
      )}
    </div>
  );
}

// ─── Event type → style mapping ─────────────────────────────────────────────

function getEventIcon(type: DebugLogEntry["type"]) {
  switch (type) {
    case "debug":
      return <Server className="h-3 w-3 text-blue-400" />;
    case "content":
      return <MessageSquare className="h-3 w-3 text-green-400" />;
    case "toolCall":
      return <Wrench className="h-3 w-3 text-orange-400" />;
    case "thinkingContent":
      return <Brain className="h-3 w-3 text-purple-400" />;
    case "approvalRequest":
      return <AlertTriangle className="h-3 w-3 text-yellow-400" />;
    case "error":
      return <AlertTriangle className="h-3 w-3 text-red-400" />;
    case "browserAgentThinking":
      return <Zap className="h-3 w-3 text-cyan-400" />;
    case "system":
      return <FileText className="h-3 w-3 text-gray-400" />;
    default:
      return <FileText className="h-3 w-3 text-gray-400" />;
  }
}

function getEventBadgeColor(type: DebugLogEntry["type"]) {
  switch (type) {
    case "debug":
      return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    case "content":
      return "bg-green-500/10 text-green-400 border-green-500/20";
    case "toolCall":
      return "bg-orange-500/10 text-orange-400 border-orange-500/20";
    case "thinkingContent":
      return "bg-purple-500/10 text-purple-400 border-purple-500/20";
    case "approvalRequest":
      return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
    case "error":
      return "bg-red-500/10 text-red-400 border-red-500/20";
    case "browserAgentThinking":
      return "bg-cyan-500/10 text-cyan-400 border-cyan-500/20";
    case "system":
      return "bg-gray-500/10 text-gray-400 border-gray-500/20";
    default:
      return "bg-gray-500/10 text-gray-400 border-gray-500/20";
  }
}

// ─── Log Entry ──────────────────────────────────────────────────────────────

function LogEntry({ entry }: { entry: DebugLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const time = new Date(entry.timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  } as Intl.DateTimeFormatOptions);

  return (
    <div className="border-b border-border/20 last:border-b-0">
      <button
        onClick={() => entry.data !== undefined && setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-2 py-1.5 text-left hover:bg-muted/20 transition-colors"
      >
        {getEventIcon(entry.type)}
        <span className="text-[10px] text-muted-foreground/60 font-mono shrink-0">
          {time}
        </span>
        <span
          className={`text-[10px] font-medium border rounded px-1 py-0 shrink-0 ${getEventBadgeColor(
            entry.type
          )}`}
        >
          {entry.type}
        </span>
        <span className="text-[11px] text-muted-foreground truncate flex-1">
          {entry.summary}
        </span>
        {entry.data !== undefined ? (
          <span className="text-muted-foreground/40">
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </span>
        ) : null}
      </button>
      {expanded && entry.data !== undefined ? (
        <div className="px-2 pb-2">
          <div className="relative">
            <pre className="text-[10px] text-muted-foreground/80 bg-black/20 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto font-mono leading-relaxed">
              {JSON.stringify(entry.data, null, 2)}
            </pre>
            <div className="absolute top-1 right-1">
              <CopyButton text={JSON.stringify(entry.data, null, 2)} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Debug Info Panel (system prompt, tools, capabilities) ──────────────────

function DebugInfoSection({ info }: { info: AgentDebugInfo }) {
  return (
    <div className="space-y-0">
      {/* Agent & Model Info */}
      <CollapsibleSection
        title="Agent & Model"
        icon={<Server className="h-3 w-3" />}
        defaultOpen
      >
        <div className="space-y-1.5 mt-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground/60">Agent:</span>
            <span className="font-medium text-foreground">{info.agentName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground/60">Model:</span>
            <span className="font-mono text-foreground">{info.modelDisplayName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground/60">Model ID:</span>
            <span className="font-mono text-foreground/80">{info.modelId}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground/60">Temperature:</span>
            <span className="font-mono text-foreground">{info.temperature}</span>
          </div>
        </div>
      </CollapsibleSection>

      {/* System Prompt */}
      <CollapsibleSection
        title="System Prompt"
        icon={<FileText className="h-3 w-3" />}
        badge={`${info.systemPrompt.length} chars`}
      >
        <div className="relative mt-1">
          <pre className="text-[10px] text-muted-foreground/80 bg-black/20 rounded p-2 overflow-x-auto max-h-96 overflow-y-auto font-mono leading-relaxed whitespace-pre-wrap break-words">
            {info.systemPrompt}
          </pre>
          <div className="absolute top-1 right-1">
            <CopyButton text={info.systemPrompt} />
          </div>
        </div>
      </CollapsibleSection>

      {/* Tools */}
      <CollapsibleSection
        title="Tools"
        icon={<Wrench className="h-3 w-3" />}
        badge={info.tools.length}
      >
        <div className="mt-1 space-y-1">
          {info.tools.length === 0 ? (
            <span className="text-muted-foreground/40 italic">No tools</span>
          ) : (
            info.tools.map((tool, i) => (
              <div
                key={i}
                className="flex items-start gap-2 py-1 border-b border-border/10 last:border-b-0"
              >
                <Badge
                  variant="outline"
                  className={`text-[9px] shrink-0 mt-0.5 ${
                    tool.type === "agent"
                      ? "border-purple-500/30 text-purple-400"
                      : "border-orange-500/30 text-orange-400"
                  }`}
                >
                  {tool.type}
                </Badge>
                <div className="min-w-0">
                  <div className="font-mono font-medium text-foreground/90 text-[11px]">
                    {tool.name}
                  </div>
                  {tool.description && (
                    <div className="text-[10px] text-muted-foreground/60 truncate">
                      {tool.description}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </CollapsibleSection>

      {/* Capabilities Summary */}
      <CollapsibleSection
        title="Capabilities"
        icon={<Zap className="h-3 w-3" />}
      >
        <div className="mt-1 grid grid-cols-2 gap-1">
          {[
            { label: "KBs", value: info.capabilities.kbCount },
            { label: "Skills", value: info.capabilities.skillCount },
            { label: "Tools", value: info.capabilities.toolCount },
            { label: "MCP Servers", value: info.capabilities.mcpServerCount },
            { label: "Agents", value: info.capabilities.connectedAgentCount },
            { label: "Integrations", value: info.capabilities.composioIntegrationCount },
            { label: "Channels", value: info.capabilities.channelCount },
          ].map((cap) => (
            <div key={cap.label} className="flex justify-between py-0.5">
              <span className="text-muted-foreground/60">{cap.label}:</span>
              <span className={`font-mono ${cap.value > 0 ? "text-green-400" : "text-muted-foreground/40"}`}>
                {cap.value}
              </span>
            </div>
          ))}
          <div className="flex justify-between py-0.5">
            <span className="text-muted-foreground/60">Browser:</span>
            <span className={`font-mono ${info.capabilities.hasBrowser ? "text-green-400" : "text-muted-foreground/40"}`}>
              {info.capabilities.hasExtensionBrowser ? "extension" : info.capabilities.hasBrowser ? "cloud" : "none"}
            </span>
          </div>
          <div className="flex justify-between py-0.5">
            <span className="text-muted-foreground/60">System Access:</span>
            <span className={`font-mono ${info.capabilities.systemLevelAccess ? "text-yellow-400" : "text-muted-foreground/40"}`}>
              {info.capabilities.systemLevelAccess ? "yes" : "no"}
            </span>
          </div>
        </div>
      </CollapsibleSection>

      {/* KBs detail */}
      {info.kbs.length > 0 && (
        <CollapsibleSection
          title="Knowledge Bases"
          icon={<FileText className="h-3 w-3" />}
          badge={info.kbs.length}
        >
          <div className="mt-1 space-y-1">
            {info.kbs.map((kb, i) => (
              <div key={i} className="py-0.5">
                <span className="font-medium text-foreground/80">{kb.name}</span>
                <span className="text-muted-foreground/40 ml-1">({kb.documentCount} docs)</span>
                {kb.description && (
                  <div className="text-[10px] text-muted-foreground/50">{kb.description}</div>
                )}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Connected Agents */}
      {info.connectedAgents.length > 0 && (
        <CollapsibleSection
          title="Connected Agents"
          icon={<Brain className="h-3 w-3" />}
          badge={info.connectedAgents.length}
        >
          <div className="mt-1 space-y-1">
            {info.connectedAgents.map((a, i) => (
              <div key={i} className="py-0.5">
                <span className="font-medium text-foreground/80">{a.name}</span>
                <span className="text-muted-foreground/40 ml-1">({a.role})</span>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* MCP Servers */}
      {info.mcpServers.length > 0 && (
        <CollapsibleSection
          title="MCP Servers"
          icon={<Server className="h-3 w-3" />}
          badge={info.mcpServers.length}
        >
          <div className="mt-1 space-y-1">
            {info.mcpServers.map((mcp, i) => (
              <div key={i} className="py-0.5">
                <span className="font-medium text-foreground/80">{mcp.name}</span>
                <div className="text-[10px] text-muted-foreground/50">
                  Tools: {mcp.toolNames.join(", ")}
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}

// ─── Memory & Notebook Types ────────────────────────────────────────────────

interface DebugMemory {
  id: string;
  content: string;
  category: string;
  createdAt: string;
}

interface DebugNotebookEntry {
  key: string;
  value: string;
  description: string | null;
  updatedAt: string | null;
}

// ─── Memory & Notebook Section ──────────────────────────────────────────────

function MemoryNotebookSection({
  memories,
  notebook,
  loading,
  onRefresh,
}: {
  memories: DebugMemory[];
  notebook: DebugNotebookEntry[];
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-0">
      {/* Refresh button */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/30">
        <span className="text-[10px] text-muted-foreground/50">
          {loading ? "Loading..." : `${memories.length} memories, ${notebook.length} notebook entries`}
        </span>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
          title="Refresh"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Memories */}
      <CollapsibleSection
        title="Memories"
        icon={<Database className="h-3 w-3" />}
        badge={memories.length}
        defaultOpen
      >
        <div className="mt-1 space-y-1.5">
          {memories.length === 0 ? (
            <span className="text-muted-foreground/40 italic">No memories saved</span>
          ) : (
            memories.map((m) => (
              <div
                key={m.id}
                className="py-1.5 border-b border-border/10 last:border-b-0"
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Badge
                    variant="outline"
                    className="text-[9px] h-3.5 px-1 border-blue-500/30 text-blue-400"
                  >
                    {m.category}
                  </Badge>
                  <span className="text-[9px] text-muted-foreground/40">
                    {new Date(m.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
                <div className="text-[11px] text-foreground/80 leading-relaxed">
                  {m.content}
                </div>
              </div>
            ))
          )}
        </div>
      </CollapsibleSection>

      {/* Notebook */}
      <CollapsibleSection
        title="Notebook"
        icon={<BookOpen className="h-3 w-3" />}
        badge={notebook.length}
        defaultOpen
      >
        <div className="mt-1 space-y-1.5">
          {notebook.length === 0 ? (
            <span className="text-muted-foreground/40 italic">No notebook entries</span>
          ) : (
            notebook.map((entry) => (
              <div
                key={entry.key}
                className="py-1.5 border-b border-border/10 last:border-b-0"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-medium text-foreground/90 text-[11px]">
                    {entry.key}
                  </span>
                  {entry.updatedAt && (
                    <span className="text-[9px] text-muted-foreground/40">
                      {new Date(entry.updatedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-foreground/70 break-all">
                  {entry.value}
                </div>
                {entry.description && (
                  <div className="text-[10px] text-muted-foreground/50 mt-0.5">
                    {entry.description}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
}

// ─── Main Panel ─────────────────────────────────────────────────────────────

type Tab = "events" | "info" | "context";

export function DebugLogPanel({
  debugInfo,
  debugLogs,
  agentId,
  workspaceId,
}: {
  debugInfo: AgentDebugInfo | null;
  debugLogs: DebugLogEntry[];
  agentId?: string;
  workspaceId?: string;
}) {
  const [activeTab, setActiveTab] = useState<Tab>("events");
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Memory & notebook state
  const [memories, setMemories] = useState<DebugMemory[]>([]);
  const [notebook, setNotebook] = useState<DebugNotebookEntry[]>([]);
  const [contextLoading, setContextLoading] = useState(false);

  const fetchContext = useCallback(async () => {
    if (!agentId || !workspaceId) return;
    setContextLoading(true);
    try {
      const data = await getAgentDebugContext(workspaceId, agentId);
      setMemories(data.memories);
      setNotebook(data.notebook);
    } catch {
      // silently fail
    } finally {
      setContextLoading(false);
    }
  }, [agentId, workspaceId]);

  // Auto-fetch when switching to context tab
  useEffect(() => {
    if (activeTab === "context" && agentId && workspaceId && memories.length === 0 && notebook.length === 0) {
      fetchContext();
    }
  }, [activeTab, agentId, workspaceId, fetchContext]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [debugLogs]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center px-3 py-2 border-b border-border/50 bg-muted/20 shrink-0">
        <div className="flex items-center gap-2">
          <Bug className="h-3.5 w-3.5 text-orange-400" />
          <span className="text-xs font-semibold text-foreground">Debug Log</span>
          <Badge
            variant="outline"
            className="text-[9px] h-4 px-1 border-orange-500/30 text-orange-400"
          >
            {debugLogs.length}
          </Badge>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border/50">
        <button
          onClick={() => setActiveTab("events")}
          className={`flex-1 text-xs py-1.5 font-medium transition-colors ${
            activeTab === "events"
              ? "text-foreground border-b-2 border-orange-400"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Events ({debugLogs.length})
        </button>
        <button
          onClick={() => setActiveTab("info")}
          className={`flex-1 text-xs py-1.5 font-medium transition-colors ${
            activeTab === "info"
              ? "text-foreground border-b-2 border-orange-400"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Agent Info
        </button>
        <button
          onClick={() => setActiveTab("context")}
          className={`flex-1 text-xs py-1.5 font-medium transition-colors ${
            activeTab === "context"
              ? "text-foreground border-b-2 border-orange-400"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Memory
        </button>
      </div>

      {/* Content */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto min-h-0"
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
          autoScrollRef.current = atBottom;
        }}
      >
        {activeTab === "events" && (
          <div className="divide-y divide-border/10">
            {debugLogs.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-xs text-muted-foreground/40">
                No events yet. Send a message to see logs.
              </div>
            ) : (
              debugLogs.map((entry) => (
                <LogEntry key={entry.id} entry={entry} />
              ))
            )}
          </div>
        )}

        {activeTab === "info" && (
          <div>
            {debugInfo ? (
              <DebugInfoSection info={debugInfo} />
            ) : (
              <div className="flex items-center justify-center h-32 text-xs text-muted-foreground/40">
                No agent info yet. Send a message to load.
              </div>
            )}
          </div>
        )}

        {activeTab === "context" && (
          <MemoryNotebookSection
            memories={memories}
            notebook={notebook}
            loading={contextLoading}
            onRefresh={fetchContext}
          />
        )}
      </div>
    </div>
  );
}
