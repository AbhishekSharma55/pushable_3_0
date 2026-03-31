'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface MarkdownPreviewProps {
    content: string;
}

function CopyButton({ code }: { code: string }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <button
            onClick={handleCopy}
            className="absolute top-2 right-2 p-1.5 rounded-md bg-background/80 border border-border text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Copy code"
        >
            {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
    );
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
    return (
        <>
            <link
                rel="stylesheet"
                href="https://cdn.jsdelivr.net/npm/highlight.js@11.11.1/styles/github-dark.min.css"
            />
            <link
                rel="stylesheet"
                href="https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css"
            />
            <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-headings:my-3 prose-headings:font-semibold prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-pre:my-3 prose-pre:p-0 prose-pre:bg-[#0d1117] prose-pre:rounded-lg prose-pre:overflow-hidden prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-table:text-sm prose-th:bg-muted/50 prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-1.5 prose-img:rounded-lg prose-img:shadow-md prose-blockquote:border-l-primary/50 prose-blockquote:bg-muted/30 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-lg prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-hr:border-border">
                <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeRaw, rehypeHighlight, rehypeKatex]}
                    components={{
                        pre({ children, ...props }) {
                            // Extract code text for copy button
                            let codeText = '';
                            if (
                                children &&
                                typeof children === 'object' &&
                                'props' in (children as React.ReactElement)
                            ) {
                                const child = children as React.ReactElement<{ children?: React.ReactNode }>;
                                if (typeof child.props.children === 'string') {
                                    codeText = child.props.children;
                                }
                            }
                            return (
                                <pre {...props} className="relative group">
                                    {codeText && <CopyButton code={codeText} />}
                                    {children}
                                </pre>
                            );
                        },
                        code({ className, children, ...props }) {
                            const isInline = !className;
                            if (isInline) {
                                return (
                                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono" {...props}>
                                        {children}
                                    </code>
                                );
                            }
                            return (
                                <code className={`${className ?? ''} block p-4 text-xs leading-relaxed overflow-x-auto`} {...props}>
                                    {children}
                                </code>
                            );
                        },
                        table({ children, ...props }) {
                            return (
                                <div className="overflow-x-auto my-4 rounded-lg border border-border">
                                    <table {...props} className="w-full">
                                        {children}
                                    </table>
                                </div>
                            );
                        },
                    }}
                >
                    {content}
                </ReactMarkdown>
            </div>
        </>
    );
}
