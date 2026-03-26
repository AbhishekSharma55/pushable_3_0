import { spawn } from "child_process";
import { writeFile, unlink, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { logger } from "../lib/logger.ts";

export interface PythonExecResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
    durationMs: number;
}

const MAX_TIMEOUT_MS = 30_000; // 30 seconds
const MAX_OUTPUT_BYTES = 100_000; // ~100KB output cap

/**
 * Execute Python code in a sandboxed subprocess with resource limits.
 *
 * Safety measures:
 * - Strict execution timeout (default 30s)
 * - Output size cap to prevent memory exhaustion
 * - Runs in an isolated temp directory
 * - Temp files are cleaned up after execution
 */
export async function executePython(
    code: string,
    timeoutMs: number = MAX_TIMEOUT_MS
): Promise<PythonExecResult> {
    const effectiveTimeout = Math.min(timeoutMs, MAX_TIMEOUT_MS);
    const start = Date.now();

    // Create a temp directory for this execution
    const tempDir = await mkdtemp(join(tmpdir(), "py-sandbox-"));
    const scriptPath = join(tempDir, "script.py");

    // Wrap user code to handle matplotlib (save to file instead of display)
    const wrappedCode = `
import sys
import os
os.chdir("${tempDir}")

# Redirect matplotlib to non-interactive backend
import matplotlib
matplotlib.use('Agg')

${code}
`;

    await writeFile(scriptPath, wrappedCode, "utf-8");

    return new Promise<PythonExecResult>((resolve) => {
        let stdout = "";
        let stderr = "";
        let killed = false;

        const proc = spawn("python3", [scriptPath], {
            cwd: tempDir,
            timeout: effectiveTimeout,
            env: {
                ...process.env,
                PYTHONDONTWRITEBYTECODE: "1",
                PYTHONUNBUFFERED: "1",
                MPLBACKEND: "Agg",
            },
        });

        proc.stdout.on("data", (chunk: Buffer) => {
            if (stdout.length < MAX_OUTPUT_BYTES) {
                stdout += chunk.toString();
            }
        });

        proc.stderr.on("data", (chunk: Buffer) => {
            if (stderr.length < MAX_OUTPUT_BYTES) {
                stderr += chunk.toString();
            }
        });

        proc.on("error", (err) => {
            logger.error({ err }, "Python process spawn error");
            resolve({
                stdout,
                stderr: `Failed to start Python: ${err.message}`,
                exitCode: null,
                timedOut: false,
                durationMs: Date.now() - start,
            });
            cleanup(scriptPath, tempDir);
        });

        proc.on("close", (exitCode, signal) => {
            const timedOut = signal === "SIGTERM" || killed;
            if (stdout.length >= MAX_OUTPUT_BYTES) {
                stdout += "\n... [output truncated at 100KB]";
            }
            if (stderr.length >= MAX_OUTPUT_BYTES) {
                stderr += "\n... [stderr truncated at 100KB]";
            }

            resolve({
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                exitCode,
                timedOut,
                durationMs: Date.now() - start,
            });
            cleanup(scriptPath, tempDir);
        });

        // Enforce timeout with SIGKILL fallback
        const timer = setTimeout(() => {
            killed = true;
            proc.kill("SIGTERM");
            setTimeout(() => {
                if (!proc.killed) proc.kill("SIGKILL");
            }, 2000);
        }, effectiveTimeout);

        proc.on("close", () => clearTimeout(timer));
    });
}

async function cleanup(scriptPath: string, tempDir: string) {
    try {
        await unlink(scriptPath).catch(() => {});
        // Remove temp directory (best effort)
        const { rm } = await import("fs/promises");
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    } catch {
        // Ignore cleanup errors
    }
}
