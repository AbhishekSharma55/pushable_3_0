import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
    CreateBucketCommand,
    HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { logger } from "./logger.ts";

// ── Storage Provider Interface ───────────────────────────────────────────────

export interface StorageProvider {
    put(key: string, buffer: Buffer, contentType: string): Promise<void>;
    get(key: string): Promise<{ buffer: Buffer; contentType: string }>;
    delete(key: string): Promise<void>;
    exists(key: string): Promise<boolean>;
}

// ── S3 / MinIO Implementation ────────────────────────────────────────────────

class S3Storage implements StorageProvider {
    private client: S3Client;
    private bucket: string;
    private bucketReady = false;

    constructor() {
        this.client = new S3Client({
            endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
            region: process.env.S3_REGION || "us-east-1",
            credentials: {
                accessKeyId: process.env.S3_ACCESS_KEY || "minioadmin",
                secretAccessKey: process.env.S3_SECRET_KEY || "minioadmin",
            },
            forcePathStyle: true, // Required for MinIO
        });
        this.bucket = process.env.S3_BUCKET || "pushable-bucket";
    }

    /**
     * Ensure the bucket exists — creates it on first use.
     */
    private async ensureBucket(): Promise<void> {
        if (this.bucketReady) return;
        try {
            await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
            this.bucketReady = true;
        } catch {
            try {
                await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
                logger.info({ bucket: this.bucket }, "Created S3 bucket");
                this.bucketReady = true;
            } catch (createErr) {
                // Bucket may already exist (race condition)
                const errName = (createErr as Error).name;
                if (errName === "BucketAlreadyOwnedByYou" || errName === "BucketAlreadyExists") {
                    this.bucketReady = true;
                } else {
                    throw createErr;
                }
            }
        }
    }

    async put(key: string, buffer: Buffer, contentType: string): Promise<void> {
        await this.ensureBucket();
        await this.client.send(
            new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: buffer,
                ContentType: contentType,
            })
        );
        logger.debug({ key, size: buffer.length, bucket: this.bucket }, "File uploaded to S3");
    }

    async get(key: string): Promise<{ buffer: Buffer; contentType: string }> {
        await this.ensureBucket();
        const response = await this.client.send(
            new GetObjectCommand({
                Bucket: this.bucket,
                Key: key,
            })
        );

        const bodyStream = response.Body;
        if (!bodyStream) {
            throw new Error(`Empty response for key: ${key}`);
        }

        // Convert stream to buffer
        const chunks: Uint8Array[] = [];
        for await (const chunk of bodyStream as AsyncIterable<Uint8Array>) {
            chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        const contentType = response.ContentType || "application/octet-stream";

        return { buffer, contentType };
    }

    async delete(key: string): Promise<void> {
        await this.ensureBucket();
        await this.client.send(
            new DeleteObjectCommand({
                Bucket: this.bucket,
                Key: key,
            })
        );
        logger.debug({ key, bucket: this.bucket }, "File deleted from S3");
    }

    async exists(key: string): Promise<boolean> {
        await this.ensureBucket();
        try {
            await this.client.send(
                new HeadObjectCommand({
                    Bucket: this.bucket,
                    Key: key,
                })
            );
            return true;
        } catch {
            return false;
        }
    }
}

// ── Singleton ────────────────────────────────────────────────────────────────

let storageInstance: StorageProvider | null = null;

export function getStorage(): StorageProvider {
    if (!storageInstance) {
        storageInstance = new S3Storage();
        const endpoint = process.env.S3_ENDPOINT || "http://localhost:9000";
        const bucket = process.env.S3_BUCKET || "pushable-bucket";
        logger.info({ endpoint, bucket }, "Initialized S3/MinIO storage provider");
    }
    return storageInstance;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate a unique storage key for a file.
 * Format: {workspaceId}/{uuid}-{sanitizedFilename}
 */
export function generateStorageKey(workspaceId: string, filename: string): string {
    const sanitized = filename
        .replace(/[^\w.\-]/g, "_")
        .replace(/_{2,}/g, "_")
        .slice(0, 200);
    return `${workspaceId}/${randomUUID()}-${sanitized}`;
}
