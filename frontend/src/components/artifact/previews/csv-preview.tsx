'use client';

interface CsvPreviewProps {
    content: string;
}

function parseCSV(csv: string): string[][] {
    const rows: string[][] = [];
    const lines = csv.split('\n');

    for (const line of lines) {
        if (!line.trim()) continue;
        const cells: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQuotes) {
                if (ch === '"' && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else if (ch === '"') {
                    inQuotes = false;
                } else {
                    current += ch;
                }
            } else {
                if (ch === '"') {
                    inQuotes = true;
                } else if (ch === ',') {
                    cells.push(current.trim());
                    current = '';
                } else {
                    current += ch;
                }
            }
        }
        cells.push(current.trim());
        rows.push(cells);
    }

    return rows;
}

const MAX_ROWS = 200;

export function CsvPreview({ content }: CsvPreviewProps) {
    const rows = parseCSV(content);
    if (rows.length === 0) {
        return <p className="text-sm text-muted-foreground">No data</p>;
    }

    const [header, ...body] = rows;
    const truncated = body.length > MAX_ROWS;
    const visibleBody = truncated ? body.slice(0, MAX_ROWS) : body;

    return (
        <div className="overflow-auto">
            <table className="w-full text-sm border-collapse">
                <thead>
                    <tr>
                        {header.map((cell, i) => (
                            <th
                                key={i}
                                className="text-left px-3 py-2 border-b-2 border-border font-semibold bg-muted/50 whitespace-nowrap"
                            >
                                {cell}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {visibleBody.map((row, ri) => (
                        <tr key={ri} className={ri % 2 === 0 ? '' : 'bg-muted/30'}>
                            {row.map((cell, ci) => (
                                <td key={ci} className="px-3 py-1.5 border-b border-border/40 whitespace-nowrap">
                                    {cell}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
            {truncated && (
                <p className="text-xs text-muted-foreground mt-3 text-center">
                    Showing first {MAX_ROWS} rows of {body.length}
                </p>
            )}
        </div>
    );
}
