import { BackendError, invalidResponse } from './errors';
import { array, boolean, object, record, text, type Decoder } from './decoders';

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export interface BackendRequest<T> {
  path: string;
  decode: Decoder<T>;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Readonly<Record<string, string | undefined>>;
  body?: Json;
  idempotencyKey?: string;
  expectedVersion?: number;
  signal?: AbortSignal;
}

export interface BackendResponse<T> {
  data: T;
  status: number;
  requestId?: string;
  etag?: string;
  replayed: boolean;
}

export interface TransportOptions {
  origin: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  allowInsecureDevelopment?: boolean;
}

const publicError = object({ code: text, message: text, retryable: boolean });
const errorDetail: Decoder<{ field?: string; code: string }> = (value) => {
  const input = record(value);
  return { code: text(input.code), ...(input.field === undefined ? {} : { field: text(input.field) }) };
};

function retryAfter(header: string | null): number | undefined {
  if (header === null) return undefined;
  const seconds = /^\d+$/.test(header) ? Number(header) : Math.ceil((Date.parse(header) - Date.now()) / 1000);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : undefined;
}

/** One HTTP attempt. Only the session layer may retry an explicit pre-handler auth rejection. */
export class BackendTransport {
  private readonly origin: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: TransportOptions) {
    let url: URL;
    try {
      url = new URL(options.origin);
    } catch {
      throw new Error('Configure a dedicated HTTPS API origin.');
    }
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && options.allowInsecureDevelopment))) {
      throw new Error('Configure a dedicated HTTPS API origin.');
    }
    this.origin = url.origin;
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 15000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new Error('Invalid API timeout.');
  }

  async request<T>(input: BackendRequest<T>, accessToken?: string): Promise<BackendResponse<T>> {
    // Reject absolute URLs, traversal and query injection before attaching credentials.
    if (!/^\/api\/v1\/[A-Za-z0-9/_-]+$/.test(input.path)) throw new Error('Invalid API path.');
    const url = new URL(input.path, this.origin);
    for (const [key, value] of Object.entries(input.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (accessToken !== undefined) headers.Authorization = `Bearer ${accessToken}`;
    if (input.body !== undefined) headers['Content-Type'] = 'application/json';
    if (input.idempotencyKey !== undefined) {
      if (!/^[\x21-\x7e]{16,128}$/.test(input.idempotencyKey)) throw new Error('Invalid idempotency key.');
      headers['Idempotency-Key'] = input.idempotencyKey;
    }
    if (input.expectedVersion !== undefined) {
      if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion > 2147483646) {
        throw new Error('Invalid expected version.');
      }
      headers['If-Match'] = `"${input.expectedVersion}"`;
    }
    const body = input.body === undefined ? undefined : JSON.stringify(input.body);
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    input.signal?.addEventListener('abort', abort, { once: true });
    if (input.signal?.aborted) controller.abort();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    let rejectAborted: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      rejectAborted = () => reject(new BackendError({
        code: timedOut ? 'CLIENT.TIMEOUT' : 'CLIENT.CANCELLED',
        message: timedOut ? 'The service did not respond in time.' : 'The request was cancelled.',
        retryable: timedOut,
      }));
      controller.signal.addEventListener('abort', rejectAborted, { once: true });
      if (controller.signal.aborted) rejectAborted();
    });
    try {
      const attempt = async (): Promise<BackendResponse<T>> => {
        if (controller.signal.aborted) throw new Error('Aborted');
        const response = await this.fetcher(url.toString(), {
          method: input.method ?? 'GET', headers, body, signal: controller.signal,
          credentials: 'omit', cache: 'no-store', redirect: 'error',
        });
        const requestId = response.headers.get('x-request-id') ?? undefined;
        const metadata = {
          status: response.status, requestId,
          etag: response.headers.get('etag') ?? undefined,
          replayed: response.headers.get('idempotency-replayed') === 'true',
        };
        let envelopeRequestId = requestId;
        try {
          if (response.status === 204) return { ...metadata, data: input.decode(undefined) };
          const payload = record(await response.json());
          const meta = record(payload.meta);
          envelopeRequestId = text(meta.requestId);
          if (!response.ok) {
            const error = publicError(payload.error);
            const details = record(payload.error).details;
            throw new BackendError({
              ...error, status: response.status, requestId: envelopeRequestId,
              retryAfterSeconds: retryAfter(response.headers.get('retry-after')),
              details: details === undefined ? undefined : array(errorDetail, 100)(details),
            });
          }
          if (!Object.hasOwn(payload, 'data') || Object.hasOwn(payload, 'error')) invalidResponse();
          return { ...metadata, requestId: envelopeRequestId, data: input.decode(payload.data) };
        } catch (error) {
          if (error instanceof BackendError && error.code !== 'CLIENT.INVALID_RESPONSE') throw error;
          throw new BackendError({
            code: 'CLIENT.INVALID_RESPONSE', message: 'The service returned an unsupported response.',
            status: response.status, requestId: envelopeRequestId,
          });
        }
      };
      return await Promise.race([aborted, attempt()]);
    } catch (error) {
      if (error instanceof BackendError) throw error;
      throw new BackendError({
        code: 'CLIENT.NETWORK_ERROR', message: 'Unable to reach the service.', retryable: true,
      });
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', rejectAborted);
    }
  }
}
