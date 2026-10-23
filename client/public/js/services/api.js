/**
 * api.js — typed API client for the ALMATRACE server
 *
 * Wraps fetch with:
 *   - Base URL prefix
 *   - JSON Content-Type headers
 *   - CSRF token injection for state-mutating requests
 *   - Consistent error handling (throws ApiError on non-2xx)
 *   - Request ID generation for correlation
 *
 * Security notes:
 *   - Credentials (cookies) are always included (same-origin requests only).
 *   - CSRF tokens are read from the X-CSRF-Token meta tag injected by the server.
 *   - Never include session tokens or passwords in client-side code.
 */

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details ?? [];
  }
}

export class ApiClient {
  #baseUrl;

  constructor(baseUrl) {
    this.#baseUrl = baseUrl.replace(/\/$/, '');
  }

  #getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta?.content ?? '';
  }

  #generateRequestId() {
    return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
  }

  async #request(method, path, body) {
    const url = `${this.#baseUrl}${path}`;
    const requestId = this.#generateRequestId();

    const headers = {
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
    };

    // Include CSRF token for state-mutating requests
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method.toUpperCase())) {
      const csrf = this.#getCsrfToken();
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }

    const response = await fetch(url, {
      method,
      headers,
      credentials: 'same-origin',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    let data;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      const err = data?.error ?? {};
      throw new ApiError(
        response.status,
        err.code ?? 'UNKNOWN_ERROR',
        err.message ?? 'An unexpected error occurred.',
        err.details ?? []
      );
    }

    return data;
  }

  get(path) { return this.#request('GET', path); }
  post(path, body) { return this.#request('POST', path, body); }
  patch(path, body) { return this.#request('PATCH', path, body); }
  delete(path) { return this.#request('DELETE', path); }
}
