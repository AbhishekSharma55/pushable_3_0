import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { OAuth2Client } from 'google-auth-library';
import { userRepository } from '../repositories/user.repository.ts';
import { workspaceRepository } from '../repositories/workspace.repository.ts';
import { ceoService } from './ceo.service.ts';
import { testerService } from './tester.service.ts';
import { ConflictError, UnauthorizedError } from '../lib/errors.ts';
import { logger } from '../lib/logger.ts';

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
);

function generateSlug(name: string): string {
  const base = name.toLowerCase().replace(/\s+/g, '-');
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${base}-${suffix}`;
}

async function createWorkspaceForUser(user: { id: string; name: string }) {
  const slug = generateSlug(user.name);
  const workspace = await workspaceRepository.create({
    name: `${user.name}'s Workspace`,
    slug,
    ownerId: user.id,
  });

  await workspaceRepository.addMember({
    workspaceId: workspace.id,
    userId: user.id,
    role: 'owner',
  });

  await workspaceRepository.createCredits(workspace.id);

  // Auto-create CEO and Tester agents
  try {
    await ceoService.getOrCreateCEO(workspace.id);
  } catch (error) {
    logger.warn(
      { error, workspaceId: workspace.id },
      'Failed to auto-create CEO agent for workspace',
    );
  }
  try {
    await testerService.getOrCreateTester(workspace.id);
  } catch (error) {
    logger.warn(
      { error, workspaceId: workspace.id },
      'Failed to auto-create Tester agent for workspace',
    );
  }

  return workspace;
}

function signToken(fastify: FastifyInstance, user: { id: string; email: string }) {
  return fastify.jwt.sign({ userId: user.id, email: user.email });
}

export const authService = {
  async register(
    data: { name: string; email: string; password: string },
    fastify: FastifyInstance,
  ) {
    // Check if email is already taken
    const existing = await userRepository.findByEmail(data.email);
    if (existing) {
      throw new ConflictError('Email already taken');
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
    await createWorkspaceForUser(user);

    const token = signToken(fastify, user);

    return {
      token,
      user: { id: user.id, name: user.name, email: user.email },
    };
  },

  async login(data: { email: string; password: string }, fastify: FastifyInstance) {
    // Find user by email
    const user = await userRepository.findByEmail(data.email);
    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Compare password
    if (!user.passwordHash) {
      throw new UnauthorizedError('This account uses Google sign-in. Please sign in with Google.');
    }
    const valid = await bcrypt.compare(data.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const token = signToken(fastify, user);

    return {
      token,
      user: { id: user.id, name: user.name, email: user.email },
    };
  },

  async googleLogin(data: { code: string }, fastify: FastifyInstance) {
    // Exchange authorization code for tokens
    const { tokens } = await googleClient.getToken({
      code: data.code,
      redirect_uri: 'postmessage',
    });

    if (!tokens.id_token) {
      throw new UnauthorizedError('Failed to get ID token from Google');
    }

    // Verify the ID token
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      throw new UnauthorizedError('Invalid Google token');
    }

    const { sub: googleId, email, name, email_verified } = payload;

    if (!email_verified) {
      throw new UnauthorizedError('Google email not verified');
    }

    // Check if user exists by googleId
    let user = await userRepository.findByGoogleId(googleId);

    if (!user) {
      // Check if a user with this email already exists (link accounts)
      user = await userRepository.findByEmail(email);

      if (user) {
        // Link Google account to existing user
        await userRepository.updateGoogleId(user.id, googleId);
      } else {
        // Create new user
        user = await userRepository.create({
          name: name || email.split('@')[0],
          email,
          googleId,
        });

        // Create default workspace for new user
        await createWorkspaceForUser(user);
      }
    }

    const token = signToken(fastify, user);

    return {
      token,
      user: { id: user.id, name: user.name, email: user.email },
    };
  },
};
