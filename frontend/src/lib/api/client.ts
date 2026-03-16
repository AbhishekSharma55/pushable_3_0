import axios from 'axios';
import { API_URL } from '@/lib/constants';
import { getToken, removeToken, removeUser } from '@/lib/auth';

export const apiClient = axios.create({
    baseURL: API_URL,
});

// Request interceptor — attach token
apiClient.interceptors.request.use((config) => {
    const token = getToken();
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Response interceptor — handle 401
apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            removeToken();
            removeUser();
            if (typeof window !== 'undefined') {
                window.location.href = '/login';
            }
        }
        return Promise.reject(error);
    }
);
