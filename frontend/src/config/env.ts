const configuredApiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim().replace(/\/+$/, '');
const configuredWsUrl = (import.meta.env.VITE_WS_URL as string | undefined)?.trim().replace(/\/+$/, '');

export const API_BASE_URL = configuredApiUrl || '/api';
export const WS_URL = configuredWsUrl || configuredApiUrl || undefined;

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const headers = new Headers(options.headers);

  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${normalizedPath}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const errBody = (await response.json()) as { message?: string | string[] };
      if (Array.isArray(errBody.message)) {
        message = errBody.message.join(', ');
      } else if (typeof errBody.message === 'string') {
        message = errBody.message;
      }
    } catch {
      // Ignore JSON parse error on non-JSON error responses
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
