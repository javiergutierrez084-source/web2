export interface LanFetchTrace {
  url: string;
  method: string;
  startedAt: string;
  stack: string;
}

export interface LanFetchInit extends RequestInit {
  timeoutMs?: number;
  timeoutError?: string;
}

const DEFAULT_LAN_FETCH_TIMEOUT_MS = 5_000;

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function resolveMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

function diagnosticsEnabled(): boolean {
  try {
    return localStorage.getItem('joyacontrol_lan_fetch_diagnostics') === 'true';
  } catch {
    return false;
  }
}

function abortError(message = 'LAN_REQUEST_ABORTED'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function normalizeAbortFailure(error: unknown, timedOut: boolean, timeoutError: string, externalSignal?: AbortSignal | null): unknown {
  if (timedOut) return new Error(timeoutError);
  if (externalSignal?.aborted) {
    const reason = externalSignal.reason;
    if (reason instanceof Error) return reason;
    return abortError(typeof reason === 'string' && reason ? reason : 'LAN_REQUEST_ABORTED');
  }
  return error;
}

export async function readLanJson<T>(response: Response, fallback: T): Promise<T> {
  try {
    return await response.json() as T;
  } catch (error) {
    if (error instanceof SyntaxError) return fallback;
    throw error;
  }
}

/**
 * Bounded LAN transport. Every request owns an AbortController and remains
 * cancellable until its response body is consumed. Optional caller signals are
 * forwarded to the owned controller without replacing the transport timeout.
 */
export async function lanFetch(input: RequestInfo | URL, init: LanFetchInit = {}): Promise<Response> {
  const {
    timeoutMs = DEFAULT_LAN_FETCH_TIMEOUT_MS,
    timeoutError = 'LAN_HTTP_TIMEOUT',
    signal: externalSignal,
    ...requestInit
  } = init;

  const trace: LanFetchTrace = {
    url: resolveUrl(input),
    method: resolveMethod(input, requestInit),
    startedAt: new Date().toISOString(),
    stack: new Error('LAN_FETCH_CALLER').stack || 'STACK_UNAVAILABLE',
  };

  const enabled = diagnosticsEnabled();
  const controller = new AbortController();
  let timedOut = false;
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    globalThis.clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', abortFromCaller);
  };

  const abortFromCaller = () => {
    if (!controller.signal.aborted) controller.abort(externalSignal?.reason);
    cleanup();
  };

  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    if (!controller.signal.aborted) controller.abort(new Error(timeoutError));
    cleanup();
  }, Math.max(1, Number(timeoutMs) || DEFAULT_LAN_FETCH_TIMEOUT_MS));

  if (externalSignal?.aborted) abortFromCaller();
  else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });

  if (enabled) console.debug('[LAN fetch] start', { ...trace, timeoutMs });

  try {
    const response = await fetch(input, { ...requestInit, signal: controller.signal });

    if (enabled) console.debug('[LAN fetch] response', {
      ...trace,
      status: response.status,
      ok: response.ok,
      finishedAt: new Date().toISOString(),
    });

    const wrapBodyReader = (method: 'arrayBuffer' | 'blob' | 'formData' | 'json' | 'text') => {
      const original = response[method].bind(response) as (...args: never[]) => Promise<unknown>;
      Object.defineProperty(response, method, {
        configurable: true,
        value: async (...args: never[]) => {
          try {
            return await original(...args);
          } catch (error) {
            throw normalizeAbortFailure(error, timedOut, timeoutError, externalSignal);
          } finally {
            cleanup();
          }
        },
      });
    };

    wrapBodyReader('arrayBuffer');
    wrapBodyReader('blob');
    wrapBodyReader('formData');
    wrapBodyReader('json');
    wrapBodyReader('text');

    if (response.body === null || requestInit.method?.toUpperCase() === 'HEAD') cleanup();
    return response;
  } catch (error) {
    cleanup();
    const normalized = normalizeAbortFailure(error, timedOut, timeoutError, externalSignal);
    console.error('[LAN fetch] failure', {
      ...trace,
      finishedAt: new Date().toISOString(),
      exception: normalized,
      name: normalized instanceof Error ? normalized.name : typeof normalized,
      message: normalized instanceof Error ? normalized.message : String(normalized),
      cause: normalized instanceof Error ? normalized.cause : undefined,
    });
    throw normalized;
  }
}
