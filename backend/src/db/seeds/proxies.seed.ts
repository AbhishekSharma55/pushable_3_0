import { eq } from "drizzle-orm";
import { db } from "../client.ts";
import { browserProxies, workspaces } from "../schema/index.ts";
import { logger } from "../../lib/logger.ts";

interface ProxySeed {
    label: string;
    host: string;
    port: number;
    username: string;
    password: string;
    protocol: "http" | "https" | "socks5";
    country: string;
    city: string;
}

const DEFAULT_PROXIES: ProxySeed[] = [
    {
        label: "India - Geonix 1",
        host: "res.geonix.com",
        port: 10000,
        username: "633273d8fc72a767",
        password: "SC7ov4DO",
        protocol: "http",
        country: "IN",
        city: "Mumbai",
    },
    {
        label: "India - Geonix 3",
        host: "res.geonix.com",
        port: 10002,
        username: "633273d8fc72a767",
        password: "SC7ov4DO",
        protocol: "http",
        country: "IN",
        city: "Mumbai",
    },
    {
        label: "India - Geonix 4",
        host: "res.geonix.com",
        port: 10003,
        username: "633273d8fc72a767",
        password: "SC7ov4DO",
        protocol: "http",
        country: "IN",
        city: "Mumbai",
    },
    {
        label: "India - Geonix 5",
        host: "res.geonix.com",
        port: 10004,
        username: "633273d8fc72a767",
        password: "SC7ov4DO",
        protocol: "http",
        country: "IN",
        city: "Mumbai",
    },
];

export async function seedProxies(): Promise<void> {
    try {
        // Get all workspaces to seed proxies for each
        const allWorkspaces = await db.select().from(workspaces);
        if (allWorkspaces.length === 0) {
            logger.info("No workspaces found — skipping proxy seed");
            return;
        }

        let seeded = 0;
        for (const ws of allWorkspaces) {
            // Check if proxies already exist for this workspace
            const existing = await db
                .select()
                .from(browserProxies)
                .where(eq(browserProxies.workspaceId, ws.id));

            if (existing.length > 0) {
                continue; // Already has proxies
            }

            for (const proxy of DEFAULT_PROXIES) {
                await db.insert(browserProxies).values({
                    workspaceId: ws.id,
                    ...proxy,
                });
            }
            seeded += DEFAULT_PROXIES.length;
        }

        if (seeded > 0) {
            logger.info(`Seeded ${seeded} default proxies`);
        }
    } catch (error) {
        logger.error({ error }, "Failed to seed proxies");
    }
}
