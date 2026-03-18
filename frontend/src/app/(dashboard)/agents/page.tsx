'use client';

import { useEffect, useState, useCallback, useRef, Fragment } from 'react';
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
import { getAgents, deleteAgent } from '@/lib/api/agents';
import { getSessions, createSession, getMessages } from '@/lib/api/sessions';
import { API_URL } from '@/lib/constants';
import { getToken } from '@/lib/auth';
import { parseArtifact } from '@/lib/artifact-parser';
import type { Artifact } from '@/lib/artifact-parser';
import { ArtifactPanel, FileIcon } from '@/components/artifact';
import { downloadArtifact } from '@/lib/artifact-download';
import { getProfiles, startSession as startBrowserSession, endSession as endBrowserSession } from '@/lib/api/browser';
import { BrowserPreview } from '@/components/browser/browser-preview';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Agent, Session, Message, BrowserProfile } from '@/types';
import { ToolCallDisplay } from '@/components/chat/tool-call-display';
import { ApprovalCard } from '@/components/chat/approval-card';

interface ToolCallEvent {
    id: string;
    name: string;
    args?: string;
    fullArgs?: Record<string, unknown>;
    type: 'tool' | 'agent';
    status: 'running' | 'done' | 'pending_approval' | 'approved' | 'rejected';
    result?: string;
}

interface ApprovalRequest {
    toolCalls: Array<{
        id: string;
        name: string;
        args: Record<string, unknown>;
    }>;
}

// Ordered sequence of content and tool call events for interleaved rendering
type ChatSegment =
    | { type: 'text'; content: string }
    | { type: 'tools'; toolCalls: ToolCallEvent[] };

interface ChatMessage extends Message {
    isStreaming?: boolean;
    toolCalls?: ToolCallEvent[];
    segments?: ChatSegment[];
    approvalRequest?: ApprovalRequest;
}

