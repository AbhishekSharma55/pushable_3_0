'use client';

import { useEffect, useState, useCallback, useRef, Fragment, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
    Bot,
    Plus,
    Trash2,
    Pencil,
    Sparkles,
    Send,
    Search,
    Loader2,
    MessageSquare,
    Settings,
    ChevronDown,
    Clock,
    ArrowUp,
    Shield,
    Cpu,
    Thermometer,
    Download,
    Eye,
    Monitor,
    Square,
    Globe,
    Play,
    Cloud,
    Chrome,
    ChevronRight,
    Bug,
    Paperclip,
    X,
    FileText,
    Image as ImageIcon,
    DollarSign,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CreateAgentSheet } from '@/components/agents/create-agent-sheet';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import { getAgents, deleteAgent, updateAgent } from '@/lib/api/agents';
import { getSessions, createSession, getMessages, deleteSession } from '@/lib/api/sessions';
import { API_URL, LOGGING_ENABLED } from '@/lib/constants';
import { DebugLogPanel } from '@/components/chat/debug-log-panel';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import type { AgentDebugInfo, DebugLogEntry } from '@/hooks/use-chat-ws';
import { getToken } from '@/lib/auth';
import { parseArtifact, parseAllArtifacts, detectStreamingArtifact } from '@/lib/artifact-parser';
import type { Artifact } from '@/lib/artifact-parser';
import { ArtifactPanel, FileIcon } from '@/components/artifact';
import { downloadArtifact } from '@/lib/artifact-download';

/**
 * Strip tool-call XML that LLMs sometimes embed in text responses.
 * This is a frontend safety net — the backend also strips these,
 * but defense-in-depth ensures nothing leaks to the UI.
 */
const TOOL_TAG_NAMES = [
    'function_calls', 'function_call', 'tool_calls', 'tool_call',
    'tool_use', 'antml:invoke', 'antml:function_calls', 'antml_invoke', 'invoke',
];
const _esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const COMPLETE_BLOCK_RE = new RegExp(TOOL_TAG_NAMES.map(t => `<${_esc(t)}[^>]*>[\\s\\S]*?<\\/${_esc(t)}>`).join('|'), 'gi');
const ORPHANED_OPEN_RE = new RegExp(TOOL_TAG_NAMES.map(t => `<${_esc(t)}[^>]*>[\\s\\S]*$`).join('|'), 'gi');
const STRAY_TAG_RE = new RegExp(TOOL_TAG_NAMES.map(t => `<\\/?${_esc(t)}[^>]*>`).join('|'), 'gi');
const JSON_TOOL_ARRAY_RE = /\[\s*\{\s*"tool_name"\s*:\s*"[^"]*"[\s\S]*?\}\s*\]/g;
const PARTIAL_TAG_END_RE = /<(?:func(?:tion)?_?c?a?l?l?s?|tool_?(?:c(?:a(?:l(?:ls?)?)?)?|u(?:se?)?)?|antml?:?(?:i(?:n(?:v(?:o(?:ke?)?)?)?)?)?)\s*$/i;

function stripToolCallXml(text: string): string {
    if (!text) return text;
    let cleaned = text;
    cleaned = cleaned.replace(COMPLETE_BLOCK_RE, '');
    cleaned = cleaned.replace(ORPHANED_OPEN_RE, '');
    cleaned = cleaned.replace(STRAY_TAG_RE, '');
    cleaned = cleaned.replace(JSON_TOOL_ARRAY_RE, '');
    cleaned = cleaned.replace(PARTIAL_TAG_END_RE, '');
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
    return cleaned;
}

import { getProfiles, startSession as startBrowserSession, endSession as endBrowserSession, updateProfile, getProxies, getSessions as getBrowserSessions } from '@/lib/api/browser';
import { getBrowserSession } from '@/lib/api/sessions';
import { BrowserPreview } from '@/components/browser/browser-preview';
import { ExtensionLiveView } from '@/components/extension/ExtensionLiveView';
import { BROWSER_WS_URL } from '@/lib/constants';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Agent, Session, Message, BrowserProfile, BrowserProxy, BrowserSession, LLMModel } from '@/types';
import { getAllModels } from '@/lib/api/models';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { ToolCallDisplay } from '@/components/chat/tool-call-display';
import { ApprovalCard } from '@/components/chat/approval-card';
import { TextShimmer } from '@/components/ui/text-shimmer';

interface ToolCallEvent {
    id: string;
    name: string;
    args?: string;
    fullArgs?: Record<string, unknown>;
    type: 'tool' | 'agent';
    status: 'running' | 'done' | 'pending_approval' | 'approved' | 'rejected';
    result?: string;
}

// Confirmation format (new — agent asks a question) or legacy tool-calls format
type ApprovalRequest =
    | { type: 'confirmation'; question: string; context?: string }
    | { toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> };

// Ordered sequence of content and tool call events for interleaved rendering
type ChatSegment =
    | { type: 'text'; content: string }
    | { type: 'tools'; toolCalls: ToolCallEvent[] };

interface MessageCost {
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
}

interface ChatMessage extends Message {
    isStreaming?: boolean;
    toolCalls?: ToolCallEvent[];
    segments?: ChatSegment[];
    approvalRequest?: ApprovalRequest;
    thinking?: string;
    helperText?: string;
    cost?: MessageCost;
}

type ViewMode = 'chat' | 'settings';

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

