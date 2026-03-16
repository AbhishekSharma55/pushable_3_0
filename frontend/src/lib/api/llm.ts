import { apiClient } from './client';

export interface OpenRouterModel {
    id: string;
    name: string;
    description: string;
    context_length: number;
    pricing: {
        prompt: string;
        completion: string;
        request: string;
        image: string;
    };
    architecture: {
        input_modalities: string[];
        output_modalities: string[];
        tokenizer: string;
        instruct_type: string | null;
    };
    top_provider: {
        context_length: number;
        max_completion_tokens: number;
        is_moderated: boolean;
    };
    supported_parameters: string[];
}

export interface ProviderGroup {
    provider: string;
    models: {
        id: string;
        name: string;
        description: string;
        context_length: number;
        pricing: {
            prompt: string;
            completion: string;
        };
        supported_parameters: string[];
    }[];
}

export const getProviders = (): Promise<ProviderGroup[]> =>
    apiClient.get('/api/llm/providers').then(r => r.data.data);

export const getModels = (): Promise<OpenRouterModel[]> =>
    apiClient.get('/api/llm/models').then(r => r.data.data);

export const searchModels = (query: string): Promise<OpenRouterModel[]> =>
    apiClient.get(`/api/llm/models/search?q=${encodeURIComponent(query)}`).then(r => r.data.data);
