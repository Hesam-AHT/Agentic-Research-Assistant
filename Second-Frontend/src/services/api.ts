import axios from 'axios';
import type { QueryRequest, QueryResponse } from '../types/api';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

const apiClient = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

export const api = {
    /**
     * Send a query to the backend
     * For first question: sources should contain the uploaded PDF path
     * For follow-up questions: sources can be empty (backend uses session)
     */
    async query(request: QueryRequest): Promise<QueryResponse> {
        const payload = {
            query: request.question,  // Backend expects 'query' not 'question'
            sessionId: request.sessionId,
            expertise: request.expertise,
            // Backend expects file paths in sources array
            sources: request.sources,
        };

        console.log('[API] Query payload:', payload);
        const response = await apiClient.post('/api/query', payload);
        return response.data;
    },

    /**
     * Upload a PDF file to the backend
     * Returns the server path to the uploaded file
     */
    async uploadPDF(file: File): Promise<{ path: string }> {
        const formData = new FormData();
        formData.append('pdfs', file);  // Backend expects 'pdfs' field

        console.log('[API] Uploading PDF:', file.name);
        const response = await apiClient.post('/api/upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });

        console.log('[API] Upload response:', response.data);
        return response.data;
    },

    /**
     * Submit feedback for an answer
     */
    async submitFeedback(sessionId: string, rating: number, comment?: string) {
        await apiClient.post('/api/feedback', {
            sessionId,
            helpful: rating >= 3,  // 3+ stars = helpful
            verbosity: comment
        });
    },
};
