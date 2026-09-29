import { recordServerTime } from '../lib/clock';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';
const DEMO_USER_ID = '00000000-0000-4000-8000-000000000001';

// auth stub. use ?user=<uuid> to test as another user
export const USER_ID =
  new URLSearchParams(window.location.search).get('user') ?? import.meta.env.VITE_USER_ID ?? DEMO_USER_ID;

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function request<T>(path: string, { method = 'GET', body, headers, signal }: RequestOptions = {}): Promise<T> {
  const sentAt = Date.now();
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      signal,
      headers: {
        'x-user-id': USER_ID,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError('NETWORK_ERROR', 'Network error, please check your connection', 0);
  }
  const receivedAt = Date.now();

  const data = (await res.json().catch(() => null)) as
    | (T & { serverTime?: string; error?: { code: string; message: string } })
    | null;
  if (data?.serverTime) recordServerTime(data.serverTime, sentAt, receivedAt);

  if (!res.ok) {
    throw new ApiError(data?.error?.code ?? `HTTP_${res.status}`, data?.error?.message ?? res.statusText, res.status);
  }
  return data as T;
}