export default function AgentsPage() {
    const workspace = useActiveWorkspace();
    const router = useRouter();
    const searchParams = useSearchParams();
    const agentIdParam = searchParams.get('agent');
    const sessionIdParam = searchParams.get('session');

    // Helper to update URL query params without full navigation
    const updateParams = useCallback((updates: Record<string, string | null>) => {
        const url = new URL(window.location.href);
        for (const [key, value] of Object.entries(updates)) {
            if (value) {
                url.searchParams.set(key, value);
            } else {
                url.searchParams.delete(key);
            }
        }
        router.replace(url.pathname + url.search, { scroll: false });
    }, [router]);

    // Agent list state
    const [agents, setAgents] = useState<Agent[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [editAgent, setEditAgent] = useState<Agent | null>(null);
    const [agentSearch, setAgentSearch] = useState('');
    const [viewMode, setViewMode] = useState<ViewMode>('chat');

    // Chat state
    const [sessions, setSessions] = useState<Session[]>([]);
    const [activeSession, setActiveSession] = useState<Session | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [loadingSessions, setLoadingSessions] = useState(false);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [sending, setSending] = useState(false);
    const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null);
    const [pendingApproval, setPendingApproval] = useState<{ msgId: string; request: ApprovalRequest } | null>(null);

    // Debug log state (only used when NEXT_PUBLIC_LOGGING=true)
    const [debugInfo, setDebugInfo] = useState<AgentDebugInfo | null>(null);
    const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
    const [showDebugPanel, setShowDebugPanel] = useState(false);
    const debugLogId = useCallback(() => `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, []);

    // Session cost (sum of all assistant message costs, logging only)
    const sessionCost = useMemo(() => {
        if (!LOGGING_ENABLED) return 0;
        return messages.reduce((sum, m) => sum + (m.cost?.totalCost ?? 0), 0);
    }, [messages]);

    // Browser preview state
    const [browserProfile, setBrowserProfile] = useState<BrowserProfile | null>(null);
    const [browserWsUrl, setBrowserWsUrl] = useState<string | null>(null);
    const [browserSessionId, setBrowserSessionId] = useState<string | null>(null);
    const [startingBrowser, setStartingBrowser] = useState(false);
    const [showBrowserPreview, setShowBrowserPreview] = useState(false);
    const browserDismissedRef = useRef(false);

    // Browser settings state
    const [proxies, setProxies] = useState<BrowserProxy[]>([]);
    const [activeBrowserSession, setActiveBrowserSession] = useState<BrowserSession | null>(null);
    const [savingBrowserSettings, setSavingBrowserSettings] = useState(false);

    // Session deletion state
    const [sessionToDelete, setSessionToDelete] = useState<Session | null>(null);
    const [deletingSession, setDeletingSession] = useState(false);

    // Models (for direct API indicator)
    const [llmModels, setLlmModels] = useState<LLMModel[]>([]);

    // File attachment state
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [isDragOver, setIsDragOver] = useState(false);
    const dragCounterRef = useRef(0);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const ACCEPTED_EXTENSIONS = ".png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.txt,.md,.csv";

    const addFiles = useCallback((files: FileList | File[]) => {
        const newFiles = Array.from(files).filter((f) => {
            const ext = f.name.toLowerCase().match(/\.[^.]+$/)?.[0] || "";
            const allowed = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".docx", ".txt", ".md", ".csv"];
            return allowed.includes(ext) && f.size <= 20 * 1024 * 1024;
        });
        setPendingFiles((prev) => [...prev, ...newFiles].slice(0, 10));
    }, []);

    const removeFile = useCallback((index: number) => {
        setPendingFiles((prev) => prev.filter((_, i) => i !== index));
    }, []);

    // Use a counter to handle dragenter/dragleave across child elements.
    // dragenter increments, dragleave decrements. Only show overlay when > 0.
    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        dragCounterRef.current++;
        if (dragCounterRef.current === 1) {
            setIsDragOver(true);
        }
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        dragCounterRef.current--;
        if (dragCounterRef.current === 0) {
            setIsDragOver(false);
        }
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        dragCounterRef.current = 0;
        setIsDragOver(false);
        if (e.dataTransfer.files.length > 0) {
            addFiles(e.dataTransfer.files);
        }
    }, [addFiles]);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const reconnectAbortRef = useRef<AbortController | null>(null);

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    // Fetch agents
    const fetchAgents = useCallback(async () => {
        if (!workspace) return;
        try {
            setLoading(true);
            const data = await getAgents(workspace.id);
            setAgents(data);
            // Auto-select agent from URL param, or default to CEO
            if (agentIdParam) {
                const found = data.find((a: Agent) => a.id === agentIdParam);
                if (found) setSelectedAgent(found);
            } else {
                const ceo = data.find((a: Agent) => a.isCeo);
                if (ceo) {
                    setSelectedAgent(ceo);
                    updateParams({ agent: ceo.id });
                }
            }
        } catch {
            toast.error('Failed to load agents');
        } finally {
            setLoading(false);
        }
    }, [workspace]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { fetchAgents(); }, [fetchAgents]);

    // Fetch models for direct API indicator
    useEffect(() => {
        if (!workspace) return;
        getAllModels(workspace.id).then(setLlmModels).catch(() => {});
    }, [workspace]);

    // Fetch sessions when agent changes — auto-open last session
    useEffect(() => {
        if (!workspace || !selectedAgent) {
            setSessions([]);
            setActiveSession(null);
            setMessages([]);
            return;
        }
        const fetch = async () => {
            try {
                setLoadingSessions(true);
                const data = await getSessions(workspace.id, selectedAgent.id);
                setSessions(data);

                if (data.length > 0) {
                    // Try to restore session from URL param, otherwise pick the most recent
                    const fromParam = sessionIdParam ? data.find((s: Session) => s.id === sessionIdParam) : null;
                    if (fromParam) {
                        setActiveSession(fromParam);
                    } else {
                        const sorted = [...data].sort((a: Session, b: Session) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                        const lastSession = sorted[0];
                        setActiveSession(lastSession);
                        updateParams({ session: lastSession.id });
                    }
                } else {
                    setActiveSession(null);
                    setMessages([]);
                    updateParams({ session: null });
                }
            } catch {
                toast.error('Failed to load sessions');
            } finally {
                setLoadingSessions(false);
            }
        };
        fetch();
    }, [workspace, selectedAgent]); // eslint-disable-line react-hooks/exhaustive-deps

    // Load messages when session changes
    useEffect(() => {
        // Abort any in-flight reconnection from a previous session
        reconnectAbortRef.current?.abort();
        reconnectAbortRef.current = null;

        if (!workspace || !activeSession) {
            setMessages([]);
            setPendingApproval(null);
            setDebugInfo(null);
            setDebugLogs([]);
            return;
        }
        const load = async () => {
            try {
                setLoadingMessages(true);
                const data = await getMessages(workspace.id, activeSession.id);
                // Hydrate tool calls, segments, and approvalRequest from metadata
                const hydrated: ChatMessage[] = data.map((msg: ChatMessage & { metadata?: Record<string, unknown> }) => {
                    const meta = msg.metadata as Record<string, unknown> | undefined;
                    if (meta && msg.role === 'assistant') {
                        return {
                            ...msg,
                            toolCalls: (meta.toolCalls as ToolCallEvent[] | undefined) || undefined,
                            segments: (meta.segments as ChatSegment[] | undefined) || undefined,
                            approvalRequest: (meta.approvalRequest as ApprovalRequest | undefined) || undefined,
                            thinking: (meta.thinking as string | undefined) || undefined,
                            cost: (meta.cost as MessageCost | undefined) || undefined,
                        };
                    }
                    return msg;
                });
                setMessages(hydrated);

                // Check for active run (handles page refresh / tab switch during execution)
                const token = getToken();
                const runRes = await fetch(`${API_URL}/api/sessions/${activeSession.id}/active-run`, {
                    headers: { Authorization: `Bearer ${token}`, 'x-workspace-id': workspace.id },
                });
                const runData = await runRes.json();
                if (runData.data) {
                    const runStatus = runData.data.status as string;

                    if (runStatus === 'in_progress' || runStatus === 'queued') {
                        // Reconnect to an in-progress run: show snapshot immediately,
                        // then resume SSE streaming for live updates.
                        const snapshot = runData.data.streamingState as {
                            content: string;
                            toolCalls: ToolCallEvent[];
                            thinking: string;
                            eventCount: number;
                        } | null | undefined;

                        const assistantMsgId = `reconnect-${Date.now()}`;
                        const snapshotSegments: ChatSegment[] = [];
                        if (snapshot?.toolCalls?.length) {
                            snapshotSegments.push({ type: 'tools', toolCalls: snapshot.toolCalls });
                        }
                        if (snapshot?.content) {
                            snapshotSegments.push({ type: 'text', content: snapshot.content });
                        }

                        const assistantMsg: ChatMessage = {
                            id: assistantMsgId,
                            sessionId: activeSession.id,
                            role: 'assistant',
                            content: snapshot?.content ?? '',
                            tokenCount: 0,
                            createdAt: new Date().toISOString(),
                            isStreaming: true,
                            toolCalls: snapshot?.toolCalls ?? [],
                            segments: snapshotSegments,
                            thinking: snapshot?.thinking ?? undefined,
                        };
                        setMessages([...hydrated, assistantMsg]);
                        setSending(true);
                        sseDeliveredRef.current = false;

                        // Abort any previous reconnection
                        reconnectAbortRef.current?.abort();
                        const abortController = new AbortController();
                        reconnectAbortRef.current = abortController;

                        const runId = runData.data.id as string;
                        const sseUrl = snapshot?.eventCount
                            ? `${API_URL}/api/runs/${runId}/events?from=${snapshot.eventCount}`
                            : `${API_URL}/api/runs/${runId}/events`;

                        // Start polling fallback
                        pollForCompletion(activeSession.id, assistantMsgId, abortController.signal).catch(() => {});

                        // Reconnect SSE (with offset to skip already-seen events)
                        readSSE(
                            sseUrl,
                            { Authorization: `Bearer ${token}`, 'x-workspace-id': workspace.id },
                            assistantMsgId,
                            abortController.signal,
                            snapshot?.eventCount ? { fullContent: snapshot.content, segments: snapshotSegments } : undefined
                        ).then(() => {
                            abortController.abort(); // Stop polling — SSE delivered
                        }).catch(() => {
                            // SSE failed — polling will deliver
                        }).finally(() => {
                            setSending(false);
                        });
                    } else if (runStatus === 'interrupted') {
                        // Restore approval state: find the last assistant message with approvalRequest
                        const approvalMsg = [...hydrated].reverse().find((m) => m.approvalRequest);
                        if (approvalMsg?.approvalRequest) {
                            setPendingApproval({ msgId: approvalMsg.id, request: approvalMsg.approvalRequest });
                        } else {
                            // Fallback: approvalRequest wasn't persisted in message metadata.
                            // Show a generic confirmation card on the last assistant message.
                            const lastAssistant = [...hydrated].reverse().find((m) => m.role === 'assistant');
                            if (lastAssistant) {
                                const fallbackRequest: ApprovalRequest = {
                                    type: 'confirmation',
                                    question: 'This action requires your approval to proceed.',
                                };
                                lastAssistant.approvalRequest = fallbackRequest;
                                setMessages([...hydrated]);
                                setPendingApproval({ msgId: lastAssistant.id, request: fallbackRequest });
                            }
                        }
                    }
                }
            } catch {
                toast.error('Failed to load messages');
            } finally {
                setLoadingMessages(false);
            }
        };
        load();
    }, [workspace, activeSession]);

    useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
        }
    }, [chatInput]);

    const handleDelete = async (id: string) => {
        if (!workspace) return;
        try {
            await deleteAgent(workspace.id, id);
            toast.success('Agent deleted');
            if (selectedAgent?.id === id) { setSelectedAgent(null); updateParams({ agent: null, session: null }); }
            fetchAgents();
        } catch {
            toast.error('Failed to delete agent');
        }
    };

    const handleSelectAgent = (agent: Agent) => {
        setSelectedAgent(agent);
        setViewMode('chat');
        updateParams({ agent: agent.id, session: null });
    };

    const handleNewSession = async () => {
        if (!workspace || !selectedAgent) return;
        try {
            const session = await createSession(workspace.id, selectedAgent.id, `Chat ${sessions.length + 1}`);
            setSessions((prev) => [...prev, session]);
            setActiveSession(session);
            updateParams({ session: session.id });
        } catch {
            toast.error('Failed to create session');
        }
    };

    const handleDeleteSession = async () => {
        if (!workspace || !selectedAgent || !sessionToDelete) return;
        try {
            setDeletingSession(true);
            await deleteSession(workspace.id, selectedAgent.id, sessionToDelete.id);
            setSessions((prev) => prev.filter((s) => s.id !== sessionToDelete.id));
            if (activeSession?.id === sessionToDelete.id) {
                setActiveSession(null);
                setMessages([]);
                updateParams({ session: null });
            }
            toast.success('Session deleted');
        } catch {
            toast.error('Failed to delete session');
        } finally {
            setDeletingSession(false);
            setSessionToDelete(null);
        }
    };

    // Fetch browser profile, proxies, and active session for selected agent
    useEffect(() => {
        if (!workspace || !selectedAgent) {
            setBrowserProfile(null);
            setProxies([]);
            setActiveBrowserSession(null);
            return;
        }
        // Fetch profiles
        getProfiles(workspace.id)
            .then((profiles) => {
                const assigned = profiles.find(
                    (p) => p.assignedAgentId === selectedAgent.id && p.status === 'active'
                );
                setBrowserProfile(assigned || null);
                // Find active session for this profile
                if (assigned) {
                    getBrowserSessions(workspace.id)
                        .then((sessions) => {
                            const active = sessions.find(
                                (s) => s.profileId === assigned.id && s.status === 'active'
                            );
                            setActiveBrowserSession(active || null);
                        })
                        .catch(() => {});
                } else {
                    setActiveBrowserSession(null);
                }
            })
            .catch(() => {});
        // Fetch proxies
        getProxies(workspace.id)
            .then(setProxies)
            .catch(() => {});
    }, [workspace, selectedAgent]);

    // Reset browser state when agent changes
    useEffect(() => {
        setBrowserWsUrl(null);
        setBrowserSessionId(null);
        setShowBrowserPreview(false);
        browserDismissedRef.current = false;
    }, [selectedAgent]);

    // Auto-open browser panel when agent uses browser tools
    useEffect(() => {
        if (!workspace || !activeSession || !selectedAgent) return;
        // User manually hid the browser — don't re-open
        if (browserDismissedRef.current) return;

        // Check if any message has browser-related tool calls
        const hasBrowserTool = messages.some((m) =>
            m.toolCalls?.some((tc) =>
                tc.name?.toLowerCase().includes('browser')
            )
        );
        if (!hasBrowserTool) return;

        // For extension type: just show the extension preview panel
        if (selectedAgent.browserType === 'extension') {
            if (!showBrowserPreview) {
                setShowBrowserPreview(true);
            }
            return;
        }

        // For cloud type: poll for browser session
        // Already showing browser — no need to poll
        if (showBrowserPreview && browserWsUrl) return;

        let cancelled = false;

        const fetchBrowserSession = async () => {
            try {
                const data = await getBrowserSession(workspace.id, activeSession.id);
                if (cancelled || !data) return;
                setBrowserSessionId(data.sessionId);
                setBrowserWsUrl(`${BROWSER_WS_URL}/ws/${data.sessionId}`);
                setShowBrowserPreview(true);
            } catch {
                // Browser session not ready yet — will retry
            }
        };

        // Poll quickly until browser session is found
        fetchBrowserSession();
        const interval = setInterval(fetchBrowserSession, 1000);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [workspace, activeSession, selectedAgent, messages, showBrowserPreview, browserWsUrl]);

    const handleStartBrowser = async () => {
        if (!workspace || !browserProfile || !selectedAgent) return;
        setStartingBrowser(true);
        try {
            const { sessionId, wsUrl } = await startBrowserSession(
                workspace.id,
                browserProfile.id,
                selectedAgent.id,
                selectedAgent.browserProxyId || undefined
            );
            setBrowserSessionId(sessionId);
            setBrowserWsUrl(wsUrl);
            setShowBrowserPreview(true);
            browserDismissedRef.current = false;
        } catch {
            toast.error('Failed to start browser session');
        } finally {
            setStartingBrowser(false);
        }
    };

    const handleStopBrowser = async () => {
        if (!workspace || !browserSessionId) return;
        try {
            await endBrowserSession(workspace.id, browserSessionId);
        } catch {
            // ignore
        }
        setBrowserWsUrl(null);
        setBrowserSessionId(null);
        setShowBrowserPreview(false);
    };

    // ── Browser settings handlers ─────────────────────────────────────────────

    const handleChangeBrowserType = async (type: 'cloud' | 'extension') => {
        if (!workspace || !selectedAgent) return;
        setSavingBrowserSettings(true);
        try {
            const updated = await updateAgent(workspace.id, selectedAgent.id, { browserType: type });
            setSelectedAgent(updated);
            setAgents((prev) => prev.map((a) => a.id === updated.id ? updated : a));
            // Reset browser state when switching types
            setBrowserWsUrl(null);
            setBrowserSessionId(null);
            setShowBrowserPreview(false);
            browserDismissedRef.current = false;
            toast.success(`Browser type set to ${type === 'cloud' ? 'Cloud' : 'Extension'}`);
        } catch {
            toast.error('Failed to update browser type');
        } finally {
            setSavingBrowserSettings(false);
        }
    };

    const handleChangeFingerprint = async (os: string) => {
        if (!workspace || !selectedAgent) return;
        setSavingBrowserSettings(true);
        try {
            if (browserProfile) {
                await updateProfile(workspace.id, browserProfile.id, { os: os as 'windows' | 'macos' | 'linux' });
                setBrowserProfile({ ...browserProfile, os });
            }
            toast.success('Fingerprint updated');
        } catch {
            toast.error('Failed to update fingerprint');
        } finally {
            setSavingBrowserSettings(false);
        }
    };

    const handleChangeProxy = async (proxyId: string) => {
        if (!workspace || !selectedAgent) return;
        setSavingBrowserSettings(true);
        try {
            const value = proxyId === '__auto__' ? null : proxyId;
            const updated = await updateAgent(workspace.id, selectedAgent.id, { browserProxyId: value });
            setSelectedAgent(updated);
            // Update the agent in list too
            setAgents((prev) => prev.map((a) => a.id === updated.id ? updated : a));
            toast.success(value ? 'Proxy updated' : 'Proxy set to auto-select');
        } catch {
            toast.error('Failed to update proxy');
        } finally {
            setSavingBrowserSettings(false);
        }
    };

    const handleStartBrowserSession = async () => {
        if (!workspace || !selectedAgent) return;
        setStartingBrowser(true);
        try {
            // Ensure browser profile exists
            let profile = browserProfile;
            if (!profile) {
                const profiles = await getProfiles(workspace.id);
                profile = profiles.find((p) => p.assignedAgentId === selectedAgent.id && p.status === 'active') || null;
            }
            if (!profile) {
                toast.error('No browser profile found. Send a message first to auto-create one.');
                return;
            }
            const { sessionId, wsUrl } = await startBrowserSession(
                workspace.id,
                profile.id,
                selectedAgent.id,
                selectedAgent.browserProxyId || undefined
            );
            setBrowserSessionId(sessionId);
            setBrowserWsUrl(wsUrl);
            setShowBrowserPreview(true);
            setActiveBrowserSession({ id: sessionId, workspaceId: workspace.id, profileId: profile.id, agentId: selectedAgent.id, status: 'active', createdAt: new Date().toISOString(), closedAt: null });
            setViewMode('chat');
        } catch {
            toast.error('Failed to start browser session');
        } finally {
            setStartingBrowser(false);
        }
    };

    const handleEndBrowserSession = async () => {
        if (!workspace) return;
        const sessId = browserSessionId || activeBrowserSession?.id;
        if (!sessId) return;
        try {
            await endBrowserSession(workspace.id, sessId);
        } catch {
            // ignore
        }
        setBrowserWsUrl(null);
        setBrowserSessionId(null);
        setShowBrowserPreview(false);
        setActiveBrowserSession(null);
        toast.success('Browser session ended');
    };

    // ── SSE reader helper ─────────────────────────────────────────────────────
    const readSSE = async (
        url: string,
        headers: Record<string, string>,
        assistantMsgId: string,
        signal: AbortSignal,
        initialState?: { fullContent: string; segments: ChatSegment[] }
    ) => {
        const response = await fetch(url, { headers, signal });
        if (!response.ok || !response.body) throw new Error(`SSE failed: ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = initialState?.fullContent ?? '';
        const segments: ChatSegment[] = initialState?.segments ? [...initialState.segments] : [];
        let lastSegmentType: 'text' | 'tools' | null = segments.length > 0 ? segments[segments.length - 1].type : null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]') {
                    setMessages((prev) => prev.map((m) => m.id === assistantMsgId ? { ...m, content: fullContent, isStreaming: false, segments: [...segments] } : m));
                    continue;
                }
                try {
                    const parsed = JSON.parse(data);
                    // Debug logging
                    if (LOGGING_ENABLED) {
                        if (parsed.debug) {
                            const info = parsed.debug as AgentDebugInfo;
                            setDebugInfo(info);
                            setDebugLogs((prev) => [...prev, { id: debugLogId(), timestamp: Date.now(), type: 'debug', summary: `Agent "${info.agentName}" | Model: ${info.modelDisplayName} | Tools: ${info.tools.length}`, data: info }]);
                        } else {
                            const evtType = parsed.content ? 'content' : parsed.toolCall ? 'toolCall' : parsed.thinkingContent ? 'thinkingContent' : parsed.approvalRequest ? 'approvalRequest' : parsed.error ? 'error' : 'system';
                            let summary = evtType;
                            if (evtType === 'content') summary = `Content chunk (${(parsed.content || '').length} chars)`;
                            else if (evtType === 'toolCall') summary = `Tool: ${parsed.toolCall?.name} [${parsed.toolCall?.status}]`;
                            else if (evtType === 'thinkingContent') summary = 'Thinking content chunk';
                            else if (evtType === 'approvalRequest') summary = 'Approval request received';
                            else if (evtType === 'error') summary = `Error: ${parsed.error}`;
                            setDebugLogs((prev) => [...prev, { id: debugLogId(), timestamp: Date.now(), type: evtType as DebugLogEntry['type'], summary, data: parsed }]);
                        }
                    }
                    if (parsed.helperText) {
                        setMessages((prev) => prev.map((m) =>
                            m.id === assistantMsgId
                                ? { ...m, helperText: parsed.helperText as string }
                                : m
                        ));
                    }
                    if (parsed.cost) {
                        setMessages((prev) => prev.map((m) =>
                            m.id === assistantMsgId
                                ? { ...m, cost: parsed.cost as MessageCost }
                                : m
                        ));
                    }
                    if (parsed.content) {
                        sseDeliveredRef.current = true;
                        fullContent += parsed.content;
                        if (lastSegmentType === 'text' && segments.length > 0) {
                            (segments[segments.length - 1] as { type: 'text'; content: string }).content += parsed.content;
                        } else {
                            segments.push({ type: 'text', content: parsed.content });
                            lastSegmentType = 'text';
                        }
                        setMessages((prev) => prev.map((m) => m.id === assistantMsgId ? { ...m, content: fullContent, segments: [...segments] } : m));
                    }
                    if (parsed.toolCall) {
                        sseDeliveredRef.current = true;
                        const tc = parsed.toolCall as ToolCallEvent;
                        setMessages((prev) => prev.map((m) => {
                            if (m.id !== assistantMsgId) return m;
                            const existing = m.toolCalls || [];
                            if (tc.status === 'running') {
                                if (lastSegmentType === 'tools' && segments.length > 0) {
                                    (segments[segments.length - 1] as { type: 'tools'; toolCalls: ToolCallEvent[] }).toolCalls.push(tc);
                                } else {
                                    segments.push({ type: 'tools', toolCalls: [tc] });
                                    lastSegmentType = 'tools';
                                }
                                return { ...m, toolCalls: [...existing, tc], segments: [...segments] };
                            }
                            const updatedToolCalls = existing.map((et) => et.id === tc.id ? { ...et, ...tc, fullArgs: et.fullArgs || tc.fullArgs } : et);
                            for (const seg of segments) {
                                if (seg.type === 'tools') {
                                    seg.toolCalls = seg.toolCalls.map((et) => et.id === tc.id ? { ...et, ...tc, fullArgs: et.fullArgs || tc.fullArgs } : et);
                                }
                            }
                            return { ...m, toolCalls: updatedToolCalls, segments: [...segments] };
                        }));
                    }
                    if (parsed.thinkingContent) {
                        setMessages((prev) => prev.map((m) =>
                            m.id === assistantMsgId
                                ? { ...m, thinking: (m.thinking ?? '') + (parsed.thinkingContent as string) }
                                : m
                        ));
                    }
                    if (parsed.approvalRequest) {
                        const request = parsed.approvalRequest as ApprovalRequest;
                        setPendingApproval({ msgId: assistantMsgId, request });
                        setSending(false);
                        setMessages((prev) => prev.map((m) => {
                            if (m.id !== assistantMsgId) return m;
                            // For legacy tool-calls format, mark matching tools as pending
                            const updatedToolCalls = 'toolCalls' in request
                                ? (m.toolCalls || []).map((tc) => {
                                    const needs = request.toolCalls.some((a) => a.name === tc.name || a.id === tc.id);
                                    return needs ? { ...tc, status: 'pending_approval' as const } : tc;
                                })
                                : m.toolCalls;
                            return { ...m, isStreaming: false, approvalRequest: request, toolCalls: updatedToolCalls };
                        }));
                        // Stop reading SSE — graph is paused, no more events until resume.
                        // Returning lets the caller abort polling to prevent duplicates.
                        return;
                    }
                    if (parsed.error) toast.error(parsed.error);
                } catch { /* ignore */ }
            }
        }

        // Stream ended without [DONE] — finalize
        setMessages((prev) => prev.map((m) => m.id === assistantMsgId ? { ...m, content: fullContent, isStreaming: false, segments: [...segments] } : m));
    };

    // ── Polling fallback for when SSE doesn't work ───────────────────────────
    const sseDeliveredRef = useRef(false);

    const pollForCompletion = async (sessionId: string, assistantMsgId: string, signal: AbortSignal) => {
        const pollInterval = 1500;
        while (!signal.aborted) {
            await new Promise((r) => setTimeout(r, pollInterval));
            if (signal.aborted) break;
            try {
                const token = getToken();
                const runRes = await fetch(`${API_URL}/api/sessions/${sessionId}/active-run`, {
                    headers: { Authorization: `Bearer ${token}`, 'x-workspace-id': workspace!.id },
                    signal,
                });
                const runData = await runRes.json();
                if (!runData.data) {
                    // Run completed — only load from DB if SSE didn't deliver
                    if (sseDeliveredRef.current) return;
                    const msgsRes = await getMessages(workspace!.id, sessionId);
                    const hydrated: ChatMessage[] = msgsRes.map((msg: ChatMessage & { metadata?: Record<string, unknown> }) => {
                        const meta = msg.metadata as Record<string, unknown> | undefined;
                        if (meta && msg.role === 'assistant') {
                            return { ...msg, toolCalls: (meta.toolCalls as ToolCallEvent[] | undefined) || undefined, segments: (meta.segments as ChatSegment[] | undefined) || undefined, thinking: (meta.thinking as string | undefined) || undefined, cost: (meta.cost as MessageCost | undefined) || undefined };
                        }
                        return msg;
                    });
                    setMessages(hydrated);
                    return;
                }

                // Detect interrupted runs (HITL approval needed)
                const runStatus = runData.data.status as string;
                if (runStatus === 'interrupted') {
                    const msgsRes = await getMessages(workspace!.id, sessionId);
                    const hydrated: ChatMessage[] = msgsRes.map((msg: ChatMessage & { metadata?: Record<string, unknown> }) => {
                        const meta = msg.metadata as Record<string, unknown> | undefined;
                        if (meta && msg.role === 'assistant') {
                            return {
                                ...msg,
                                toolCalls: (meta.toolCalls as ToolCallEvent[] | undefined) || undefined,
                                segments: (meta.segments as ChatSegment[] | undefined) || undefined,
                                approvalRequest: (meta.approvalRequest as ApprovalRequest | undefined) || undefined,
                                thinking: (meta.thinking as string | undefined) || undefined,
                                cost: (meta.cost as MessageCost | undefined) || undefined,
                            };
                        }
                        return msg;
                    });
                    setMessages(hydrated);
                    // Find the last assistant message with an approval request
                    const approvalMsg = [...hydrated].reverse().find((m) => m.approvalRequest);
                    if (approvalMsg?.approvalRequest) {
                        setPendingApproval({ msgId: approvalMsg.id, request: approvalMsg.approvalRequest });
                        setSending(false);
                    } else {
                        // Fallback: approvalRequest wasn't persisted in message metadata
                        const lastAssistant = [...hydrated].reverse().find((m) => m.role === 'assistant');
                        if (lastAssistant) {
                            const fallbackRequest: ApprovalRequest = {
                                type: 'confirmation',
                                question: 'This action requires your approval to proceed.',
                            };
                            lastAssistant.approvalRequest = fallbackRequest;
                            setMessages([...hydrated]);
                            setPendingApproval({ msgId: lastAssistant.id, request: fallbackRequest });
                            setSending(false);
                        }
                    }
                    return;
                }
            } catch {
                // Keep polling
            }
        }
    };

    const sendMessage = async () => {
        if ((!chatInput.trim() && pendingFiles.length === 0) || !workspace || !activeSession || sending) return;
        const content = chatInput.trim() || (pendingFiles.length > 0 ? 'Please analyze the attached file(s).' : '');
        const filesToSend = pendingFiles.length > 0 ? [...pendingFiles] : undefined;
        setChatInput('');
        setPendingFiles([]);
        setSending(true);
        sseDeliveredRef.current = false;

        if (LOGGING_ENABLED) {
            setDebugLogs((prev) => [...prev, { id: debugLogId(), timestamp: Date.now(), type: 'system', summary: `User message sent (${content.length} chars${filesToSend?.length ? `, ${filesToSend.length} file(s)` : ''})`, data: { message: content, files: filesToSend?.map((f) => f.name) } }]);
        }

        // Build attachment metadata for display
        const attachmentMeta = filesToSend?.map((f) => ({
            filename: f.name,
            mimetype: f.type,
            type: (f.type.startsWith('image/') ? 'image' : 'document') as 'image' | 'document',
            size: f.size,
        }));

        const userMsg: ChatMessage = {
            id: `temp-user-${Date.now()}`, sessionId: activeSession.id,
            role: 'user', content, tokenCount: 0, createdAt: new Date().toISOString(),
            ...(attachmentMeta?.length ? { metadata: { attachments: attachmentMeta } } : {}),
        };
        const assistantMsg: ChatMessage = {
            id: `temp-assistant-${Date.now()}`, sessionId: activeSession.id,
            role: 'assistant', content: '', tokenCount: 0, createdAt: new Date().toISOString(), isStreaming: true,
        };
        setMessages((prev) => [...prev, userMsg, assistantMsg]);

        const abortController = new AbortController();

        try {
            const token = getToken();

            let runId: string;

            if (filesToSend && filesToSend.length > 0) {
                // Multipart form data with files
                const formData = new FormData();
                formData.append('message', content);
                for (const file of filesToSend) {
                    formData.append('files', file);
                }
                const postRes = await fetch(`${API_URL}/api/sessions/${activeSession.id}/chat`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}`, 'x-workspace-id': workspace.id },
                    body: formData,
                });
                if (!postRes.ok) throw new Error('Failed to send');
                const result = await postRes.json();
                runId = result.runId;
            } else {
                // Standard JSON
                const hdrs = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-workspace-id': workspace.id };
                const postRes = await fetch(`${API_URL}/api/sessions/${activeSession.id}/chat`, {
                    method: 'POST', headers: hdrs, body: JSON.stringify({ message: content }),
                });
                if (!postRes.ok) throw new Error('Failed to send');
                const result = await postRes.json();
                runId = result.runId;
            }

            // Start polling fallback in parallel
            pollForCompletion(activeSession.id, assistantMsg.id, abortController.signal).catch(() => {});

            // Try SSE streaming from the run events endpoint
            try {
                await readSSE(
                    `${API_URL}/api/runs/${runId}/events`,
                    { Authorization: `Bearer ${token}`, 'x-workspace-id': workspace.id },
                    assistantMsg.id,
                    abortController.signal
                );
                abortController.abort(); // Stop polling — SSE delivered the result
            } catch {
                // SSE failed — polling will deliver the result
            }
        } catch {
            toast.error('Failed to send message');
            setMessages((prev) => prev.filter((m) => m.id !== assistantMsg.id));
            abortController.abort();
        } finally {
            setSending(false);
        }
    };

    const handleApproval = async (decisions: Array<{ type: 'approve' | 'reject'; message?: string }>) => {
        if (!workspace || !activeSession || !pendingApproval) return;
        const msgId = pendingApproval.msgId;
        const statusLabel = decisions[0]?.type === 'approve' ? 'approved' : 'rejected';
        setMessages((prev) => prev.map((m) => {
            if (m.id !== msgId) return m;
            return { ...m, isStreaming: true, approvalRequest: undefined,
                toolCalls: (m.toolCalls || []).map((tc) => tc.status === 'pending_approval' ? { ...tc, status: statusLabel as ToolCallEvent['status'] } : tc),
            };
        }));
        setPendingApproval(null);
        setSending(true);
        sseDeliveredRef.current = false;

        const abortController = new AbortController();

        try {
            const token = getToken();
            const hdrs = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-workspace-id': workspace.id };

            // Get the active run for this session to find the runId
            const activeRunRes = await fetch(`${API_URL}/api/sessions/${activeSession.id}/active-run`, {
                headers: { Authorization: `Bearer ${token}`, 'x-workspace-id': workspace.id },
            });
            const activeRunData = await activeRunRes.json();
            const runId = activeRunData.data?.id;
            if (!runId) throw new Error('No active run found');

            // POST approval
            const approveRes = await fetch(`${API_URL}/api/runs/${runId}/approve`, {
                method: 'POST', headers: hdrs, body: JSON.stringify({ decisions }),
            });
            if (!approveRes.ok) throw new Error('Approval failed');

            // Start polling fallback
            pollForCompletion(activeSession.id, msgId, abortController.signal).catch(() => {});

            // Try SSE for the continued run
            try {
                await readSSE(
                    `${API_URL}/api/runs/${runId}/events`,
                    { Authorization: `Bearer ${token}`, 'x-workspace-id': workspace.id },
                    msgId,
                    abortController.signal
                );
                abortController.abort();
            } catch {
                // Polling will handle it
            }
        } catch {
            toast.error('Failed to process approval');
        } finally {
            setSending(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    };

    const sortedAgents = useMemo(() => {
        // Pin CEO and Tester agents to top
        const ceo = agents.filter((a) => a.isCeo);
        const tester = agents.filter((a) => a.isTester);
        const rest = agents.filter((a) => !a.isCeo && !a.isTester);
        return [...ceo, ...tester, ...rest];
    }, [agents]);

    const filteredAgents = agentSearch
        ? sortedAgents.filter((a) => a.name.toLowerCase().includes(agentSearch.toLowerCase()))
        : sortedAgents;

    return (
        <div className="space-y-6 relative" onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
            {/* Page-level drag overlay */}
            {isDragOver && activeSession && (
                <div className="fixed inset-0 z-50 bg-primary/20 backdrop-blur-sm border-4 border-dashed border-primary/60 flex items-center justify-center pointer-events-none">
                    <div className="flex flex-col items-center gap-3 text-primary bg-background/90 px-10 py-8 rounded-2xl shadow-2xl border border-primary/30">
                        <Paperclip className="w-12 h-12" />
                        <p className="text-lg font-semibold">Drop files here</p>
                        <p className="text-sm text-muted-foreground">Images, PDFs, DOCX, TXT, MD, CSV</p>
                    </div>
                </div>
            )}
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                    <Bot className="h-5 w-5 text-primary" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
                    <p className="text-sm text-muted-foreground">Create and manage your AI employees</p>
                </div>
            </div>

            {/* Two-column layout */}
            <div className="flex gap-0 h-[calc(100vh-200px)] rounded-xl border border-border overflow-hidden">
                {/* Left — Agent list */}
                <div className="w-[280px] flex-shrink-0 border-r border-border bg-card flex flex-col">
                    <div className="p-3 border-b border-border flex items-center justify-between">
                        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Agents</h2>
                        <Button size="sm" onClick={() => { setEditAgent(null); setSheetOpen(true); }} className="gap-1.5 h-7 text-xs">
                            <Plus className="h-3 w-3" />
                            New Agent
                        </Button>
                    </div>
                    <div className="px-3 pt-2 pb-1">
                        <div className="relative">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            <Input placeholder="Search agents..." value={agentSearch} onChange={(e) => setAgentSearch(e.target.value)} className="h-8 pl-7 text-xs" />
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
                        {loading ? (
                            Array.from({ length: 4 }).map((_, i) => (
                                <div key={i} className="p-2.5 space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-20" /></div>
                            ))
                        ) : filteredAgents.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-center px-4 gap-2">
                                <Sparkles className="h-5 w-5 text-muted-foreground/50" />
                                <p className="text-xs text-muted-foreground">No agents yet</p>
                            </div>
                        ) : (
                            filteredAgents.map((agent) => (
                                <div
                                    key={agent.id}
                                    className={`group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 cursor-pointer transition-colors ${
                                        selectedAgent?.id === agent.id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
                                    }`}
                                    onClick={() => handleSelectAgent(agent)}
                                >
                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 flex-shrink-0">
                                        {agent.emoji ? <span className="text-lg leading-none">{agent.emoji}</span> : <Bot className="h-4 w-4 text-primary" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <p className="text-sm font-medium truncate">{agent.name}</p>
                                            {agent.isCeo && <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-amber-500/10 text-amber-500 border-amber-500/20">CEO</Badge>}
                                            {agent.isTester && <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-purple-500/10 text-purple-500 border-purple-500/20">QA</Badge>}
                                        </div>
                                        <p className="text-[11px] text-muted-foreground truncate">{agent.model.split('/').pop()}</p>
                                    </div>
                                    {!agent.isCeo && !agent.isTester && (
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <button className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" onClick={(e) => e.stopPropagation()}>
                                                <Trash2 className="h-3 w-3" />
                                            </button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader><AlertDialogTitle>Delete Agent</AlertDialogTitle><AlertDialogDescription>Delete &quot;{agent.name}&quot;? This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                                            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDelete(agent.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction></AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Right — Content area */}
                <div className="flex-1 flex flex-col bg-background">
                    {selectedAgent ? (
                        <>
                            {/* Top bar with agent name + toggle + actions */}
                            <div className="h-14 border-b border-border px-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                                        {selectedAgent.emoji ? <span className="text-lg leading-none">{selectedAgent.emoji}</span> : <Bot className="h-4 w-4 text-primary" />}
                                    </div>
                                    <p className="text-sm font-semibold">{selectedAgent.name}</p>

                                    {/* View toggle */}
                                    <div className="flex items-center bg-muted rounded-lg p-0.5 ml-2">
                                        <button
                                            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                                                viewMode === 'chat' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                                            }`}
                                            onClick={() => setViewMode('chat')}
                                        >
                                            <MessageSquare className="h-3 w-3" />
                                            Chat
                                        </button>
                                        <button
                                            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                                                viewMode === 'settings' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                                            }`}
                                            onClick={() => setViewMode('settings')}
                                        >
                                            <Settings className="h-3 w-3" />
                                            Settings
                                        </button>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    {viewMode === 'chat' && (
                                        <>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="outline" size="sm" className="gap-2 text-xs h-8">
                                                        <Clock className="h-3.5 w-3.5" />
                                                        {activeSession ? (
                                                            <>
                                                                {activeSession.title}
                                                                <span className="text-muted-foreground">
                                                                    {new Date(activeSession.createdAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                                                                </span>
                                                            </>
                                                        ) : 'Select session'}
                                                        <ChevronDown className="h-3 w-3" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="w-[240px]">
                                                    {loadingSessions ? <div className="p-2"><Skeleton className="h-4 w-32" /></div> :
                                                    sessions.length === 0 ? <div className="p-3 text-center text-xs text-muted-foreground">No sessions yet</div> :
                                                    sessions.map((s) => (
                                                        <DropdownMenuItem key={s.id} className={`text-xs ${activeSession?.id === s.id ? 'bg-accent' : ''}`} onClick={() => { setActiveSession(s); updateParams({ session: s.id }); }}>
                                                            <span className="flex-1 truncate">{s.title}</span>
                                                            <span className="text-muted-foreground ml-2">{new Date(s.createdAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}</span>
                                                            <button
                                                                className="ml-1 p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
                                                                onClick={(e) => { e.stopPropagation(); setSessionToDelete(s); }}
                                                            >
                                                                <Trash2 className="h-3 w-3" />
                                                            </button>
                                                        </DropdownMenuItem>
                                                    ))}
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                            <AlertDialog open={!!sessionToDelete} onOpenChange={(open) => { if (!open) setSessionToDelete(null); }}>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>Delete Session</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            Are you sure you want to delete &quot;{sessionToDelete?.title}&quot;? This action cannot be undone and all messages in this session will be permanently deleted.
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel disabled={deletingSession}>Cancel</AlertDialogCancel>
                                                        <AlertDialogAction
                                                            onClick={handleDeleteSession}
                                                            disabled={deletingSession}
                                                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                        >
                                                            {deletingSession ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                                                            Delete
                                                        </AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                            <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8" onClick={handleNewSession}><Plus className="h-3.5 w-3.5" />New Chat</Button>
                                            {/* Cloud browser controls */}
                                            {(selectedAgent?.browserType || 'cloud') === 'cloud' && browserProfile && (
                                                <>
                                                    {browserWsUrl ? (
                                                        <>
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                className="gap-1.5 text-xs h-8"
                                                                onClick={() => {
                                                                    const next = !showBrowserPreview;
                                                                    setShowBrowserPreview(next);
                                                                    browserDismissedRef.current = !next;
                                                                }}
                                                            >
                                                                <Monitor className="h-3.5 w-3.5" />
                                                                {showBrowserPreview ? 'Hide' : 'Show'} Browser
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                className="gap-1.5 text-xs h-8 text-red-600 hover:text-red-700"
                                                                onClick={handleStopBrowser}
                                                            >
                                                                <Square className="h-3.5 w-3.5" />
                                                                Stop
                                                            </Button>
                                                        </>
                                                    ) : (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            className="gap-1.5 text-xs h-8"
                                                            onClick={handleStartBrowser}
                                                            disabled={startingBrowser}
                                                        >
                                                            {startingBrowser ? (
                                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                            ) : (
                                                                <Monitor className="h-3.5 w-3.5" />
                                                            )}
                                                            Start Browser
                                                        </Button>
                                                    )}
                                                </>
                                            )}
                                            {/* Extension browser toggle */}
                                            {selectedAgent?.browserType === 'extension' && (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="gap-1.5 text-xs h-8"
                                                    onClick={() => {
                                                        const next = !showBrowserPreview;
                                                        setShowBrowserPreview(next);
                                                        browserDismissedRef.current = !next;
                                                    }}
                                                >
                                                    <Chrome className="h-3.5 w-3.5" />
                                                    {showBrowserPreview ? 'Hide' : 'Show'} Extension
                                                </Button>
                                            )}
                                            {/* Session cost badge (logging only) */}
                                            {LOGGING_ENABLED && sessionCost > 0 && (
                                                <div className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 h-8">
                                                    <DollarSign className="h-3 w-3" />
                                                    <span>Session: {sessionCost < 0.0001 ? '<$0.0001' : `$${sessionCost.toFixed(4)}`}</span>
                                                </div>
                                            )}
                                            {/* Debug panel toggle */}
                                            {LOGGING_ENABLED && (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className={cn("gap-1.5 text-xs h-8", showDebugPanel && "bg-orange-500/10 border-orange-500/30 text-orange-600 hover:bg-orange-500/20")}
                                                    onClick={() => setShowDebugPanel(!showDebugPanel)}
                                                >
                                                    <Bug className="h-3.5 w-3.5" />
                                                    {showDebugPanel ? 'Hide' : 'Show'} Debug
                                                </Button>
                                            )}
                                        </>
                                    )}
                                    {viewMode === 'settings' && (
                                        <>
                                            <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8" onClick={() => { setEditAgent(selectedAgent); setSheetOpen(true); }}><Pencil className="h-3 w-3" />Edit</Button>
                                            <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8" onClick={() => router.push(`/agents/${selectedAgent.id}/permissions`)}><Shield className="h-3 w-3" />Permissions</Button>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Chat view */}
                            {viewMode === 'chat' && (
                                activeSession ? (
                                    <div className="flex-1 flex min-h-0 min-w-0 overflow-hidden">
                                        <div className="flex flex-col flex-1 min-w-0">
                                        <div className="flex-1 overflow-y-auto">
                                            <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
                                                {loadingMessages ? (
                                                    <div className="space-y-6">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="space-y-2"><Skeleton className="h-4 w-48" /><Skeleton className="h-16 w-full rounded-lg" /></div>)}</div>
                                                ) : messages.length === 0 ? (
                                                    <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center gap-3">
                                                        <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center"><Sparkles className="h-5 w-5 text-primary/60" /></div>
                                                        <p className="text-sm text-muted-foreground">Send a message to start chatting with {selectedAgent.name}.</p>
                                                    </div>
                                                ) : (
                                                    messages.map((msg) => {
                                                        // Helper to render assistant text content
                                                        const renderAssistantText = (text: string, isStreaming?: boolean) => {
                                                            const sanitized = stripToolCallXml(text);
                                                            let artifacts: Artifact[] = [];
                                                            let cleanMessage: string = sanitized;
                                                            let isArtifactStreaming = false;
                                                            let streamingArtifactType: string | undefined;
                                                            let streamingArtifactFilename: string | undefined;

                                                            if (isStreaming) {
                                                                // During streaming: detect artifact tag and hide raw XML
                                                                const detected = detectStreamingArtifact(sanitized);
                                                                cleanMessage = detected.cleanMessage;
                                                                isArtifactStreaming = detected.isArtifactStreaming;
                                                                streamingArtifactType = detected.type;
                                                                streamingArtifactFilename = detected.filename;
                                                                // If completed artifacts were detected during streaming, parse them all
                                                                if (!detected.isArtifactStreaming && detected.type) {
                                                                    const parsed = parseAllArtifacts(sanitized);
                                                                    artifacts = parsed.artifacts;
                                                                    cleanMessage = parsed.cleanMessage;
                                                                }
                                                            } else {
                                                                const parsed = parseAllArtifacts(sanitized);
                                                                artifacts = parsed.artifacts;
                                                                cleanMessage = parsed.cleanMessage;
                                                            }
                                                            if (!cleanMessage && artifacts.length === 0 && !isArtifactStreaming && !isStreaming) return null;
                                                            return (
                                                                <div className="flex gap-3">
                                                                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted flex-shrink-0 mt-0.5"><Bot className="h-3.5 w-3.5 text-muted-foreground" /></div>
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-2.5">
                                                                            {isStreaming && !text ? (
                                                                                msg.helperText ? (
                                                                                    <TextShimmer className="font-mono text-sm" duration={1.2}>
                                                                                        {msg.helperText}
                                                                                    </TextShimmer>
                                                                                ) : <ThinkingLoader />
                                                                            ) : (
                                                                                <>
                                                                                    {cleanMessage && (
                                                                                        <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-2 prose-code:text-xs prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-muted prose-pre:p-3 prose-pre:rounded-lg">
                                                                                            <ReactMarkdown
                                                                                                remarkPlugins={[remarkGfm]}
                                                                                                components={{
                                                                                                    table: ({ children }) => (
                                                                                                        <div className="my-3 w-full overflow-x-auto rounded-lg border border-border not-prose">
                                                                                                            <table className="w-full border-collapse text-sm">{children}</table>
                                                                                                        </div>
                                                                                                    ),
                                                                                                    thead: ({ children }) => (
                                                                                                        <thead className="bg-muted/70">{children}</thead>
                                                                                                    ),
                                                                                                    tbody: ({ children }) => (
                                                                                                        <tbody className="divide-y divide-border">{children}</tbody>
                                                                                                    ),
                                                                                                    tr: ({ children }) => (
                                                                                                        <tr className="hover:bg-muted/40 transition-colors">{children}</tr>
                                                                                                    ),
                                                                                                    th: ({ children }) => (
                                                                                                        <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">{children}</th>
                                                                                                    ),
                                                                                                    td: ({ children }) => (
                                                                                                        <td className="px-3 py-2 text-sm">{children}</td>
                                                                                                    ),
                                                                                                }}
                                                                                            >
                                                                                                {cleanMessage}
                                                                                            </ReactMarkdown>
                                                                                        </div>
                                                                                    )}
                                                                                    {artifacts.map((art, idx) => (
                                                                                        <div key={idx} className={`flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5 ${cleanMessage || idx > 0 ? 'mt-3' : ''}`}>
                                                                                            <FileIcon type={art.type} className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                                                                                            <div className="flex-1 min-w-0">
                                                                                                <p className="text-sm font-medium truncate">{art.filename}</p>
                                                                                                <p className="text-[11px] text-muted-foreground">{art.type.toUpperCase()}</p>
                                                                                            </div>
                                                                                            <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7 flex-shrink-0" onClick={() => setActiveArtifact(art)}>
                                                                                                <Eye className="h-3 w-3" />View
                                                                                            </Button>
                                                                                            <button className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0" onClick={() => downloadArtifact(art)} title="Download">
                                                                                                <Download className="h-3.5 w-3.5" />
                                                                                            </button>
                                                                                        </div>
                                                                                    ))}
                                                                                    {isArtifactStreaming && artifacts.length === 0 && (
                                                                                        <div className={`flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5 animate-pulse ${cleanMessage ? 'mt-3' : ''}`}>
                                                                                            {streamingArtifactType ? (
                                                                                                <FileIcon type={streamingArtifactType as Artifact['type']} className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                                                                                            ) : (
                                                                                                <Loader2 className="h-5 w-5 text-muted-foreground flex-shrink-0 animate-spin" />
                                                                                            )}
                                                                                            <div className="flex-1 min-w-0">
                                                                                                <p className="text-sm font-medium truncate">{streamingArtifactFilename || 'Generating artifact...'}</p>
                                                                                                <p className="text-[11px] text-muted-foreground">{streamingArtifactType?.toUpperCase() || 'ARTIFACT'}</p>
                                                                                            </div>
                                                                                            <Loader2 className="h-4 w-4 text-muted-foreground animate-spin flex-shrink-0" />
                                                                                        </div>
                                                                                    )}
                                                                                </>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        };

                                                        const ThinkingToggle = ({ content, isStreaming: isThinkingStreaming }: { content: string; isStreaming?: boolean }) => {
                                                            const [open, setOpen] = useState(false);
                                                            if (!content) return null;
                                                            return (
                                                                <div className="flex gap-3">
                                                                    <div className="w-7 flex-shrink-0" />
                                                                    <div className="flex-1 min-w-0 mb-1">
                                                                        <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1">
                                                                            <Sparkles className="h-3 w-3" />
                                                                            <span className="font-medium">{isThinkingStreaming ? 'Thinking...' : 'Thought process'}</span>
                                                                            {isThinkingStreaming && (
                                                                                <span className="inline-flex gap-0.5 ml-1">
                                                                                    <span className="h-1 w-1 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '0ms' }} />
                                                                                    <span className="h-1 w-1 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '150ms' }} />
                                                                                    <span className="h-1 w-1 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '300ms' }} />
                                                                                </span>
                                                                            )}
                                                                            {open ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />}
                                                                        </button>
                                                                        {open && (
                                                                            <div className="mt-1 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
                                                                                {content}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            );
                                                        };

                                                        return (
                                                        <Fragment key={msg.id}>
                                                            {msg.role === 'user' ? (
                                                                <div className="flex justify-end">
                                                                    <div className="max-w-[80%] space-y-2">
                                                                        {/* User attachments */}
                                                                        {(() => {
                                                                            const meta = msg.metadata as Record<string, unknown> | undefined;
                                                                            const atts = meta?.attachments as Array<{ filename: string; type: string }> | undefined;
                                                                            if (!atts?.length) return null;
                                                                            return (
                                                                                <div className="flex flex-wrap gap-2 justify-end">
                                                                                    {atts.map((att, i) => (
                                                                                        <div key={i} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary/80 text-primary-foreground text-xs">
                                                                                            {att.type === "image" ? <ImageIcon className="w-3.5 h-3.5 shrink-0" /> : <FileText className="w-3.5 h-3.5 shrink-0" />}
                                                                                            <span className="max-w-[150px] truncate">{att.filename}</span>
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            );
                                                                        })()}
                                                                        <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-4 py-2.5">
                                                                            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ) : msg.segments && msg.segments.length > 0 ? (
                                                                /* Interleaved rendering: text and tool calls in order */
                                                                <>
                                                                    {msg.thinking && <ThinkingToggle content={msg.thinking} isStreaming={msg.isStreaming} />}
                                                                    {msg.segments.map((seg, si) => (
                                                                        <Fragment key={`${msg.id}-seg-${si}`}>
                                                                            {seg.type === 'text' && seg.content.trim() && renderAssistantText(seg.content, msg.isStreaming && si === msg.segments!.length - 1)}
                                                                            {seg.type === 'tools' && (
                                                                                <ToolCallDisplay toolCalls={seg.toolCalls} messageId={`${msg.id}-${si}`} isMessageComplete={!msg.isStreaming} />
                                                                            )}
                                                                        </Fragment>
                                                                    ))}
                                                                    {msg.isStreaming && !msg.content && renderAssistantText('', true)}
                                                                    {msg.approvalRequest && pendingApproval?.msgId === msg.id && (
                                                                        <ApprovalCard
                                                                            request={msg.approvalRequest}
                                                                            onApprove={() => handleApproval([{ type: 'approve' as const }])}
                                                                            onReject={() => handleApproval([{ type: 'reject' as const }])}
                                                                            disabled={sending}
                                                                        />
                                                                    )}
                                                                </>
                                                            ) : (
                                                                /* Fallback for loaded messages without segments */
                                                                <>
                                                                    {msg.thinking && <ThinkingToggle content={msg.thinking} />}
                                                                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                                                                        <ToolCallDisplay toolCalls={msg.toolCalls} messageId={msg.id} isMessageComplete={!msg.isStreaming} />
                                                                    )}
                                                                    {msg.approvalRequest && pendingApproval?.msgId === msg.id && (
                                                                        <ApprovalCard
                                                                            request={msg.approvalRequest}
                                                                            onApprove={() => handleApproval([{ type: 'approve' as const }])}
                                                                            onReject={() => handleApproval([{ type: 'reject' as const }])}
                                                                            disabled={sending}
                                                                        />
                                                                    )}
                                                                    {(msg.content || msg.isStreaming) && renderAssistantText(msg.content, msg.isStreaming)}
                                                                </>
                                                            )}
                                                            {/* Per-message cost badge (logging only) */}
                                                            {LOGGING_ENABLED && msg.role === 'assistant' && !msg.isStreaming && msg.cost && (
                                                                <div className="flex items-center gap-1.5 mt-1.5 ml-10">
                                                                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] gap-1 font-normal text-muted-foreground border-border/60">
                                                                        <DollarSign className="w-2.5 h-2.5" />
                                                                        {msg.cost.totalCost < 0.0001
                                                                            ? '<$0.0001'
                                                                            : `$${msg.cost.totalCost.toFixed(4)}`}
                                                                    </Badge>
                                                                    <span className="text-[10px] text-muted-foreground/60">
                                                                        {msg.cost.inputTokens.toLocaleString()}in / {msg.cost.outputTokens.toLocaleString()}out
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </Fragment>
                                                        );
                                                    })
                                                )}
                                                <div ref={messagesEndRef} />
                                            </div>
                                        </div>
                                        <div className="border-t border-border p-4">
                                            <div className="max-w-5xl mx-auto">
                                                {/* File preview strip */}
                                                {pendingFiles.length > 0 && (
                                                    <div className="space-y-2 mb-2">
                                                        <div className="flex flex-wrap gap-2">
                                                            {pendingFiles.map((file, idx) => (
                                                                <div key={`${file.name}-${idx}`} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted/60 border border-border text-xs group">
                                                                    {file.type.startsWith("image/") ? <ImageIcon className="w-3.5 h-3.5 text-blue-500 shrink-0" /> : <FileText className="w-3.5 h-3.5 text-orange-500 shrink-0" />}
                                                                    <span className="max-w-[120px] truncate text-foreground">{file.name}</span>
                                                                    <span className="text-muted-foreground">({(file.size / 1024).toFixed(0)}KB)</span>
                                                                    <button type="button" onClick={() => removeFile(idx)} className="ml-0.5 p-0.5 rounded hover:bg-destructive/10 transition-colors cursor-pointer">
                                                                        <X className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        {pendingFiles.some((f) => f.type.startsWith("image/")) && (() => {
                                                            const model = (selectedAgent?.model || "").toLowerCase();
                                                            const visionPatterns = ["gpt-4o", "gpt-4-turbo", "gpt-4-vision", "claude-3", "claude-sonnet", "claude-opus", "claude-haiku", "gemini", "gemma", "llava", "pixtral", "qwen-vl", "qwen2-vl"];
                                                            const supportsVision = !model || visionPatterns.some((p) => model.includes(p));
                                                            if (!supportsVision) return (
                                                                <p className="text-xs text-amber-600 dark:text-amber-400">
                                                                    This model may not support image input. Images will be skipped. Consider switching to a vision model (GPT-4o, Claude 3, Gemini).
                                                                </p>
                                                            );
                                                            return null;
                                                        })()}
                                                    </div>
                                                )}
                                                <div className="relative">
                                                    <textarea ref={textareaRef} value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={handleKeyDown} placeholder={pendingApproval ? "Waiting for your approval..." : pendingFiles.length > 0 ? "Add a message about the file(s)…" : "Ask your agent..."} className="w-full resize-none rounded-xl border border-border bg-card px-4 py-3 pr-24 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring min-h-[48px] max-h-[160px] transition-colors" rows={1} disabled={sending || !!pendingApproval} />
                                                    <input ref={fileInputRef} type="file" multiple accept={ACCEPTED_EXTENSIONS} className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
                                                    <div className="absolute right-2 bottom-2 flex items-center gap-1">
                                                        <Button onClick={() => fileInputRef.current?.click()} size="icon" variant="ghost" className="h-8 w-8 rounded-lg" title="Attach files">
                                                            <Paperclip className="h-4 w-4 text-muted-foreground" />
                                                        </Button>
                                                        <Button onClick={sendMessage} disabled={(!chatInput.trim() && pendingFiles.length === 0) || sending} size="icon" variant="ghost" className="h-8 w-8 rounded-lg">
                                                            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        </div>

                                        {/* Browser preview column — Cloud */}
                                        {showBrowserPreview && browserWsUrl && browserSessionId && (selectedAgent?.browserType || 'cloud') === 'cloud' && (
                                            <div className="flex-1 min-w-0 border-l border-border p-3 overflow-y-auto">
                                                <BrowserPreview
                                                    wsUrl={browserWsUrl}
                                                    sessionId={browserSessionId}
                                                    onClose={() => setShowBrowserPreview(false)}
                                                    proxied={!!(selectedAgent?.browserProxyId || proxies.length > 0)}
                                                    proxyLabel={
                                                        selectedAgent?.browserProxyId
                                                            ? proxies.find((p) => p.id === selectedAgent.browserProxyId)?.label
                                                            : proxies.length > 0 ? 'Auto-proxied' : undefined
                                                    }
                                                />
                                            </div>
                                        )}

                                        {/* Browser preview column — Extension */}
                                        {showBrowserPreview && selectedAgent?.browserType === 'extension' && workspace && (
                                            <div className="flex-1 min-w-0 border-l border-border p-3 overflow-y-auto">
                                                <ExtensionLiveView workspaceId={workspace.id} />
                                            </div>
                                        )}

                                        {/* Debug log panel (Sheet overlay) */}
                                        {LOGGING_ENABLED && (
                                            <Sheet open={showDebugPanel} onOpenChange={setShowDebugPanel}>
                                                <SheetContent side="right" className="w-[420px] sm:max-w-[420px] p-0 gap-0" showCloseButton={false}>
                                                    <DebugLogPanel debugInfo={debugInfo} debugLogs={debugLogs} agentId={selectedAgent?.id} workspaceId={workspace?.id} />
                                                </SheetContent>
                                            </Sheet>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
                                        <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center"><Sparkles className="h-6 w-6 text-muted-foreground/40" /></div>
                                        <div>
                                            <p className="text-base font-medium text-muted-foreground">Start a conversation</p>
                                            <p className="text-sm text-muted-foreground/70 mt-1">Select a session or create a new one.</p>
                                        </div>
                                        <Button variant="outline" onClick={handleNewSession} className="gap-1.5 mt-2"><Plus className="h-4 w-4" />New Chat</Button>
                                    </div>
                                )
                            )}

                            {/* Settings view */}
                            {viewMode === 'settings' && (
                                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                                    <div>
                                        <h3 className="text-sm font-medium text-muted-foreground mb-2">Model</h3>
                                        <div className="flex items-center gap-3">
                                            <Badge variant="outline" className="text-xs"><Cpu className="h-3 w-3 mr-1" />{selectedAgent.model}</Badge>
                                            {llmModels.find(m => m.modelId === selectedAgent.model)?.directApiEnabled && (
                                                <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Direct API</Badge>
                                            )}
                                            <Badge variant="outline" className="text-xs bg-muted/50"><Thermometer className="h-3 w-3 mr-1" />{selectedAgent.temperature}</Badge>
                                        </div>
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-medium text-muted-foreground mb-2">System Prompt</h3>
                                        <div className="rounded-lg bg-muted/50 border border-border p-4">
                                            <p className="text-sm leading-relaxed whitespace-pre-wrap">
                                                {selectedAgent.systemPrompt || <span className="text-muted-foreground italic">No system prompt configured.</span>}
                                            </p>
                                        </div>
                                    </div>

                                    {/* ── Browser Settings ── */}
                                    <div className="rounded-lg border border-border bg-card p-5 space-y-5">
                                        <div className="flex items-center gap-2">
                                            <Globe className="h-4 w-4 text-sky-600" />
                                            <h3 className="text-sm font-semibold">Browser Settings</h3>
                                        </div>

                                        {/* Browser Type */}
                                        <div className="space-y-2">
                                            <Label className="text-sm font-medium">Browser Type</Label>
                                            <div className="grid grid-cols-2 gap-3">
                                                <button
                                                    type="button"
                                                    onClick={() => handleChangeBrowserType('cloud')}
                                                    disabled={savingBrowserSettings}
                                                    className={cn(
                                                        'flex items-center gap-3 rounded-lg border-2 p-3 transition-colors text-left',
                                                        (selectedAgent.browserType || 'cloud') === 'cloud'
                                                            ? 'border-primary bg-primary/5'
                                                            : 'border-border hover:border-muted-foreground/30'
                                                    )}
                                                >
                                                    <Cloud className={cn('h-4 w-4 flex-shrink-0', (selectedAgent.browserType || 'cloud') === 'cloud' ? 'text-primary' : 'text-muted-foreground')} />
                                                    <div>
                                                        <p className={cn('text-sm font-medium', (selectedAgent.browserType || 'cloud') === 'cloud' ? 'text-foreground' : 'text-muted-foreground')}>Cloud Browser</p>
                                                        <p className="text-[11px] text-muted-foreground">Managed instance with proxy support</p>
                                                    </div>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleChangeBrowserType('extension')}
                                                    disabled={savingBrowserSettings}
                                                    className={cn(
                                                        'flex items-center gap-3 rounded-lg border-2 p-3 transition-colors text-left',
                                                        selectedAgent.browserType === 'extension'
                                                            ? 'border-primary bg-primary/5'
                                                            : 'border-border hover:border-muted-foreground/30'
                                                    )}
                                                >
                                                    <Chrome className={cn('h-4 w-4 flex-shrink-0', selectedAgent.browserType === 'extension' ? 'text-primary' : 'text-muted-foreground')} />
                                                    <div>
                                                        <p className={cn('text-sm font-medium', selectedAgent.browserType === 'extension' ? 'text-foreground' : 'text-muted-foreground')}>Extension Browser</p>
                                                        <p className="text-[11px] text-muted-foreground">Your real Chrome browser</p>
                                                    </div>
                                                </button>
                                            </div>
                                        </div>

                                        {/* Cloud-specific settings */}
                                        {(selectedAgent.browserType || 'cloud') === 'cloud' && (
                                            <>
                                                {/* Fingerprint (OS) */}
                                                <div className="space-y-2">
                                                    <Label className="text-sm font-medium">Fingerprint</Label>
                                                    <Select
                                                        value={browserProfile?.os || 'windows'}
                                                        onValueChange={handleChangeFingerprint}
                                                        disabled={savingBrowserSettings}
                                                    >
                                                        <SelectTrigger className="w-full">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="windows">Windows</SelectItem>
                                                            <SelectItem value="macos">macOS</SelectItem>
                                                            <SelectItem value="linux">Linux</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                    <p className="text-xs text-muted-foreground">
                                                        OS fingerprint used by this agent&apos;s browser profile
                                                    </p>
                                                </div>

                                                {/* Proxy */}
                                                <div className="space-y-2">
                                                    <Label className="text-sm font-medium">Proxy</Label>
                                                    <Select
                                                        value={selectedAgent.browserProxyId || '__auto__'}
                                                        onValueChange={handleChangeProxy}
                                                        disabled={savingBrowserSettings}
                                                    >
                                                        <SelectTrigger className="w-full">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="__auto__">
                                                                <div className="flex items-center gap-2">
                                                                    <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                                                                    <span>Auto-select nearest proxy</span>
                                                                </div>
                                                            </SelectItem>
                                                            {proxies.filter((p) => p.isActive).map((proxy) => (
                                                                <SelectItem key={proxy.id} value={proxy.id}>
                                                                    <div className="flex items-center gap-2">
                                                                        {proxy.country && (
                                                                            <span className="text-sm">
                                                                                {String.fromCodePoint(
                                                                                    ...proxy.country.toUpperCase().split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
                                                                                )}
                                                                            </span>
                                                                        )}
                                                                        <span>{proxy.label}</span>
                                                                        <span className="text-muted-foreground font-mono text-xs">
                                                                            {proxy.host}:{proxy.port}
                                                                        </span>
                                                                    </div>
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                    <p className="text-xs text-muted-foreground">
                                                        {proxies.filter((p) => p.isActive).length === 0
                                                            ? 'No proxies available. Add proxies from the admin panel.'
                                                            : 'Choose a proxy location or let the system auto-select the nearest one'}
                                                    </p>
                                                </div>

                                                {/* Start / End Session */}
                                                <div className="space-y-2">
                                                    <Label className="text-sm font-medium">Browser Session</Label>
                                                    <div className="flex items-center gap-3">
                                                        {(browserSessionId || activeBrowserSession) ? (
                                                            <>
                                                                <div className="flex items-center gap-2">
                                                                    <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                                                                    <span className="text-sm text-muted-foreground">Session active</span>
                                                                </div>
                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    className="gap-1.5 text-red-600 hover:text-red-700"
                                                                    onClick={handleEndBrowserSession}
                                                                >
                                                                    <Square className="h-3.5 w-3.5" />
                                                                    End Session
                                                                </Button>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <div className="flex items-center gap-2">
                                                                    <div className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                                                                    <span className="text-sm text-muted-foreground">No active session</span>
                                                                </div>
                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    className="gap-1.5"
                                                            onClick={handleStartBrowserSession}
                                                            disabled={startingBrowser}
                                                        >
                                                            {startingBrowser ? (
                                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                            ) : (
                                                                <Play className="h-3.5 w-3.5" />
                                                            )}
                                                            Start Session
                                                        </Button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                            </>
                                        )}

                                        {/* Extension-specific settings */}
                                        {selectedAgent.browserType === 'extension' && (
                                            <div className="space-y-3">
                                                <div className="rounded-lg bg-muted/50 border border-border p-4 space-y-2">
                                                    <div className="flex items-center gap-2">
                                                        <Chrome className="h-4 w-4 text-muted-foreground" />
                                                        <p className="text-sm font-medium">Chrome Extension Browser</p>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground leading-relaxed">
                                                        This agent uses your real Chrome browser via the extension. The agent will see and interact with your actual browser tabs, sessions, and cookies.
                                                    </p>
                                                    <p className="text-xs text-muted-foreground leading-relaxed">
                                                        Make sure the Chrome extension is installed and connected. You can configure it in{' '}
                                                        <span className="font-medium text-foreground">Extension Settings</span>.
                                                    </p>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="rounded-lg bg-muted/50 border border-border p-4">
                                            <p className="text-xs font-medium text-muted-foreground mb-1">Created</p>
                                            <p className="text-sm font-medium">{new Date(selectedAgent.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                                        </div>
                                        <div className="rounded-lg bg-muted/50 border border-border p-4">
                                            <p className="text-xs font-medium text-muted-foreground mb-1">Last Updated</p>
                                            <p className="text-sm font-medium">{new Date(selectedAgent.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-4">
                            <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center"><Bot className="h-8 w-8 text-muted-foreground/50" /></div>
                            <div>
                                <p className="text-lg font-medium text-muted-foreground">Select an agent</p>
                                <p className="text-sm text-muted-foreground/70 mt-1">Choose an agent from the list to view details and start chatting.</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {workspace && <CreateAgentSheet open={sheetOpen} onOpenChange={setSheetOpen} workspaceId={workspace.id} agent={editAgent} onSuccess={() => { fetchAgents(); setSelectedAgent(null); }} />}

            {activeArtifact && (
                <ArtifactPanel
                    artifact={activeArtifact}
                    onClose={() => setActiveArtifact(null)}
                />
            )}
        </div>
    );
}
