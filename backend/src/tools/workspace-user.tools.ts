import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { workspaceRepository } from "../repositories/workspace.repository.ts";
import { userRepository } from "../repositories/user.repository.ts";
import { logger } from "../lib/logger.ts";

export function buildWorkspaceUserTools(opts: {
    workspaceId: string;
}): DynamicStructuredTool[] {
    const { workspaceId } = opts;

    const getUserInfo = new DynamicStructuredTool({
        name: "get_current_user",
        description:
            "Retrieve information about the current workspace user (the person you are assisting). " +
            "Returns their name and email. Use this when you need to know who the user is, " +
            "personalize responses, or reference user details in tasks.",
        schema: z.object({}),
        func: async () => {
            try {
                const workspace = await workspaceRepository.findById(workspaceId);
                if (!workspace) {
                    return "Could not find workspace information.";
                }

                const user = await userRepository.findById(workspace.ownerId);
                if (!user) {
                    return "Could not find user information.";
                }

                return JSON.stringify({
                    name: user.name,
                    email: user.email,
                });
            } catch (error) {
                logger.error({ error, workspaceId }, "get_current_user failed");
                return "Failed to retrieve user information.";
            }
        },
    });

    return [getUserInfo];
}
