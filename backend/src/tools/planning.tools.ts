import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * Internal todo/plan state that lives in the agent graph state.
 * The agent uses write_todos to create a plan, then executes each step.
 */
export interface Todo {
    id: string;
    title: string;
    status: "pending" | "in_progress" | "completed";
    result?: string;
}

/**
 * Build the planning tools that let the agent manage its own task list.
 * The todos are stored in graph state (via the reducer) and persist
 * across turns via the checkpointer.
 *
 * @param getTodos - getter for current todos from graph state
 * @param setTodos - setter to update todos in graph state (returns updated list)
 */
export function buildPlanningTools(
    getTodos: () => Todo[],
    setTodos: (todos: Todo[]) => void
): DynamicStructuredTool[] {
    return [
        new DynamicStructuredTool({
            name: "write_todos",
            description:
                "Create or replace your internal plan/task list. Use this to break down complex tasks into steps " +
                "before executing them. Each todo has a title and starts as 'pending'. " +
                "Call this ONCE at the start to set up your plan, then use update_todo to track progress.",
            schema: z.object({
                todos: z.array(
                    z.object({
                        id: z.string().describe("Unique short ID for this step (e.g. 'step_1', 'research', 'draft')"),
                        title: z.string().describe("What this step does"),
                    })
                ).describe("List of steps in your plan"),
            }),
            func: async ({ todos }) => {
                const newTodos: Todo[] = todos.map((t: { id: string; title: string }) => ({
                    id: t.id,
                    title: t.title,
                    status: "pending" as const,
                }));
                setTodos(newTodos);
                const lines = newTodos.map((t, i) => `${i + 1}. [pending] ${t.title}`).join("\n");
                return `Plan created with ${newTodos.length} steps:\n${lines}`;
            },
        }),

        new DynamicStructuredTool({
            name: "update_todo",
            description:
                "Update the status of a todo in your plan. Call this as you start and complete each step.",
            schema: z.object({
                id: z.string().describe("The todo ID to update"),
                status: z.enum(["in_progress", "completed"]).describe("New status"),
                result: z.string().optional().describe("Brief result or output from this step (when completing)"),
            }),
            func: async ({ id, status, result }) => {
                const todos = getTodos();
                const todo = todos.find((t) => t.id === id);
                if (!todo) {
                    return `Todo "${id}" not found. Available: ${todos.map((t) => t.id).join(", ")}`;
                }
                todo.status = status;
                if (result) todo.result = result;
                setTodos([...todos]);

                const completed = todos.filter((t) => t.status === "completed").length;
                const total = todos.length;
                const lines = todos.map((t) => {
                    const icon = t.status === "completed" ? "done" : t.status === "in_progress" ? "..." : " ";
                    return `[${icon}] ${t.title}${t.result ? ` → ${t.result}` : ""}`;
                }).join("\n");
                return `Updated "${todo.title}" to ${status}. Progress: ${completed}/${total}\n${lines}`;
            },
        }),

        new DynamicStructuredTool({
            name: "get_todos",
            description: "View your current plan and progress.",
            schema: z.object({}),
            func: async () => {
                const todos = getTodos();
                if (todos.length === 0) {
                    return "No plan created yet. Use write_todos to create one.";
                }
                const completed = todos.filter((t) => t.status === "completed").length;
                const lines = todos.map((t, i) => {
                    const icon = t.status === "completed" ? "done" : t.status === "in_progress" ? "..." : " ";
                    return `${i + 1}. [${icon}] ${t.title}${t.result ? ` → ${t.result}` : ""}`;
                }).join("\n");
                return `Plan progress: ${completed}/${todos.length}\n${lines}`;
            },
        }),
    ];
}