type ViewMode = 'chat' | 'settings';

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

    // Browser preview state
    const [browserProfile, setBrowserProfile] = useState<BrowserProfile | null>(null);
    const [browserWsUrl, setBrowserWsUrl] = useState<string | null>(null);
    const [browserSessionId, setBrowserSessionId] = useState<string | null>(null);
    const [startingBrowser, setStartingBrowser] = useState(false);
    const [showBrowserPreview, setShowBrowserPreview] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

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
            // Auto-select agent from URL param
            if (agentIdParam) {
                const found = data.find((a: Agent) => a.id === agentIdParam);
                if (found) setSelectedAgent(found);
            }
        } catch {
            toast.error('Failed to load agents');
        } finally {
            setLoading(false);
        }
    }, [workspace]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { fetchAgents(); }, [fetchAgents]);

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
        if (!workspace || !activeSession) {
            setMessages([]);
            return;
        }
        const fetch = async () => {
            try {
                setLoadingMessages(true);
                const data = await getMessages(workspace.id, activeSession.id);
                // Hydrate tool calls and segments from metadata
                const hydrated: ChatMessage[] = data.map((msg: ChatMessage & { metadata?: Record<string, unknown> }) => {
                    const meta = msg.metadata as Record<string, unknown> | undefined;
                    if (meta && msg.role === 'assistant') {
                        return {
                            ...msg,
                            toolCalls: (meta.toolCalls as ToolCallEvent[] | undefined) || undefined,
                            segments: (meta.segments as ChatSegment[] | undefined) || undefined,
                        };
                    }
                    return msg;
                });
                setMessages(hydrated);
            } catch {
                toast.error('Failed to load messages');
            } finally {
                setLoadingMessages(false);
            }
        };
        fetch();
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

    // Fetch browser profile for selected agent
    useEffect(() => {
        if (!workspace || !selectedAgent) {
            setBrowserProfile(null);
            return;
        }
        getProfiles(workspace.id)
            .then((profiles) => {
                const assigned = profiles.find(
                    (p) => p.assignedAgentId === selectedAgent.id && p.status === 'active'
                );
                setBrowserProfile(assigned || null);
            })
            .catch(() => {});
    }, [workspace, selectedAgent]);

    // Reset browser state when agent changes
    useEffect(() => {
        setBrowserWsUrl(null);
        setBrowserSessionId(null);
        setShowBrowserPreview(false);
    }, [selectedAgent]);

    const handleStartBrowser = async () => {
        if (!workspace || !browserProfile || !selectedAgent) return;
        setStartingBrowser(true);
        try {
            const { sessionId, wsUrl } = await startBrowserSession(
                workspace.id,
                browserProfile.id,
                selectedAgent.id
            );
            setBrowserSessionId(sessionId);
            setBrowserWsUrl(wsUrl);
            setShowBrowserPreview(true);
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

    const sendMessage = async () => {
        if (!chatInput.trim() || !workspace || !activeSession || sending) return;
        const content = chatInput.trim();
        setChatInput('');
        setSending(true);

        const userMsg: ChatMessage = {
            id: `temp-user-${Date.now()}`, sessionId: activeSession.id,
            role: 'user', content, tokenCount: 0, createdAt: new Date().toISOString(),
        };
        const assistantMsg: ChatMessage = {
            id: `temp-assistant-${Date.now()}`, sessionId: activeSession.id,
            role: 'assistant', content: '', tokenCount: 0, createdAt: new Date().toISOString(), isStreaming: true,
        };
        setMessages((prev) => [...prev, userMsg, assistantMsg]);

        try {
            const token = getToken();
            const response = await fetch(`${API_URL}/api/sessions/${activeSession.id}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-workspace-id': workspace.id },
                body: JSON.stringify({ message: content }),
            });
            if (!response.ok || !response.body) throw new Error('Failed');
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullContent = '';
            // Track segments for interleaved rendering
            const segments: ChatSegment[] = [];
            let lastSegmentType: 'text' | 'tools' | null = null;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                for (const line of decoder.decode(value, { stream: true }).split('\n')) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6);
                    if (data === '[DONE]') {
                        setMessages((prev) => prev.map((m) => m.id === assistantMsg.id ? { ...m, content: fullContent, isStreaming: false, segments: [...segments] } : m));
                        continue;
                    }
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.content) {
                            fullContent += parsed.content;
                            // Add to or create text segment
                            if (lastSegmentType === 'text' && segments.length > 0) {
                                const last = segments[segments.length - 1] as { type: 'text'; content: string };
                                last.content += parsed.content;
                            } else {
                                segments.push({ type: 'text', content: parsed.content });
                                lastSegmentType = 'text';
                            }
                            setMessages((prev) => prev.map((m) => m.id === assistantMsg.id ? { ...m, content: fullContent, segments: [...segments] } : m));
                        }
                        if (parsed.toolCall) {
                            const tc = parsed.toolCall as ToolCallEvent;
                            // Track in tool calls array
                            setMessages((prev) => prev.map((m) => {
                                if (m.id !== assistantMsg.id) return m;
                                const existing = m.toolCalls || [];
                                if (tc.status === 'running') {
                                    // Add to or create tools segment
                                    if (lastSegmentType === 'tools' && segments.length > 0) {
                                        const last = segments[segments.length - 1] as { type: 'tools'; toolCalls: ToolCallEvent[] };
                                        last.toolCalls.push(tc);
                                    } else {
                                        segments.push({ type: 'tools', toolCalls: [tc] });
                                        lastSegmentType = 'tools';
                                    }
                                    return { ...m, toolCalls: [...existing, tc], segments: [...segments] };
                                }
                                // Update existing tool call
                                const updatedToolCalls = existing.map((et) => et.id === tc.id ? { ...et, ...tc, fullArgs: et.fullArgs || tc.fullArgs } : et);
                                // Also update in segments
                                for (const seg of segments) {
                                    if (seg.type === 'tools') {
                                        seg.toolCalls = seg.toolCalls.map((et) => et.id === tc.id ? { ...et, ...tc, fullArgs: et.fullArgs || tc.fullArgs } : et);
                                    }
                                }
                                return { ...m, toolCalls: updatedToolCalls, segments: [...segments] };
                            }));
                            continue;
                        }
                        if (parsed.approvalRequest) {
                            const request = parsed.approvalRequest as ApprovalRequest;
                            setPendingApproval({ msgId: assistantMsg.id, request });
                            setMessages((prev) => prev.map((m) => {
                                if (m.id !== assistantMsg.id) return m;
                                return {
                                    ...m, isStreaming: false, approvalRequest: request,
                                    toolCalls: (m.toolCalls || []).map((tc) => {
                                        const needs = request.toolCalls.some((a) => a.name === tc.name || a.id === tc.id);
                                        return needs ? { ...tc, status: 'pending_approval' as const } : tc;
                                    }),
                                };
                            }));
                        }
                        if (parsed.error) toast.error(parsed.error);
                    } catch { /* ignore */ }
                }
            }
        } catch {
            toast.error('Failed to send message');
            setMessages((prev) => prev.filter((m) => m.id !== assistantMsg.id));
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
        try {
            const token = getToken();
            const response = await fetch(`${API_URL}/api/sessions/${activeSession.id}/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-workspace-id': workspace.id },
                body: JSON.stringify({ decisions }),
            });
            if (!response.ok || !response.body) throw new Error('Failed');
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                for (const line of decoder.decode(value, { stream: true }).split('\n')) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6);
                    if (data === '[DONE]') { setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, isStreaming: false } : m)); continue; }
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.content) setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, content: m.content + parsed.content } : m));
                        if (parsed.toolCall) {
                            const tc = parsed.toolCall as ToolCallEvent;
                            setMessages((prev) => prev.map((m) => {
                                if (m.id !== msgId) return m;
                                const existing = m.toolCalls || [];
                                const found = existing.find((et) => et.id === tc.id);
                                if (found) return { ...m, toolCalls: existing.map((et) => et.id === tc.id ? { ...et, ...tc, fullArgs: et.fullArgs || tc.fullArgs } : et) };
                                return { ...m, toolCalls: [...existing, tc] };
                            }));
                        }
                        if (parsed.approvalRequest) {
                            const request = parsed.approvalRequest as ApprovalRequest;
                            setPendingApproval({ msgId, request });
                            setMessages((prev) => prev.map((m) => m.id !== msgId ? m : { ...m, isStreaming: false, approvalRequest: request }));
                        }
                    } catch { /* ignore */ }
                }
            }
        } catch { toast.error('Failed to process approval'); } finally { setSending(false); }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    };

    const filteredAgents = agentSearch
        ? agents.filter((a) => a.name.toLowerCase().includes(agentSearch.toLowerCase()))
        : agents;

    return (
        <div className="space-y-6">
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
                                        <Bot className="h-4 w-4 text-primary" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">{agent.name}</p>
                                        <p className="text-[11px] text-muted-foreground truncate">{agent.model.split('/').pop()}</p>
                                    </div>
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
                                        <Bot className="h-4 w-4 text-primary" />
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
                                                        </DropdownMenuItem>
                                                    ))}
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                            <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8" onClick={handleNewSession}><Plus className="h-3.5 w-3.5" />New Chat</Button>
                                            {browserProfile && (
                                                <>
                                                    {browserWsUrl ? (
                                                        <>
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                className="gap-1.5 text-xs h-8"
                                                                onClick={() => setShowBrowserPreview(!showBrowserPreview)}
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
                                    <div className="flex-1 flex min-h-0">
                                        <div className={`flex flex-col ${showBrowserPreview && browserWsUrl ? 'w-1/2' : 'flex-1'}`}>
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
                                                            const { artifact, cleanMessage } = isStreaming
                                                                ? { artifact: null, cleanMessage: text }
                                                                : parseArtifact(text);
                                                            if (!cleanMessage && !artifact && !isStreaming) return null;
                                                            return (
                                                                <div className="flex gap-3">
                                                                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted flex-shrink-0 mt-0.5"><Bot className="h-3.5 w-3.5 text-muted-foreground" /></div>
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-2.5">
                                                                            {isStreaming && !text ? (
                                                                                <span className="inline-flex gap-1">
                                                                                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                                                                                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                                                                                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '300ms' }} />
                                                                                </span>
                                                                            ) : (
                                                                                <>
                                                                                    {cleanMessage && (
                                                                                        <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-2 prose-code:text-xs prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-muted prose-pre:p-3 prose-pre:rounded-lg">
                                                                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                                                                {cleanMessage}
                                                                                            </ReactMarkdown>
                                                                                        </div>
                                                                                    )}
                                                                                    {artifact && (
                                                                                        <div className={`flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5 ${cleanMessage ? 'mt-3' : ''}`}>
                                                                                            <FileIcon type={artifact.type} className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                                                                                            <div className="flex-1 min-w-0">
                                                                                                <p className="text-sm font-medium truncate">{artifact.filename}</p>
                                                                                                <p className="text-[11px] text-muted-foreground">{artifact.type.toUpperCase()}</p>
                                                                                            </div>
                                                                                            <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7 flex-shrink-0" onClick={() => setActiveArtifact(artifact)}>
                                                                                                <Eye className="h-3 w-3" />View
                                                                                            </Button>
                                                                                            <button className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0" onClick={() => downloadArtifact(artifact)} title="Download">
                                                                                                <Download className="h-3.5 w-3.5" />
                                                                                            </button>
                                                                                        </div>
                                                                                    )}
                                                                                </>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        };

                                                        return (
                                                        <Fragment key={msg.id}>
                                                            {msg.role === 'user' ? (
                                                                <div className="flex justify-end">
                                                                    <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[80%]">
                                                                        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
                                                                    </div>
                                                                </div>
                                                            ) : msg.segments && msg.segments.length > 0 ? (
                                                                /* Interleaved rendering: text and tool calls in order */
                                                                <>
                                                                    {msg.segments.map((seg, si) => (
                                                                        <Fragment key={`${msg.id}-seg-${si}`}>
                                                                            {seg.type === 'text' && seg.content.trim() && renderAssistantText(seg.content, msg.isStreaming && si === msg.segments!.length - 1)}
                                                                            {seg.type === 'tools' && (
                                                                                <ToolCallDisplay toolCalls={seg.toolCalls} messageId={`${msg.id}-${si}`} />
                                                                            )}
                                                                        </Fragment>
                                                                    ))}
                                                                    {msg.isStreaming && !msg.content && renderAssistantText('', true)}
                                                                    {msg.approvalRequest && pendingApproval?.msgId === msg.id && (
                                                                        <ApprovalCard
                                                                            request={msg.approvalRequest}
                                                                            onApprove={() => handleApproval(msg.approvalRequest!.toolCalls.map(() => ({ type: 'approve' as const })))}
                                                                            onReject={() => handleApproval(msg.approvalRequest!.toolCalls.map(() => ({ type: 'reject' as const })))}
                                                                            disabled={sending}
                                                                        />
                                                                    )}
                                                                </>
                                                            ) : (
                                                                /* Fallback for loaded messages without segments */
                                                                <>
                                                                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                                                                        <ToolCallDisplay toolCalls={msg.toolCalls} messageId={msg.id} />
                                                                    )}
                                                                    {msg.approvalRequest && pendingApproval?.msgId === msg.id && (
                                                                        <ApprovalCard
                                                                            request={msg.approvalRequest}
                                                                            onApprove={() => handleApproval(msg.approvalRequest!.toolCalls.map(() => ({ type: 'approve' as const })))}
                                                                            onReject={() => handleApproval(msg.approvalRequest!.toolCalls.map(() => ({ type: 'reject' as const })))}
                                                                            disabled={sending}
                                                                        />
                                                                    )}
                                                                    {(msg.content || msg.isStreaming) && renderAssistantText(msg.content, msg.isStreaming)}
                                                                </>
                                                            )}
                                                        </Fragment>
                                                        );
                                                    })
                                                )}
                                                <div ref={messagesEndRef} />
                                            </div>
                                        </div>
                                        <div className="border-t border-border p-4">
                                            <div className="max-w-5xl mx-auto relative">
                                                <textarea ref={textareaRef} value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={handleKeyDown} placeholder={pendingApproval ? "Waiting for your approval..." : "Ask your agent..."} className="w-full resize-none rounded-xl border border-border bg-card px-4 py-3 pr-12 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring min-h-[48px] max-h-[160px] transition-colors" rows={1} disabled={sending || !!pendingApproval} />
                                                <Button onClick={sendMessage} disabled={!chatInput.trim() || sending} size="icon" variant="ghost" className="absolute right-2 bottom-2 h-8 w-8 rounded-lg">
                                                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                                                </Button>
                                            </div>
                                        </div>
                                        </div>

                                        {/* Browser preview column */}
                                        {showBrowserPreview && browserWsUrl && browserSessionId && (
                                            <div className="w-1/2 border-l border-border p-3 overflow-y-auto">
                                                <BrowserPreview
                                                    wsUrl={browserWsUrl}
                                                    sessionId={browserSessionId}
                                                    onClose={() => setShowBrowserPreview(false)}
                                                />
                                            </div>
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
