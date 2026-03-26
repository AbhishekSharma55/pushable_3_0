import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { executePython } from "../services/python-sandbox.service.ts";
import { logger } from "../lib/logger.ts";

export function buildPythonTools(): DynamicStructuredTool[] {
    const pythonExecute = new DynamicStructuredTool({
        name: "python_execute",
        description:
            "Execute Python code to perform calculations, data analysis, math, statistics, " +
            "or any computation. The code runs in a sandboxed environment with Python 3 and " +
            "common scientific libraries available: numpy, pandas, scipy, sympy, matplotlib, " +
            "math, statistics, json, csv, datetime, re, collections, itertools.\n\n" +
            "USE THIS TOOL whenever you need to:\n" +
            "- Perform arithmetic, algebra, calculus, or any math computation\n" +
            "- Analyze or transform data (sorting, filtering, aggregation)\n" +
            "- Verify calculations instead of doing mental math\n" +
            "- Generate charts/graphs (use matplotlib, they will be saved as files)\n" +
            "- Solve equations symbolically (use sympy)\n" +
            "- Run statistical analysis\n" +
            "- Process or format structured data\n\n" +
            "IMPORTANT: Use print() to output results — only printed output is captured.\n\n" +
            "Examples:\n" +
            '- Simple math: print(2**100)\n' +
            '- Sympy: from sympy import *; x = symbols("x"); print(solve(x**2 - 5*x + 6, x))\n' +
            '- Numpy: import numpy as np; a = np.array([1,2,3]); print(np.mean(a))\n' +
            '- Pandas: import pandas as pd; df = pd.DataFrame({"a":[1,2,3]}); print(df.describe())',
        schema: z.object({
            code: z
                .string()
                .describe(
                    "Python code to execute. Use print() for output. " +
                    "Available: numpy, pandas, scipy, sympy, matplotlib, math, statistics, etc."
                ),
            timeout_seconds: z
                .number()
                .min(1)
                .max(30)
                .default(15)
                .optional()
                .describe("Max execution time in seconds (1-30, default 15)"),
        }),
        func: async ({ code, timeout_seconds }) => {
            try {
                const timeoutMs = (timeout_seconds || 15) * 1000;
                const result = await executePython(code, timeoutMs);

                const parts: string[] = [];

                if (result.timedOut) {
                    parts.push(
                        `**Execution timed out** after ${(result.durationMs / 1000).toFixed(1)}s. ` +
                        `Consider simplifying the code or increasing timeout_seconds.`
                    );
                }

                if (result.stdout) {
                    parts.push(`**Output:**\n\`\`\`\n${result.stdout}\n\`\`\``);
                }

                if (result.stderr) {
                    parts.push(`**Errors/Warnings:**\n\`\`\`\n${result.stderr}\n\`\`\``);
                }

                if (result.exitCode !== null && result.exitCode !== 0 && !result.timedOut) {
                    parts.push(`Exit code: ${result.exitCode}`);
                }

                if (parts.length === 0) {
                    parts.push(
                        "Code executed successfully with no output. " +
                        "Use print() to see results."
                    );
                }

                parts.push(`(${(result.durationMs / 1000).toFixed(1)}s)`);

                return parts.join("\n\n");
            } catch (error) {
                logger.error({ error, code: code.slice(0, 200) }, "python_execute failed");
                return `Failed to execute Python: ${error instanceof Error ? error.message : "Unknown error"}`;
            }
        },
    });

    return [pythonExecute];
}
