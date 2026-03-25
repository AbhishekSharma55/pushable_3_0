import { EventEmitter } from "events";
import { logger } from "./logger.ts";

export interface SSEEvent {
    type: string;
    data: Record<string, unknown>;
    timestamp: number;
}

interface RunState {
    events: SSEEvent[];
    status: "active" | "completed" | "failed";
    emitter: EventEmitter;
    cleanupTimer?: ReturnType<typeof setTimeout>;
}

/** How long to keep completed run events in memory for late reconnections */
const CLEANUP_DELAY_MS = 5 * 60 * 1000; // 5 minutes

/** How long an interrupted run can stay in memory before forced cleanup */
const INTERRUPTED_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

class RunEventBus {
    private runs = new Map<string, RunState>();

    /** Get existing run state. Does NOT auto-create. */
    private get(runId: string): RunState | undefined {
        return this.runs.get(runId);
    }

    /** Initialize state for a new run. Call this when creating a run. */
    init(runId: string): void {
        if (this.runs.has(runId)) return;
        const emitter = new EventEmitter();
        emitter.setMaxListeners(50); // Support multiple browser tabs
        this.runs.set(runId, {
            events: [],
            status: "active",
            emitter,
        });
    }

    /** Emit an event for a run. Buffers it and notifies all subscribers. */
    emit(runId: string, event: SSEEvent): void {
        const state = this.get(runId);
        if (!state) {
            // Run was cleaned up or never initialized — silently drop
            logger.warn({ runId }, "Emit called for unknown run, dropping event");
            return;
        }
        state.events.push(event);
        state.emitter.emit("event", event);
    }

    /**
     * Subscribe to events for a run.
     * Replays all buffered events immediately, then streams live events.
     * Returns an unsubscribe function.
     *
     * If the run was already cleaned up, calls onDone immediately.
     */
    subscribe(
        runId: string,
        onEvent: (event: SSEEvent) => void,
        onDone: () => void
    ): () => void {
        const state = this.get(runId);

        // Run was cleaned up or never existed — signal done immediately
        if (!state) {
            onDone();
            return () => {};
        }

        // Replay buffered events
        for (const event of state.events) {
            onEvent(event);
        }

        // If already completed/failed, signal done immediately
        if (state.status !== "active") {
            onDone();
            return () => {};
        }

        // Subscribe to live events
        const eventHandler = (event: SSEEvent) => onEvent(event);
        const doneHandler = () => onDone();

        state.emitter.on("event", eventHandler);
        state.emitter.once("done", doneHandler);

        return () => {
            state.emitter.off("event", eventHandler);
            state.emitter.off("done", doneHandler);
        };
    }

    /** Mark a run as completed. Notifies subscribers and schedules cleanup. */
    complete(runId: string): void {
        const state = this.get(runId);
        if (!state) return;

        state.status = "completed";
        state.emitter.emit("done");
        state.emitter.removeAllListeners();
        this.scheduleCleanup(runId, state);
    }

    /** Mark a run as failed. Notifies subscribers and schedules cleanup. */
    fail(runId: string, error: string): void {
        const state = this.get(runId);
        if (!state) return;

        // Emit an error event so subscribers can show it
        const errorEvent: SSEEvent = {
            type: "error",
            data: { error },
            timestamp: Date.now(),
        };
        state.events.push(errorEvent);

        state.status = "failed";
        state.emitter.emit("event", errorEvent);
        state.emitter.emit("done");
        state.emitter.removeAllListeners();
        this.scheduleCleanup(runId, state);
    }

    /**
     * Mark a run as interrupted (HITL).
     * Keeps events in memory but schedules a safety timeout to prevent
     * indefinite memory leaks if the user never approves.
     */
    markInterrupted(runId: string): void {
        const state = this.get(runId);
        if (!state) return;

        // Schedule a safety cleanup after 30 minutes
        state.cleanupTimer = setTimeout(() => {
            logger.warn({ runId }, "Interrupted run timed out, cleaning up");
            this.fail(runId, "Run timed out waiting for approval.");
        }, INTERRUPTED_TIMEOUT_MS);
    }

