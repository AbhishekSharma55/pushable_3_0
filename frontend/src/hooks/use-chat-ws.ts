'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getMessages, sendChat, getActiveRun, createSession, approveRun } from '@/lib/api/sessions';
import { parseSessionIdFromKey } from './use-sessions';
import { useActiveWorkspace } from './use-active-workspace';
import { getToken } from '@/lib/auth';
import { API_URL } from '@/lib/constants';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    status?: 'thinking' | 'done' | 'error';
    metadata?: {
        toolCalls?: StreamToolCall[];
        segments?: StreamSegment[];
        approvalRequest?: unknown;
    };
}

interface StreamToolCall {
    id: string;
    name: string;
    args?: string;
    type: string;
    status: string;
    result?: string;
}

interface StreamSegment {
    type: 'text' | 'tools';
    content?: string;
    toolCalls?: StreamToolCall[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

/** Parse agentId from key format "agent:<agentId>:<rest>" */
function parseAgentId(key: string): string {
    const parts = key.trim().toLowerCase().split(':');
    if (parts.length >= 3 && parts[0] === 'agent') {
        return parts[1] ?? '';
    }
    return '';
}

/** Map DB messages to ChatMessage format */
function mapDbMessages(dbMessages: Array<Record<string, unknown>>): ChatMessage[] {
    return dbMessages
        .filter((m) => (m.role as string) !== 'tool')
        .map((m) => ({
            id: m.id as string,
            role: m.role as 'user' | 'assistant',
            content: m.content as string,
            status: 'done' as const,
            metadata: m.metadata as ChatMessage['metadata'],
        }));
}

// ─── SSE Stream Reader (with fetch streaming) ───────────────────────────────

async function connectSSE(
    runId: string,
    workspaceId: string,
    signal: AbortSignal,
    onContent: (chunk: string) => void,
    onToolCall: (tc: StreamToolCall) => void,
    onApprovalRequest: (payload: unknown) => void,
    onError: (error: string) => void,
    onDone: () => void
): Promise<void> {
    const token = getToken();
    const url = `${API_URL}/api/runs/${runId}/events`;

    try {
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'x-workspace-id': workspaceId,
            },
            signal,
        });

        if (!response.ok || !response.body) {
            // SSE connection failed — will fall back to polling
            onError(`SSE error: ${response.status}`);
            onDone();
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const payload = line.slice(6).trim();

                if (payload === '[DONE]') {
                    onDone();
                    return;
                }

                try {
                    const data = JSON.parse(payload);
                    if (data.content) onContent(data.content as string);
                    if (data.toolCall) onToolCall(data.toolCall as StreamToolCall);
                    if (data.approvalRequest) onApprovalRequest(data.approvalRequest);
                    if (data.error) onError(data.error as string);
                } catch {
                    // Skip malformed JSON
                }
            }
        }

        // Stream ended without [DONE] — call onDone as fallback
        onDone();
    } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        // SSE failed — will fall back to polling
        throw err;
    }
}

// ─── Polling fallback ───────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 1500;

/**
 * Poll the active-run and messages endpoints until the run completes.
 * This is the fallback when SSE doesn't work (CORS, proxy, etc.).
 */
function startPolling(
    sessionId: string,
    workspaceId: string,
    runId: string,
    signal: AbortSignal,
    onMessages: (msgs: ChatMessage[]) => void,
    onDone: () => void,
    onError: (error: string) => void,
    onApprovalRequest: (payload: unknown) => void
): void {
    const poll = async () => {
        if (signal.aborted) return;

        try {
            // Check run status
            const run = await getActiveRun(workspaceId, sessionId);

            // Load latest messages
            const dbMessages = await getMessages(workspaceId, sessionId);
            if (signal.aborted) return;
            onMessages(mapDbMessages(dbMessages as Array<Record<string, unknown>>));

            if (!run) {
                // Run completed (no active run found) — we're done
                onDone();
                return;
            }

            const runStatus = (run as Record<string, unknown>).status as string;

            if (runStatus === 'completed' || runStatus === 'failed' || runStatus === 'cancelled') {
                if (runStatus === 'failed') {
                    onError((run as Record<string, unknown>).error as string || 'Run failed');
                }
                onDone();
                return;
            }

            if (runStatus === 'interrupted') {
                // HITL interrupt — show approval request
                onApprovalRequest(run);
                return; // Stop polling, wait for user action
            }

            // Still running — poll again
            setTimeout(poll, POLL_INTERVAL_MS);
        } catch {
            if (!signal.aborted) {
                setTimeout(poll, POLL_INTERVAL_MS);
            }
        }
    };

    // Start first poll after a short delay (give SSE a chance first)
    setTimeout(poll, POLL_INTERVAL_MS);
}

