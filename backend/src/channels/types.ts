export interface NormalizedMessage {
    connectionId: string;
    channelType: "telegram" | "slack" | "whatsapp" | "email";
    workspaceId: string;
    agentId: string;
    externalUserId: string;
    externalUsername: string;
    platformUserId?: string; // Pushable platform user UUID (for credit tracking)
    text: string;
    threadId?: string;
    messageId?: string;
    raw: unknown;
    /** Processed file attachments (images as base64, docs as extracted text) */
    attachments?: import("../services/file-processing.service.ts").ProcessedAttachment[];
}

export interface NormalizedResponse {
    text: string;
    threadId?: string;
    messageId?: string;
}

export interface ChannelConnection {
    id: string;
    workspaceId: string;
    agentId: string;
    channelType: "telegram" | "slack" | "whatsapp" | "email";
    name: string;
    status: "active" | "inactive" | "error";
    credentials: Record<string, unknown>;
    config: Record<string, unknown>;
    errorMessage: string | null;
    lastMessageAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface ChannelAdapter {
    channelType: "telegram" | "slack" | "whatsapp" | "email";
    initialize(connection: ChannelConnection): Promise<void>;
    shutdown(connectionId: string): Promise<void>;
    sendMessage(connectionId: string, response: NormalizedResponse): Promise<void>;
}
