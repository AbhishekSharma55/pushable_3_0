import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { executePython } from "../services/python-sandbox.service.ts";
import { generatePythonBucketHelper } from "../lib/python-bucket-helper.ts";
import { signInternalToken } from "../lib/jwt.ts";
import { logger } from "../lib/logger.ts";

interface PythonToolsConfig {
    workspaceId?: string;
    userId?: string;
    hasBucketAccess?: boolean;
}

export function buildPythonTools(config?: PythonToolsConfig): DynamicStructuredTool[] {
    const { workspaceId, userId, hasBucketAccess } = config || {};

    const bucketDescription = hasBucketAccess && workspaceId
        ? "\n\n**Bucket access available:** `from _pushable_bucket import bucket`\n" +
          "- bucket.list(folder=None, search=None) — list workspace files\n" +
          "- bucket.read(filename='name') / bucket.read(file_id='uuid') — read file content\n" +
          "- bucket.read_bytes(filename='name') — read as raw bytes\n" +
          "- bucket.save('output.csv', content, folder='/python-output') — save new file to bucket\n" +
          "- bucket.update(content='new content', filename='name') — update existing text file in-place\n" +
          "- bucket.download_to('local.png', filename='image.png') — download to sandbox\n" +
          "- bucket.upload_from('chart.png', folder='/charts') — upload local file to bucket\n" +
          "Use this to read bucket files, process/transform them, and save results back."
        : "";

    const pythonExecute = new DynamicStructuredTool({
        name: "python_execute",
        description:
            "Execute Python code in a sandboxed environment with a rich set of libraries.\n\n" +
            "**Available libraries:**\n" +
            "- **Scientific:** numpy, pandas, scipy, sympy, matplotlib, seaborn, statistics\n" +
            "- **Document generation:** fpdf2 (PDF creation), openpyxl (Excel .xlsx), python-docx (Word .docx)\n" +
            "- **Image processing:** Pillow (PIL) — resize, crop, convert, watermark, composite\n" +
            "- **Web/data:** requests (HTTP), beautifulsoup4 (HTML parsing), json, csv\n" +
            "- **Formatting:** tabulate (pretty tables)\n" +
            "- **Built-in:** math, datetime, re, collections, itertools, os, base64\n\n" +
            "USE THIS TOOL whenever you need to:\n" +
            "- Perform arithmetic, algebra, calculus, or any math computation\n" +
            "- Analyze or transform data (sorting, filtering, aggregation)\n" +
            "- **Create PDFs** — use fpdf2: `from fpdf import FPDF`\n" +
            "- **Create Excel files** — use openpyxl: `from openpyxl import Workbook`\n" +
            "- **Create Word docs** — use python-docx: `from docx import Document`\n" +
            "- **Process images** — use Pillow: `from PIL import Image`\n" +
            "- Generate charts/graphs (matplotlib/seaborn, saved as files)\n" +
            "- Fetch data from URLs (use requests)\n" +
            "- Parse HTML/XML (use beautifulsoup4)\n" +
            "- Solve equations symbolically (use sympy)\n\n" +
            "**File output workflow:** Generate a file (PDF, Excel, image, etc.) → save locally → " +
            "upload to workspace bucket with `bucket.upload_from('file.pdf')`. " +
            "The file then appears in the user's bucket and can be shared/downloaded.\n\n" +
            "IMPORTANT: Use print() to output results — only printed output is captured.\n\n" +
            "Examples:\n" +
            '- PDF: from fpdf import FPDF; pdf = FPDF(); pdf.add_page(); pdf.set_font("Helvetica", size=12); ' +
            'pdf.cell(text="Hello"); pdf.output("report.pdf"); bucket.upload_from("report.pdf")\n' +
            '- Excel: from openpyxl import Workbook; wb = Workbook(); ws = wb.active; ws.append(["Name","Score"]); ' +
            'wb.save("data.xlsx"); bucket.upload_from("data.xlsx")\n' +
            '- Image: from PIL import Image; img = Image.new("RGB",(200,200),"red"); img.save("out.png"); ' +
            'bucket.upload_from("out.png")\n' +
            '- Chart: import matplotlib.pyplot as plt; plt.plot([1,2,3]); plt.savefig("chart.png"); ' +
            'bucket.upload_from("chart.png")' +
            bucketDescription,
        schema: z.object({
            code: z
                .string()
                .describe(
                    "Python code to execute. Use print() for output. " +
                    "Available: numpy, pandas, scipy, sympy, matplotlib, seaborn, fpdf2, openpyxl, " +
                    "python-docx, Pillow, requests, beautifulsoup4, tabulate, and more." +
                    (hasBucketAccess ? " Bucket: from _pushable_bucket import bucket" : "")
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

                // Build helper files and env vars for bucket access
                const helperFiles: { filename: string; content: string }[] = [];
                const extraEnv: Record<string, string> = {};

                if (hasBucketAccess && workspaceId && userId) {
                    try {
                        const apiPort = process.env.PORT || "4000";
                        const apiUrl = `http://localhost:${apiPort}`;
                        const token = signInternalToken(
                            { userId, workspaceId },
                            60_000 // 60s — generous for sandbox timeout
                        );

                        const helperCode = generatePythonBucketHelper({
                            apiUrl,
                            authToken: token,
                            workspaceId,
                        });

                        helperFiles.push({
                            filename: "_pushable_bucket.py",
                            content: helperCode,
                        });

                        extraEnv.PUSHABLE_BUCKET_AVAILABLE = "1";
                    } catch (err) {
                        logger.warn({ err }, "Failed to generate bucket helper for Python sandbox");
                    }
                }

                const result = await executePython(code, timeoutMs, {
                    helperFiles: helperFiles.length > 0 ? helperFiles : undefined,
                    extraEnv: Object.keys(extraEnv).length > 0 ? extraEnv : undefined,
                });

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
