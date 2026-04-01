import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authService } from '../services/auth.service.ts';

const registerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password is required'),
});

const googleLoginSchema = z.object({
  code: z.string().min(1, 'Google authorization code is required'),
});

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/auth/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const result = await authService.register(body, fastify);
    return reply.status(201).send({ data: result });
  });

  fastify.post('/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const result = await authService.login(body, fastify);
    return reply.status(200).send({ data: result });
  });

  fastify.post('/auth/google', async (request, reply) => {
    const body = googleLoginSchema.parse(request.body);
    const result = await authService.googleLogin(body, fastify);
    return reply.status(200).send({ data: result });
  });
}
