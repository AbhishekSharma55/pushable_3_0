import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { userRepository } from "../repositories/user.repository.ts";
import { workspaceRepository } from "../repositories/workspace.repository.ts";
import { ConflictError, UnauthorizedError } from "../lib/errors.ts";

function generateSlug(name: string): string {
    const base = name.toLowerCase().replace(/\s+/g, "-");
    const suffix = Math.floor(1000 + Math.random() * 9000);
    return `${base}-${suffix}`;
}

export const authService = {
    async register(
        data: { name: string; email: string; password: string },
        fastify: FastifyInstance
    ) {
        // Check if email is already taken
        const existing = await userRepository.findByEmail(data.email);
        if (existing) {
            throw new ConflictError("Email already taken");
        }

        // Hash password
        const passwordHash = await bcrypt.hash(data.password, 12);

        // Create user
        const user = await userRepository.create({
            name: data.name,
            email: data.email,
            passwordHash,
        });

        // Create default workspace
        const slug = generateSlug(data.name);
        const workspace = await workspaceRepository.create({
            name: `${data.name}'s Workspace`,
            slug,
            ownerId: user.id,
        });

        // Add user as owner in workspace members
        await workspaceRepository.addMember({
            workspaceId: workspace.id,
            userId: user.id,
            role: "owner",
        });

        // Create credits row for workspace
        await workspaceRepository.createCredits(workspace.id);

        // Sign JWT
        const token = fastify.jwt.sign({
            userId: user.id,
            email: user.email,
        });

        return {
            token,
            user: { id: user.id, name: user.name, email: user.email },
        };
    },

    async login(
        data: { email: string; password: string },
        fastify: FastifyInstance
    ) {
        // Find user by email
        const user = await userRepository.findByEmail(data.email);
        if (!user) {
            throw new UnauthorizedError("Invalid email or password");
        }

        // Compare password
        const valid = await bcrypt.compare(data.password, user.passwordHash);
        if (!valid) {
            throw new UnauthorizedError("Invalid email or password");
        }

        // Sign JWT
        const token = fastify.jwt.sign({
            userId: user.id,
            email: user.email,
        });

        return {
            token,
            user: { id: user.id, name: user.name, email: user.email },
        };
    },
};