// ─── Main Hook ──────────────────────────────────────────────────────────────

export function useChatWs(sessionKey: string) {
    const workspace = useActiveWorkspace();
    const workspaceId = workspace?.id ?? '';

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [historyLoaded, setHistoryLoaded] = useState(false);
    const [resolvedSessionId, setResolvedSessionId] = useState<string | null>(null);

    // Refs
    const sessionIdRef = useRef<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const activeRunIdRef = useRef<string | null>(null);
    const thinkingIdRef = useRef<string | null>(null);

    // ── Watch a run: try SSE, fall back to polling ───────────────────────────

    const watchRun = useCallback(
        (runId: string, sessionId: string) => {
            if (!workspaceId) return;

            // Abort any previous watcher
            abortRef.current?.abort();
            const abort = new AbortController();
            abortRef.current = abort;
            activeRunIdRef.current = runId;

            // Add thinking placeholder
            const thinkingId = generateId();
            thinkingIdRef.current = thinkingId;
            setMessages((prev) => [
                ...prev,
                { id: thinkingId, role: 'assistant', content: '', status: 'thinking' },
            ]);

            setIsLoading(true);

            let sseSucceeded = false;

            // Try SSE first
            connectSSE(
                runId,
                workspaceId,
                abort.signal,
                // onContent
                (chunk) => {
                    sseSucceeded = true;
                    setMessages((prev) =>
                        prev.map((m) =>
                            m.id === thinkingId
                                ? { ...m, content: m.content + chunk, status: 'thinking' }
                                : m
                        )
                    );
                },
                // onToolCall
                (tc) => {
                    sseSucceeded = true;
                    setMessages((prev) =>
                        prev.map((m) => {
                            if (m.id !== thinkingId) return m;
                            const existing = m.metadata?.toolCalls ?? [];
                            const idx = existing.findIndex((t) => t.id === tc.id);
                            const updated =
                                idx >= 0
                                    ? existing.map((t, i) => (i === idx ? tc : t))
                                    : [...existing, tc];
                            return { ...m, metadata: { ...m.metadata, toolCalls: updated } };
                        })
                    );
                },
                // onApprovalRequest
                (payload) => {
                    sseSucceeded = true;
                    setMessages((prev) =>
                        prev.map((m) =>
                            m.id === thinkingId
                                ? { ...m, status: 'done' as const, metadata: { ...m.metadata, approvalRequest: payload } }
                                : m
                        )
                    );
                    setIsLoading(false);
                },
                // onError
                (error) => {
                    // Don't show SSE errors — polling will handle it
                    console.warn('[SSE] error:', error);
                },
                // onDone
                () => {
                    if (sseSucceeded) {
                        setMessages((prev) =>
                            prev.map((m) =>
                                m.id === thinkingId ? { ...m, status: 'done' as const } : m
                            )
                        );
                        setIsLoading(false);
                        activeRunIdRef.current = null;
                        thinkingIdRef.current = null;
                    }
                }
            ).catch(() => {
                // SSE failed entirely — polling fallback will pick it up
                console.warn('[SSE] connection failed, relying on polling fallback');
            });

            // Start polling as a fallback in parallel.
            // If SSE works, polling will find the run completed and stop.
            // If SSE fails, polling will deliver the response.
            startPolling(
                sessionId,
                workspaceId,
                runId,
                abort.signal,
                // onMessages — replace all messages with fresh DB data
                (freshMessages) => {
                    if (abort.signal.aborted) return;
                    // Only use polling messages if SSE hasn't delivered content
                    if (!sseSucceeded) {
                        // Remove the thinking placeholder and replace with real messages
                        setMessages(freshMessages);
                    }
                },
                // onDone
                () => {
                    if (abort.signal.aborted) return;
                    if (!sseSucceeded) {
                        // SSE didn't work — polling delivered the result
                        setIsLoading(false);
                        activeRunIdRef.current = null;
                        thinkingIdRef.current = null;
                    }
                },
                // onError
                (error) => {
                    if (abort.signal.aborted) return;
                    if (!sseSucceeded) {
                        setMessages((prev) => [
                            ...prev.filter((m) => m.id !== thinkingId),
                            { id: generateId(), role: 'assistant', content: error, status: 'error' },
                        ]);
                        setIsLoading(false);
                    }
                },
                // onApprovalRequest (from polling)
                (payload) => {
                    if (abort.signal.aborted || sseSucceeded) return;
                    setMessages((prev) =>
                        prev.map((m) =>
                            m.id === thinkingId
                                ? { ...m, status: 'done' as const, metadata: { ...m.metadata, approvalRequest: payload } }
                                : m
                        )
                    );
                    setIsLoading(false);
                }
            );
        },
        [workspaceId]
    );

    // ── Load history + detect active runs on session change ──────────────────

    useEffect(() => {
        if (!workspaceId || !sessionKey) return;

        // Reset state
        abortRef.current?.abort();
        setMessages([]);
        setIsLoading(false);
        setHistoryLoaded(false);
        sessionIdRef.current = null;
        setResolvedSessionId(null);
        activeRunIdRef.current = null;
        thinkingIdRef.current = null;

        const sessionId = parseSessionIdFromKey(sessionKey);
        if (!sessionId) {
            // New session — no history to load
            setHistoryLoaded(true);
            return;
        }

        sessionIdRef.current = sessionId;
        setResolvedSessionId(sessionId);

        let cancelled = false;

        const loadHistory = async () => {
            try {
                const dbMessages = await getMessages(workspaceId, sessionId);
                if (cancelled) return;
                setMessages(mapDbMessages(dbMessages as Array<Record<string, unknown>>));

                // Check for active run (handles page refresh during execution)
                const activeRun = await getActiveRun(workspaceId, sessionId);
                if (cancelled) return;

                if (activeRun) {
                    watchRun((activeRun as Record<string, unknown>).id as string, sessionId);
                }
            } catch {
                // Session might not exist yet
            } finally {
                if (!cancelled) setHistoryLoaded(true);
            }
        };

        loadHistory();

        return () => {
            cancelled = true;
            abortRef.current?.abort();
        };
    }, [sessionKey, workspaceId, watchRun]);

    // ── Send a message ──────────────────────────────────────────────────────

    const sendMessage = useCallback(
        async (text: string) => {
            if (!workspaceId || !text.trim() || isLoading) return;

            const agentId = parseAgentId(sessionKey);

            // Ensure session exists
            let sessionId = sessionIdRef.current;
            if (!sessionId) {
                if (!agentId) return;
                try {
                    const session = await createSession(workspaceId, agentId, text.slice(0, 50) || 'Chat');
                    sessionId = (session as { id: string }).id;
                    sessionIdRef.current = sessionId;
                    setResolvedSessionId(sessionId);
                } catch {
                    setMessages((prev) => [
                        ...prev,
                        { id: generateId(), role: 'assistant', content: 'Failed to create session. Please try again.', status: 'error' },
                    ]);
                    return;
                }
            }

            // Optimistic user message
            setMessages((prev) => [
                ...prev,
                { id: generateId(), role: 'user', content: text, status: 'done' },
            ]);

            setIsLoading(true);

            try {
                const result = await sendChat(workspaceId, sessionId, text);
                const runId = (result as { runId: string }).runId;
                watchRun(runId, sessionId);
            } catch {
                setIsLoading(false);
                setMessages((prev) => [
                    ...prev,
                    { id: generateId(), role: 'assistant', content: 'Failed to send message. Please try again.', status: 'error' },
                ]);
            }
        },
        [workspaceId, sessionKey, isLoading, watchRun]
    );

    // ── Send approval decisions for HITL ─────────────────────────────────────

    const sendApproval = useCallback(
        async (decisions: Array<{ type: string; args?: Record<string, unknown>; message?: string }>) => {
            const runId = activeRunIdRef.current;
            const sessionId = sessionIdRef.current;
            if (!workspaceId || !runId || !sessionId) return;

            setIsLoading(true);

            try {
                await approveRun(workspaceId, runId, decisions);
                watchRun(runId, sessionId);
            } catch {
                setIsLoading(false);
                setMessages((prev) => [
                    ...prev,
                    { id: generateId(), role: 'assistant', content: 'Failed to send approval. Please try again.', status: 'error' },
                ]);
            }
        },
        [workspaceId, watchRun]
    );

    return { messages, sendMessage, sendApproval, isLoading, historyLoaded, sessionId: resolvedSessionId };
}