    /**
     * Clear the interrupted timeout when a run resumes.
     * Call this before emitting new events for the resumed run.
     */
    clearInterruptedTimeout(runId: string): void {
        const state = this.get(runId);
        if (state?.cleanupTimer) {
            clearTimeout(state.cleanupTimer);
            state.cleanupTimer = undefined;
        }
    }

    /**
     * Clear old buffered events for a run that is being resumed.
     * Prevents replaying stale approvalRequest events to new subscribers.
     * The run stays active so new events can be emitted and streamed.
     */
    clearEventsForResume(runId: string): void {
        const state = this.get(runId);
        if (state) {
            state.events = [];
            state.status = "active";
        }
    }

    /** Check if a run is still active in the event bus. */
    isActive(runId: string): boolean {
        return this.get(runId)?.status === "active";
    }

    /** Check if events are buffered for a run (even after completion). */
    hasEvents(runId: string): boolean {
        return this.runs.has(runId);
    }

    /**
     * Build a snapshot of accumulated state from buffered events.
     * Used by the active-run endpoint so the frontend can display
     * intermediate tool calls / content immediately on reconnect.
     */
    getSnapshot(runId: string): {
        content: string;
        toolCalls: Record<string, unknown>[];
        thinking: string;
        eventCount: number;
    } | null {
        const state = this.get(runId);
        if (!state || state.events.length === 0) return null;

        let content = "";
        let thinking = "";
        const toolCallMap = new Map<string, Record<string, unknown>>();

        for (const event of state.events) {
            const data = event.data;
            if (typeof data.content === "string") {
                content += data.content;
            }
            if (typeof data.thinkingContent === "string") {
                thinking += data.thinkingContent;
            }
            if (data.toolCall && typeof (data.toolCall as Record<string, unknown>).id === "string") {
                const tc = data.toolCall as Record<string, unknown>;
                toolCallMap.set(tc.id as string, tc);
            }
        }

        return {
            content,
            toolCalls: [...toolCallMap.values()],
            thinking,
            eventCount: state.events.length,
        };
    }

    /** Get the count of buffered events (for offset-based replay). */
    getEventCount(runId: string): number {
        return this.get(runId)?.events.length ?? 0;
    }

    /**
     * Subscribe to events starting from an offset (for reconnection).
     * Only replays events from `fromIndex` onwards, then streams live.
     */
    subscribeFrom(
        runId: string,
        fromIndex: number,
        onEvent: (event: SSEEvent, index: number) => void,
        onDone: () => void
    ): () => void {
        const state = this.get(runId);

        if (!state) {
            onDone();
            return () => {};
        }

        // Replay buffered events from offset
        for (let i = fromIndex; i < state.events.length; i++) {
            onEvent(state.events[i], i);
        }

        if (state.status !== "active") {
            onDone();
            return () => {};
        }

        // Subscribe to live events (with index tracking)
        let currentIndex = state.events.length;
        const eventHandler = (event: SSEEvent) => {
            onEvent(event, currentIndex);
            currentIndex++;
        };
        const doneHandler = () => onDone();

        state.emitter.on("event", eventHandler);
        state.emitter.once("done", doneHandler);

        return () => {
            state.emitter.off("event", eventHandler);
            state.emitter.off("done", doneHandler);
        };
    }

    private scheduleCleanup(runId: string, state: RunState): void {
        if (state.cleanupTimer) {
            clearTimeout(state.cleanupTimer);
        }
        state.cleanupTimer = setTimeout(() => {
            this.runs.delete(runId);
            logger.info({ runId }, "Run events cleaned up from memory");
        }, CLEANUP_DELAY_MS);
    }
}

export const runEventBus = new RunEventBus();
