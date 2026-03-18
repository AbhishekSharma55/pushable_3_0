import http from "node:http";
import { browserProxyRepository } from "../repositories/browser-proxy.repository.ts";
import { parseProxyString } from "../lib/proxy-parser.ts";
import { AppError, NotFoundError } from "../lib/errors.ts";
import { logger } from "../lib/logger.ts";

function testProxyConnection(proxy: {
    host: string;
    port: number;
    username: string;
    password: string;
}): Promise<string> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            req.destroy();
            reject(new Error("Proxy test timed out (5s)"));
        }, 5000);

        const auth = Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64");

        const req = http.request(
            {
                host: proxy.host,
                port: proxy.port,
                method: "GET",
                path: "http://api.ipify.org?format=json",
                headers: {
                    Host: "api.ipify.org",
                    "Proxy-Authorization": `Basic ${auth}`,
                },
            },
            (res) => {
                let body = "";
                res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
                res.on("end", () => {
                    clearTimeout(timeout);
                    if (res.statusCode === 200) {
                        try {
                            const data = JSON.parse(body) as { ip: string };
                            resolve(data.ip);
                        } catch {
                            reject(new Error("Invalid response from ipify"));
                        }
                    } else {
                        reject(new Error(`Proxy returned HTTP ${res.statusCode}`));
                    }
                });
            }
        );

        req.on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
        });

        req.end();
    });
}

export const browserProxyService = {
    async createProxy(
        data: {
            label: string;
            connectionString?: string;
            host?: string;
            port?: number;
            username?: string;
            password?: string;
            protocol?: "http" | "https" | "socks5";
            country?: string;
            city?: string;
        },
        workspaceId: string
    ) {
        let host: string;
        let port: number;
        let username: string;
        let password: string;
        let protocol: "http" | "https" | "socks5" = data.protocol ?? "http";

        if (data.connectionString) {
            const parsed = parseProxyString(data.connectionString);
            if (!parsed) {
                throw new AppError("Invalid proxy format", 400, "INVALID_PROXY_FORMAT");
            }
            host = parsed.host;
            port = parsed.port;
            username = parsed.username;
            password = parsed.password;
            protocol = parsed.protocol;
        } else if (data.host && data.port && data.username && data.password) {
            host = data.host;
            port = data.port;
            username = data.username;
            password = data.password;
        } else {
            throw new AppError(
                "Provide either connectionString or host, port, username, password",
                400,
                "MISSING_PROXY_FIELDS"
            );
        }

        return browserProxyRepository.createProxy({
            workspaceId,
            label: data.label,
            host,
            port,
            username,
            password,
            protocol,
            country: data.country ?? null,
            city: data.city ?? null,
        });
    },

    async getProxies(workspaceId: string) {
        const proxies = await browserProxyRepository.findProxies(workspaceId);
        return proxies.map(({ password: _pw, ...rest }) => rest);
    },

    async getProxyWithCredentials(id: string, workspaceId: string) {
        const proxy = await browserProxyRepository.findProxyById(id, workspaceId);
        if (!proxy) throw new NotFoundError("Proxy not found");
        return proxy;
    },

    async testProxy(id: string, workspaceId: string) {
        const proxy = await browserProxyRepository.findProxyById(id, workspaceId);
        if (!proxy) throw new NotFoundError("Proxy not found");

        try {
            const ip = await testProxyConnection(proxy);
            await browserProxyRepository.updateTestStatus(id, "success");
            return { success: true as const, ip };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            logger.warn({ error, proxyId: id }, "Proxy test failed");
            await browserProxyRepository.updateTestStatus(id, "failed");
            return { success: false as const, error: errorMessage };
        }
    },

    async updateProxy(
        id: string,
        workspaceId: string,
        data: Partial<{
            label: string;
            host: string;
            port: number;
            username: string;
            password: string;
            protocol: "http" | "https" | "socks5";
            country: string | null;
            city: string | null;
            isActive: boolean;
        }>
    ) {
        const proxy = await browserProxyRepository.findProxyById(id, workspaceId);
        if (!proxy) throw new NotFoundError("Proxy not found");
        return browserProxyRepository.updateProxy(id, workspaceId, data);
    },

    async deleteProxy(id: string, workspaceId: string) {
        const proxy = await browserProxyRepository.findProxyById(id, workspaceId);
        if (!proxy) throw new NotFoundError("Proxy not found");
        await browserProxyRepository.deleteProxy(id, workspaceId);
    },
};
