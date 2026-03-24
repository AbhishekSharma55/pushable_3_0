import { apiClient } from './client';

export const register = (data: { name: string; email: string; password: string }) =>
    apiClient.post('/api/auth/register', data).then((r) => r.data.data);

export const login = (data: { email: string; password: string }) =>
    apiClient.post('/api/auth/login', data).then((r) => r.data.data);
