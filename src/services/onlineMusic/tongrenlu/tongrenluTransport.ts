import { OnlineProviderError } from '../../../types/onlineMusic';

// src/services/onlineMusic/tongrenluTransport.ts

/**
 * Tongrenlu (东方同人录) — a public catalog/archive for Touhou Project doujin music.
 *
 * The remote service has no auth: every operation is read-only. Electron still routes through
 * the main-process bridge so CORS, ad-hoc IPv6 routing, and corporate proxies behave the
 * same way as in Web builds; the bridge forwards straight to the configured base URL.
 *
 * The site itself does not promise a stable API contract. Keep every mapping here as a
 * raw-shape adapter — callers normalize via tongrenluNormalize.ts and never depend on
 * these field names.
 */

export const TONGRENLU_OPERATIONS = [
    'album-stats',
    'random-albums',
    'search',
    'detail',
    'track',
    'track-search',
    'tags',
    'artists',
    'events-count',
    'audio',
] as const;

export type TongrenluOperation = typeof TONGRENLU_OPERATIONS[number];

export type TongrenluParams = Record<string, string | number | boolean | undefined>;

export type TongrenluBridgeResult =
    | { ok: true; data: unknown }
    | { ok: false; error: { code: string; message: string; httpStatus?: number; stage?: string } };

const ENDPOINTS: Record<TongrenluOperation, string> = {
    'album-stats': '/api/music/album-stats',
    'random-albums': '/api/music/random-albums',
    search: '/api/music/search',
    detail: '/api/music/detail',
    track: '/api/music/track',
    'track-search': '/api/music/track-search',
    tags: '/api/music/tags',
    artists: '/api/music/artists',
    'events-count': '/api/music/events-count',
    audio: '/api/music/audio',
};

