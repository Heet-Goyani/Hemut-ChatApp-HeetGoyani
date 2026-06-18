/**
 * XHR Utility — used for ALL form submissions (register, login, profile update).
 *
 * Spec requirements:
 *   - Uses raw XMLHttpRequest — NO fetch, NO axios for form submissions.
 *   - Wires up: onload, onerror, ontimeout, onabort, upload.onprogress.
 *   - Shows progress during upload.
 *   - Default timeout: 10 000 ms.
 */

import type { XHROptions, XHRResponse } from '@/types';

export function xhrRequest<T>(options: XHROptions): Promise<XHRResponse<T>> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();

    xhr.open(options.method, options.url);
    xhr.setRequestHeader('Content-Type', 'application/json');

    if (options.token) {
      xhr.setRequestHeader('Authorization', `Bearer ${options.token}`);
    }

    xhr.timeout = options.timeout ?? 10_000;

    // ── Event handlers ─────────────────────────────────────────────
    xhr.onload = () => {
      let data: T | null = null;
      let error: string | null = null;

      try {
        const parsed = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          data = parsed as T;
        } else {
          // Server returned an error body with a `detail` field (FastAPI default)
          error =
            parsed?.detail ??
            parsed?.message ??
            `Request failed with status ${xhr.status}`;
        }
      } catch {
        if (xhr.status >= 200 && xhr.status < 300) {
          // Non-JSON success (e.g. 204 No Content)
          data = null;
        } else {
          error = `Request failed with status ${xhr.status}`;
        }
      }

      resolve({ data, status: xhr.status, error });
    };

    xhr.onerror = () => {
      resolve({
        data: null,
        status: 0,
        error: 'Network error — please check your connection.',
      });
    };

    xhr.ontimeout = () => {
      resolve({
        data: null,
        status: 408,
        error: `Request timed out after ${xhr.timeout / 1000}s.`,
      });
    };

    xhr.onabort = () => {
      resolve({
        data: null,
        status: 0,
        error: 'Request was aborted.',
      });
    };

    // Upload progress (useful for file uploads / large payloads)
    xhr.upload.onprogress = (e: ProgressEvent) => {
      if (e.lengthComputable && options.onProgress) {
        const percent = Math.round((e.loaded / e.total) * 100);
        options.onProgress(percent);
      }
    };

    // Send
    xhr.send(options.data ? JSON.stringify(options.data) : null);
  });
}

// ── Convenience wrappers ───────────────────────────────────────────

/** POST form data via XHR. Used for register and login. */
export function xhrPost<T>(
  url: string,
  data: unknown,
  token?: string,
  onProgress?: (pct: number) => void
): Promise<XHRResponse<T>> {
  return xhrRequest<T>({ method: 'POST', url, data, token, onProgress });
}

/** PUT form data via XHR. Used for profile update. */
export function xhrPut<T>(
  url: string,
  data: unknown,
  token?: string
): Promise<XHRResponse<T>> {
  return xhrRequest<T>({ method: 'PUT', url, data, token });
}
