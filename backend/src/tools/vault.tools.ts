import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { vaultRepository } from "../repositories/vault.repository.ts";
import { decrypt } from "../lib/encryption.ts";
import { getCredential } from "../services/bitwarden.service.ts";
import { logger } from "../lib/logger.ts";

/**
 * Build vault tools for an agent if the workspace has an active vault connection.
 */
export async function buildVaultTools(
    workspaceId: string
): Promise<DynamicStructuredTool[]> {
    // Check if workspace has an active vault connection
    const connection = await vaultRepository.findByWorkspace(workspaceId);
    if (!connection || connection.status !== "active") {
        return [];
    }

    const tools: DynamicStructuredTool[] = [
        new DynamicStructuredTool({
            name: "vault_get_credential",
            description:
                "Fetch login credentials (username and password) from the user's connected Bitwarden vault. " +
                "Use this when you need to log into a website or service on behalf of the user. " +
                "Search by the name of the login item as it appears in their vault (e.g. 'Facebook', 'Gmail', 'LinkedIn'). " +
                "Returns the username, password, and URI for the matching login item. " +
                "IMPORTANT: Never display or log the returned password to the user — use it only to fill login forms.",
            schema: z.object({
                itemName: z
                    .string()
                    .describe(
                        "The name of the login item to search for in the vault (e.g. 'Facebook', 'Gmail', 'Netflix')"
                    ),
            }),
            func: async ({ itemName }) => {
                try {
                    const clientId = decrypt(connection.encryptedClientId);
                    const clientSecret = decrypt(
                        connection.encryptedClientSecret
                    );
                    const masterPassword = decrypt(
                        connection.encryptedMasterPassword
                    );

                    const credential = await getCredential(
                        clientId,
                        clientSecret,
                        masterPassword,
                        itemName
                    );

                    if (!credential) {
                        return `No login item found in the vault matching "${itemName}". Ask the user to check the item name in their Bitwarden vault.`;
                    }

                    return JSON.stringify({
                        name: credential.name,
                        username: credential.username,
                        password: credential.password,
                        uri: credential.uri,
                    });
                } catch (error) {
                    logger.error(
                        { error, itemName },
                        "Failed to fetch credential from vault"
                    );
                    return `Failed to fetch credentials from vault: ${error instanceof Error ? error.message : "Unknown error"}. The vault connection may need to be reconfigured.`;
                }
            },
        }),
    ];

    return tools;
}
