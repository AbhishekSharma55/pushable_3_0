'use client';

import { useEffect, useState, useCallback, useRef, Fragment } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
    Bot,
    Plus,
    Send,
    Search,
    Loader2,
    User,
    Sparkles,
    ChevronDown,
    ChevronRight,
    CheckCircle2,
    Clock,
    ArrowUp,
    Monitor,
    Square,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import { getAgents } from '@/lib/api/agents';
import { getSessions, createSession, getMessages } from '@/lib/api/sessions';
import { getProfiles, startSession as startBrowserSession, endSession as endBrowserSession } from '@/lib/api/browser';
import { BrowserPreview } from '@/components/browser/browser-preview';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { API_URL } from '@/lib/constants';
import { getToken } from '@/lib/auth';
import type { Agent, Session, Message, BrowserProfile } from '@/types';

interface ToolCallEvent {
    id: string;
    name: string;
    args?: string;
    type: 'tool' | 'agent';
    status: 'running' | 'done';
    result?: string;
}

interface ChatMessage extends Message {
    isStreaming?: boolean;
    toolCalls?: ToolCallEvent[];
}

export default function ChatPage() {
    const params = useParams();
    const router = useRouter();
    const workspace = useActiveWorkspace();
    const agentId = params.id as string;

    const [agents, setAgents] = useState<Agent[]>([]);
    const [agent, setAgent] = useState<Agent | null>(null);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [activeSession, setActiveSession] = useState<Session | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [agentSearch, setAgentSearch] = useState('');
    const [loadingAgents, setLoadingAgents] = useState(true);
    const [loadingSessions, setLoadingSessions] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [sending, setSending] = useState(false);
    const [expandedToolCalls, setExpandedToolCalls] = useState<Set<string>>(new Set());

    // Browser preview state
    const [browserProfile, setBrowserProfile] = useState<BrowserProfile | null>(null);
    const [browserWsUrl, setBrowserWsUrl] = useState<string | null>(null);
    const [browserSessionId, setBrowserSessionId] = useState<string | null>(null);
    const [startingBrowser, setStartingBrowser] = useState(false);
    const [showBrowserPreview, setShowBrowserPreview] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const toggleToolCall = (key: string) => {
        setExpandedToolCalls((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    // Fetch all agents
    useEffect(() => {
        if (!workspace) return;
        const fetch = async () => {
            try {
                const data = await getAgents(workspace.id);
                setAgents(data);
                setAgent(data.find((a: Agent) => a.id === agentId) || null);
            } catch {
                toast.error('Failed to load agents');
            } finally {
                setLoadingAgents(false);
            }
        };
        fetch();
    }, [workspace, agentId]);

    // Fetch sessions for current agent
    const fetchSessions = useCallback(async () => {
        if (!workspace) return;
        try {
            setLoadingSessions(true);
            const data = await getSessions(workspace.id, agentId);
            setSessions(data);
        } catch {
            toast.error('Failed to load sessions');
        } finally {
            setLoadingSessions(false);
        }
    }, [workspace, agentId]);

    useEffect(() => {
        fetchSessions();
    }, [fetchSessions]);

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
                setMessages(data);
            } catch {
                toast.error('Failed to load messages');
            } finally {
                setLoadingMessages(false);
            }
        };
        fetch();
    }, [workspace, activeSession]);

    useEffect(() => {
        scrollToBottom();
    }, [messages, scrollToBottom]);

    const handleNewSession = async () => {
        if (!workspace) return;
        try {
            const session = await createSession(workspace.id, agentId, `Chat ${sessions.length + 1}`);
            setSessions((prev) => [...prev, session]);
            setActiveSession(session);
        } catch {
            toast.error('Failed to create session');
        }
    };

    const handleAgentSwitch = (id: string) => {
        router.push(`/agents/${id}/chat`);
    };

    // Fetch browser profile for this agent
    useEffect(() => {
        if (!workspace || !agentId) return;
        getProfiles(workspace.id)
            .then((profiles) => {
                const assigned = profiles.find(
                    (p) => p.assignedAgentId === agentId && p.status === 'active'
                );
                setBrowserProfile(assigned || null);
            })
            .catch(() => {});
    }, [workspace, agentId]);

    const handleStartBrowser = async () => {
        if (!workspace || !browserProfile) return;
        setStartingBrowser(true);
        try {
            const { sessionId, wsUrl } = await startBrowserSession(
                workspace.id,
                browserProfile.id,
                agentId
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
        if (!input.trim() || !workspace || !activeSession || sending) return;

        const content = input.trim();
        setInput('');
        setSending(true);

        const userMsg: ChatMessage = {
            id: `temp-user-${Date.now()}`,
            sessionId: activeSession.id,
            role: 'user',
            content,
            tokenCount: 0,
            createdAt: new Date().toISOString(),
        };

        const assistantMsg: ChatMessage = {
            id: `temp-assistant-${Date.now()}`,
            sessionId: activeSession.id,
            role: 'assistant',
            content: '',
            tokenCount: 0,
            createdAt: new Date().toISOString(),
            isStreaming: true,
        };

        setMessages((prev) => [...prev, userMsg, assistantMsg]);

        try {
            const token = getToken();
            const response = await fetch(`${API_URL}/api/sessions/${activeSession.id}/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    'x-workspace-id': workspace.id,
                },
                body: JSON.stringify({ message: content }),
            });

            if (!response.ok) throw new Error('Failed to send message');
            if (!response.body) throw new Error('No response body');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullContent = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') {
                            setMessages((prev) =>
                                prev.map((m) =>
                                    m.id === assistantMsg.id ? { ...m, content: fullContent, isStreaming: false } : m
                                )
                            );
                            continue;
                        }
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.content) {
                                fullContent += parsed.content;
                                setMessages((prev) =>
                                    prev.map((m) =>
                                        m.id === assistantMsg.id ? { ...m, content: fullContent } : m
                                    )
                                );
                            }
                            if (parsed.toolCall) {
                                const tc = parsed.toolCall as ToolCallEvent;
                                setMessages((prev) =>
                                    prev.map((m) => {
                                        if (m.id !== assistantMsg.id) return m;
                                        const existing = m.toolCalls || [];
                                        if (tc.status === 'running') {
                                            return { ...m, toolCalls: [...existing, tc] };
                                        }
                                        return {
                                            ...m,
                                            toolCalls: existing.map((et) =>
                                                et.id === tc.id ? { ...et, status: tc.status, result: tc.result, name: tc.name } : et
                                            ),
                                        };
                                    })
                                );
                            }
                            if (parsed.error) toast.error(parsed.error);
                        } catch {
                            // Ignore parse errors
                        }
                    }
                }
            }
        } catch {
            toast.error('Failed to send message');
            setMessages((prev) => prev.filter((m) => m.id !== assistantMsg.id));
        } finally {
            setSending(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
        }
    }, [input]);

    const filteredAgents = agentSearch
        ? agents.filter((a) => a.name.toLowerCase().includes(agentSearch.toLowerCase()))
        : agents;

    if (loadingAgents) {
        return (
            <div className="flex h-[calc(100vh-120px)] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="flex h-[calc(100vh-120px)] -m-6 -mt-6">
            {/* Left — Agent list */}
            <div className="w-[220px] flex-shrink-0 border-r border-border bg-card flex flex-col">
                <div className="p-3 border-b border-border">
                    <div className="flex items-center justify-between mb-2">
                        <h2 className="text-sm font-semibold">Agents</h2>
                        <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={() => router.push('/agents')}
                        >
                            <Plus className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                    <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                            placeholder="Search agents..."
                            value={agentSearch}
                            onChange={(e) => setAgentSearch(e.target.value)}
                            className="h-8 pl-7 text-xs"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
                    {filteredAgents.map((a) => (
                        <button
                            key={a.id}
                            className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                                a.id === agentId
                                    ? 'bg-accent text-accent-foreground'
                                    : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                            }`}
                            onClick={() => handleAgentSwitch(a.id)}
                        >
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 flex-shrink-0">
                                <Bot className="h-4 w-4 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{a.name}</p>
                                <p className="text-[11px] text-muted-foreground truncate">
                                    {a.model.split('/').pop()}
                                </p>
                            </div>
                            {a.id === agentId && (
                                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* Right — Chat area */}
            <div className="flex-1 flex flex-col bg-background">
                {/* Chat header with agent info + session dropdown */}
                <div className="h-14 border-b border-border px-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                            <Bot className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                            <p className="text-sm font-semibold">{agent?.name || 'Agent'}</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Session dropdown */}
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
                                    ) : (
                                        'Select session'
                                    )}
                                    <ChevronDown className="h-3 w-3" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-[240px]">
                                {loadingSessions ? (
                                    <div className="p-2">
                                        <Skeleton className="h-4 w-32" />
                                    </div>
                                ) : sessions.length === 0 ? (
                                    <div className="p-3 text-center text-xs text-muted-foreground">
                                        No sessions yet
                                    </div>
                                ) : (
                                    sessions.map((s) => (
                                        <DropdownMenuItem
                                            key={s.id}
                                            className={`text-xs ${activeSession?.id === s.id ? 'bg-accent' : ''}`}
                                            onClick={() => setActiveSession(s)}
                                        >
                                            <span className="flex-1 truncate">{s.title}</span>
                                            <span className="text-muted-foreground ml-2">
                                                {new Date(s.createdAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                                            </span>
                                        </DropdownMenuItem>
                                    ))
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>

                        <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8" onClick={handleNewSession}>
                            <Plus className="h-3.5 w-3.5" />
                            New Chat
                        </Button>

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
                    </div>
                </div>

                {/* Messages area */}
                {activeSession ? (
                    <div className="flex-1 flex min-h-0">
                        {/* Chat column */}
                        <div className={`flex flex-col ${showBrowserPreview && browserWsUrl ? 'w-1/2' : 'flex-1'}`}>
                        <div className="flex-1 overflow-y-auto">
                            <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
                                {loadingMessages ? (
                                    <div className="space-y-6">
                                        {Array.from({ length: 3 }).map((_, i) => (
                                            <div key={i} className="space-y-2">
                                                <Skeleton className="h-4 w-48" />
                                                <Skeleton className="h-16 w-full rounded-lg" />
                                            </div>
                                        ))}
                                    </div>
                                ) : messages.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center gap-3">
                                        <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                                            <Sparkles className="h-5 w-5 text-primary/60" />
                                        </div>
                                        <p className="text-sm text-muted-foreground">
                                            Send a message to start chatting with {agent?.name || 'your agent'}.
                                        </p>
                                    </div>
                                ) : (
                                    messages.map((msg) => (
                                        <Fragment key={msg.id}>
                                            {/* Tool call indicators */}
                                            {msg.toolCalls && msg.toolCalls.length > 0 && (
                                                <div className="space-y-1.5">
                                                    {msg.toolCalls.map((tc) => {
                                                        const key = `${msg.id}-${tc.id}`;
                                                        const isExpanded = expandedToolCalls.has(key);
                                                        const isDone = tc.status === 'done';
                                                        return (
                                                            <div key={tc.id}>
                                                                <button
                                                                    className="w-full flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs hover:bg-accent/50 transition-colors"
                                                                    onClick={() => isDone && toggleToolCall(key)}
                                                                >
                                                                    {isDone ? (
                                                                        <CheckCircle2 className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                                                                    ) : (
                                                                        <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin flex-shrink-0" />
                                                                    )}
                                                                    <span className="flex-1 text-left truncate text-muted-foreground">
                                                                        {tc.name}
                                                                        {tc.args && !isDone ? `: ${tc.args}` : ''}
                                                                    </span>
                                                                    {isDone && (
                                                                        isExpanded
                                                                            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                                                            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                                                    )}
                                                                </button>
                                                                {isDone && tc.result && isExpanded && (
                                                                    <div className="mt-1 rounded-lg border border-border bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground font-mono max-h-[160px] overflow-y-auto whitespace-pre-wrap">
                                                                        {tc.result}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}

                                            {/* Message */}
                                            {(msg.content || msg.isStreaming || msg.role === 'user') && (
                                                <div className={msg.role === 'user' ? 'flex justify-end' : ''}>
                                                    {msg.role === 'user' ? (
                                                        <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[80%]">
                                                            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                                                                {msg.content}
                                                            </p>
                                                        </div>
                                                    ) : (
                                                        <div className="flex gap-3">
                                                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted flex-shrink-0 mt-0.5">
                                                                <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-2.5">
                                                                    {msg.isStreaming && !msg.content ? (
                                                                        <span className="inline-flex gap-1">
                                                                            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                                                                            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                                                                            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '300ms' }} />
                                                                        </span>
                                                                    ) : (
                                                                        <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-2 prose-code:text-xs prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-muted prose-pre:p-3 prose-pre:rounded-lg">
                                                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                                                {msg.content}
                                                                            </ReactMarkdown>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </Fragment>
                                    ))
                                )}
                                <div ref={messagesEndRef} />
                            </div>
                        </div>

                        {/* Input bar */}
                        <div className="border-t border-border p-4">
                            <div className="max-w-3xl mx-auto relative">
                                <textarea
                                    ref={textareaRef}
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Ask your agent..."
                                    className="w-full resize-none rounded-xl border border-border bg-card px-4 py-3 pr-12 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring min-h-[48px] max-h-[160px] transition-colors"
                                    rows={1}
                                    disabled={sending}
                                />
                                <Button
                                    onClick={sendMessage}
                                    disabled={!input.trim() || sending}
                                    size="icon"
                                    variant="ghost"
                                    className="absolute right-2 bottom-2 h-8 w-8 rounded-lg"
                                >
                                    {sending ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <ArrowUp className="h-4 w-4" />
                                    )}
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
                        <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
                            <Sparkles className="h-6 w-6 text-muted-foreground/40" />
                        </div>
                        <div>
                            <p className="text-base font-medium text-muted-foreground">
                                Start a conversation
                            </p>
                            <p className="text-sm text-muted-foreground/70 mt-1">
                                Select a session from the dropdown or create a new one.
                            </p>
                        </div>
                        <Button variant="outline" onClick={handleNewSession} className="gap-1.5 mt-2">
                            <Plus className="h-4 w-4" />
                            New Chat
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
