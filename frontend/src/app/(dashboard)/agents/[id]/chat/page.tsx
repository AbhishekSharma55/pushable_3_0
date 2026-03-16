'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
    ArrowLeft,
    Bot,
    Plus,
    Send,
    Trash2,
    MessageSquare,
    Loader2,
    User,
    Sparkles,
    Shield,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import { getAgents } from '@/lib/api/agents';
import { getSessions, createSession, deleteSession, getMessages } from '@/lib/api/sessions';
import { API_URL } from '@/lib/constants';
import { getToken } from '@/lib/auth';
import type { Agent, Session, Message } from '@/types';

interface ChatMessage extends Message {
    isStreaming?: boolean;
}

export default function ChatPage() {
    const params = useParams();
    const router = useRouter();
    const workspace = useActiveWorkspace();
    const agentId = params.id as string;

    const [agent, setAgent] = useState<Agent | null>(null);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [activeSession, setActiveSession] = useState<Session | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [loadingAgent, setLoadingAgent] = useState(true);
    const [loadingSessions, setLoadingSessions] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [sending, setSending] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    // Fetch agent
    useEffect(() => {
        if (!workspace) return;
        const fetchAgent = async () => {
            try {
                const agents = await getAgents(workspace.id);
                const found = agents.find((a: Agent) => a.id === agentId);
                setAgent(found || null);
            } catch {
                toast.error('Failed to load agent');
            } finally {
                setLoadingAgent(false);
            }
        };
        fetchAgent();
    }, [workspace, agentId]);

    // Fetch sessions
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
        const fetchMessages = async () => {
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
        fetchMessages();
    }, [workspace, activeSession]);

    // Scroll to bottom on new messages
    useEffect(() => {
        scrollToBottom();
    }, [messages, scrollToBottom]);

    const handleNewSession = async () => {
        if (!workspace) return;
        try {
            const session = await createSession(
                workspace.id,
                agentId,
                `Chat ${sessions.length + 1}`
            );
            setSessions((prev) => [...prev, session]);
            setActiveSession(session);
        } catch {
            toast.error('Failed to create session');
        }
    };

    const handleDeleteSession = async (sessionId: string) => {
        if (!workspace) return;
        try {
            await deleteSession(workspace.id, agentId, sessionId);
            if (activeSession?.id === sessionId) {
                setActiveSession(null);
                setMessages([]);
            }
            setSessions((prev) => prev.filter((s) => s.id !== sessionId));
            toast.success('Session deleted');
        } catch {
            toast.error('Failed to delete session');
        }
    };

    const sendMessage = async () => {
        if (!input.trim() || !workspace || !activeSession || sending) return;

        const content = input.trim();
        setInput('');
        setSending(true);

        // Optimistically add user message
        const userMsg: ChatMessage = {
            id: `temp-user-${Date.now()}`,
            sessionId: activeSession.id,
            role: 'user',
            content,
            tokenCount: 0,
            createdAt: new Date().toISOString(),
        };

        // Add empty assistant message with streaming
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
            const response = await fetch(
                `${API_URL}/api/sessions/${activeSession.id}/chat`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                        'x-workspace-id': workspace.id,
                    },
                    body: JSON.stringify({ message: content }),
                }
            );

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
                            // Mark complete
                            setMessages((prev) =>
                                prev.map((m) =>
                                    m.id === assistantMsg.id
                                        ? { ...m, content: fullContent, isStreaming: false }
                                        : m
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
                                        m.id === assistantMsg.id
                                            ? { ...m, content: fullContent }
                                            : m
                                    )
                                );
                            }
                            if (parsed.error) {
                                toast.error(parsed.error);
                            }
                        } catch {
                            // Ignore parse errors
                        }
                    }
                }
            }
        } catch {
            toast.error('Failed to send message');
            // Remove the streaming message on error
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

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
        }
    }, [input]);

    if (loadingAgent) {
        return (
            <div className="flex h-[calc(100vh-120px)] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="flex h-[calc(100vh-120px)] -m-6 -mt-6">
            {/* Session sidebar */}
            <div className="w-[260px] flex-shrink-0 border-r border-border/60 bg-card flex flex-col">
                {/* Sidebar header */}
                <div className="p-4 border-b border-border/60">
                    <div className="flex items-center gap-2 mb-3">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => router.push('/agents')}
                            id="back-to-agents-btn"
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                            <Bot className="h-4 w-4 text-violet-600 flex-shrink-0" />
                            <span className="text-sm font-semibold truncate">
                                {agent?.name || 'Agent'}
                            </span>
                        </div>
                    </div>
                    <div className="flex gap-1.5 mb-2">
                        <Button
                            size="sm"
                            variant="default"
                            className="flex-1 gap-1 text-xs"
                        >
                            <MessageSquare className="h-3 w-3" />
                            Chat
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 gap-1 text-xs"
                            onClick={() => router.push(`/agents/${agentId}/permissions`)}
                        >
                            <Shield className="h-3 w-3" />
                            Permissions
                        </Button>
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        className="w-full gap-1.5"
                        onClick={handleNewSession}
                        id="new-session-btn"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        New Session
                    </Button>
                </div>

                {/* Session list */}
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {loadingSessions ? (
                        Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="p-3">
                                <Skeleton className="h-4 w-28" />
                            </div>
                        ))
                    ) : sessions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-32 text-center px-4">
                            <MessageSquare className="h-5 w-5 text-muted-foreground/50 mb-2" />
                            <p className="text-xs text-muted-foreground">
                                No sessions yet. Start a new one.
                            </p>
                        </div>
                    ) : (
                        sessions.map((session) => (
                            <div
                                key={session.id}
                                className={`group flex items-center gap-2 rounded-lg px-3 py-2.5 cursor-pointer transition-all duration-150 hover:bg-accent ${activeSession?.id === session.id
                                        ? 'bg-accent ring-1 ring-border'
                                        : ''
                                    }`}
                                onClick={() => setActiveSession(session)}
                                id={`session-item-${session.id}`}
                            >
                                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                <span className="text-sm truncate flex-1">
                                    {session.title}
                                </span>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <button
                                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                            onClick={(e) => e.stopPropagation()}
                                            id={`delete-session-${session.id}`}
                                        >
                                            <Trash2 className="h-3 w-3" />
                                        </button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Delete Session</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                Are you sure? This will delete all messages in this session.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction
                                                onClick={() => handleDeleteSession(session.id)}
                                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                            >
                                                Delete
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Chat area */}
            <div className="flex-1 flex flex-col bg-background">
                {activeSession ? (
                    <>
                        {/* Chat header */}
                        <div className="h-14 border-b border-border/60 px-6 flex items-center">
                            <h2 className="text-sm font-medium">{activeSession.title}</h2>
                        </div>

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                            {loadingMessages ? (
                                <div className="space-y-4">
                                    {Array.from({ length: 3 }).map((_, i) => (
                                        <div key={i} className={`flex gap-3 ${i % 2 === 0 ? 'justify-end' : ''}`}>
                                            <div className={`max-w-[70%] ${i % 2 === 0 ? 'order-2' : ''}`}>
                                                <Skeleton className="h-12 w-64 rounded-2xl" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : messages.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                                    <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-500/10 to-blue-500/10 flex items-center justify-center">
                                        <Sparkles className="h-6 w-6 text-violet-500/60" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-muted-foreground">
                                            Start the conversation
                                        </p>
                                        <p className="text-xs text-muted-foreground/70 mt-1">
                                            Send a message to begin chatting with your agent.
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                messages.map((msg) => (
                                    <div
                                        key={msg.id}
                                        className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'
                                            }`}
                                    >
                                        {msg.role !== 'user' && (
                                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/20 to-blue-500/20 flex-shrink-0 mt-1">
                                                <Bot className="h-4 w-4 text-violet-600" />
                                            </div>
                                        )}
                                        <div
                                            className={`max-w-[70%] rounded-2xl px-4 py-3 ${msg.role === 'user'
                                                    ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white'
                                                    : 'bg-muted/70 border border-border/40'
                                                }`}
                                        >
                                            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                                                {msg.content}
                                                {msg.isStreaming && (
                                                    <span className="inline-block w-2 h-4 ml-0.5 bg-current animate-pulse rounded-sm" />
                                                )}
                                            </p>
                                        </div>
                                        {msg.role === 'user' && (
                                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary flex-shrink-0 mt-1">
                                                <User className="h-4 w-4 text-primary-foreground" />
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input bar */}
                        <div className="border-t border-border/60 p-4">
                            <div className="flex items-end gap-3 max-w-4xl mx-auto">
                                <div className="flex-1 relative">
                                    <textarea
                                        ref={textareaRef}
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
                                        className="w-full resize-none rounded-xl border border-border/60 bg-muted/30 px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 min-h-[48px] max-h-[160px] transition-colors"
                                        rows={1}
                                        disabled={sending}
                                        id="chat-input"
                                    />
                                </div>
                                <Button
                                    onClick={sendMessage}
                                    disabled={!input.trim() || sending}
                                    size="icon"
                                    className="h-12 w-12 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 flex-shrink-0"
                                    id="send-message-btn"
                                >
                                    {sending ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Send className="h-4 w-4" />
                                    )}
                                </Button>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
                        <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-violet-500/10 to-blue-500/10 flex items-center justify-center">
                            <MessageSquare className="h-7 w-7 text-muted-foreground/40" />
                        </div>
                        <div>
                            <p className="text-lg font-medium text-muted-foreground">
                                Select a session
                            </p>
                            <p className="text-sm text-muted-foreground/70 mt-1">
                                Choose a session or create a new one to start chatting.
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            onClick={handleNewSession}
                            className="gap-1.5 mt-2"
                        >
                            <Plus className="h-4 w-4" />
                            New Session
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
