import { TOKEN_KEY, USER_KEY } from './constants';
import type { User } from '@/types';

export function getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken(): void {
    localStorage.removeItem(TOKEN_KEY);
}

export function getUser(): User | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = localStorage.getItem(USER_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as User;
    } catch {
        return null;
    }
}

export function setUser(user: User): void {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function removeUser(): void {
    localStorage.removeItem(USER_KEY);
}