const getWebApiBase = (): string => {
    const viteValue = typeof import.meta !== 'undefined' && import.meta.env?.MODE !== 'test'
        ? String((import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_TONGRENLU_API_BASE || '')
        : '';
    const processValue = typeof process !== 'undefined'
        ? String(process.env?.VITE_TONGRENLU_API_BASE || '')
        : '';
    const value = viteValue || processValue;
    return value.trim().replace(/\/$/, '');
};

/**
 * The dev server (`vite.config.ts` `devTongrenluProxyPlugin`) proxies `/api/tongrenlu/<op>` to
 * the configured upstream so the renderer never has to deal with cross-origin requests. In
 * production builds, `worker/index.ts` is expected to mount the same path on the deployed
 * runtime; until then Web prod builds go through the same proxy, falling back to the direct
 * fetch only when a reachable origin is configured and `withCredentials: 'omit'` is enough.
 */
const getWebProxyBase = (): string => '/api/tongrenlu';

/** Single source of truth for "Tongrenlu is reachable from this runtime". */
export const getTongrenluTransportAvailability = (): { configured: boolean; reason?: 'not-configured' | 'runtime-unavailable' } => {
    if (typeof window !== 'undefined' && typeof window.electron?.tongrenluRequest === 'function') {
        // Electron: the bridge is mounted; reachability is a runtime question, not a config one.
        return { configured: true };
    }
    return getWebApiBase()
        ? { configured: true }
        : { configured: false, reason: 'not-configured' };
};

/**
 * Tongrenlu wraps every answer in `{ success, data }` for write-shaped endpoints (album-stats,
 * events-count) and returns a bare array or object for the rest. The bridge contract normalizes
 * all of them to `{ ok, data | error }` so the renderer never has to know which shape applies.
 */
const normalizeBridgeResponse = (raw: unknown): TongrenluBridgeResult => {
    if (raw && typeof raw === 'object' && 'ok' in (raw as Record<string, unknown>)) {
        return raw as TongrenluBridgeResult;
    }
    // The Web fetch path returns the parsed body directly; promote non-2xx envelopes to a rejection.
    if (raw && typeof raw === 'object' && 'success' in (raw as Record<string, unknown>)) {
        const envelope = raw as { success?: unknown; data?: unknown; message?: string };
        if (envelope.success === false) {
            return {
                ok: false,
                error: {
                    code: 'invalid-response',
                    message: String(envelope.message ?? 'Tongrenlu returned success=false'),
                    stage: 'upstream',
                },
            };
        }
        return { ok: true, data: envelope.data };
    }
    return { ok: true, data: raw };
};

const toTongrenluHttpError = (operation: TongrenluOperation, status: number): OnlineProviderError => {
    // Tongrenlu is a public catalog; 4xx is a request-shape problem (not an auth one), 5xx is
    // its own backend. Neither proves a song is taken-down, so do not promote them to
    // auth-required or taken-down — those codes belong to providers with verified signals.
    if (status === 404) {
        return new OnlineProviderError(
            'not-playable',
            `Tongrenlu ${operation} returned 404`,
            'tongrenlu',
            undefined,
            status,
        );
    }
    if (status === 429) {
        return new OnlineProviderError(
            'network',
            `Tongrenlu ${operation} rate-limited`,
            'tongrenlu',
            undefined,
            status,
        );
    }
    if (status >= 500) {
        return new OnlineProviderError(
            'network',
            `Tongrenlu ${operation} server error`,
            'tongrenlu',
            undefined,
            status,
        );
    }
    return new OnlineProviderError(
        'network',
        `Tongrenlu ${operation} HTTP ${status}`,
        'tongrenlu',
        undefined,
        status,
    );
};

const executeWeb = async (operation: TongrenluOperation, params: TongrenluParams): Promise<unknown> => {
    const base = getWebApiBase();
    if (!base) {
        throw new OnlineProviderError(
            'unavailable',
            'VITE_TONGRENLU_API_BASE is not configured',
            'tongrenlu',
        );
    }
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        query.set(key, String(value));
    });
    // Go through the same-origin dev proxy (`/api/tongrenlu/<op>`) so the browser does not
    // hit cross-origin restrictions on the upstream catalog. The proxy forwards to the
    // configured `VITE_TONGRENLU_API_BASE`. Direct fetch is intentionally avoided.
    const url = `${getWebProxyBase()}/${operation}${query.toString() ? `?${query}` : ''}`;

    let response: Response;
    try {
        response = await fetch(url, { method: 'GET', credentials: 'omit' });
    } catch (error) {
        if (error instanceof TypeError) {
            throw new OnlineProviderError(
                'network',
                `Tongrenlu ${operation} unreachable`,
                'tongrenlu',
                error,
            );
        }
        throw error;
    }
    if (!response.ok) {
        throw toTongrenluHttpError(operation, response.status);
    }
    try {
        return await response.json();
    } catch (error) {
        throw new OnlineProviderError(
            'invalid-response',
            `Tongrenlu ${operation} returned an unreadable body`,
            'tongrenlu',
            error,
        );
    }
};

/**
 * Single dispatcher used by the adapter. Electron takes precedence so CORS, mixed-protocol
 * routing, and any future transport tweaks (rate limits, request signing) all live behind the
 * bridge — never in renderer code.
 */
export const requestTongrenlu = async <T = unknown>(operation: TongrenluOperation, params: TongrenluParams = {}): Promise<T> => {
    if (typeof window !== 'undefined' && typeof window.electron?.tongrenluRequest === 'function') {
        let result: TongrenluBridgeResult;
        try {
            result = await window.electron!.tongrenluRequest(operation, params);
        } catch (error) {
            // IPC rejection is a local desktop failure (process died, channel dropped), not a
            // network failure — surface it as `unavailable` so the UI does not suggest retry.
            throw new OnlineProviderError(
                'unavailable',
                `Tongrenlu desktop request failed for ${operation}`,
                'tongrenlu',
                error,
            );
        }
        if (!result.ok) {
            // The Electron bridge has already classified the failure into a ProviderErrorCode.
            // Re-emit with `tongrenlu` as providerId so Omni sees the right origin.
            throw new OnlineProviderError(
                result.error.code as never,
                result.error.message,
                'tongrenlu',
                result.error,
                result.error.httpStatus,
            );
        }
        return result.data as T;
    }

    const raw = await executeWeb(operation, params);
    const envelope = normalizeBridgeResponse(raw);
    if (envelope.ok) return envelope.data as T;
    throw new OnlineProviderError(
        envelope.error.code as never,
        envelope.error.message,
        'tongrenlu',
        envelope.error,
    );
};
