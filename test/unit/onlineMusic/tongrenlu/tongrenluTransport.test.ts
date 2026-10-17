import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnlineProviderError } from '@/types/onlineMusic';
import { getTongrenluTransportAvailability, requestTongrenlu } from '@/services/onlineMusic/tongrenlu/tongrenluTransport';

// test/unit/onlineMusic/tongrenlu/tongrenluTransport.test.ts

afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.VITE_TONGRENLU_API_BASE;
});

const rejectionOf = (promise: Promise<unknown>) => promise.then(
    () => { throw new Error('expected requestTongrenlu to reject'); },
    (caught: unknown) => caught as OnlineProviderError,
);

describe('Tongrenlu transport availability', () => {
    it('treats Electron bridge as configured regardless of the web base URL', () => {
        vi.stubGlobal('window', { electron: { tongrenluRequest: vi.fn() } });
        expect(getTongrenluTransportAvailability()).toEqual({ configured: true });
    });

    it('reports the web base URL as configured when set', () => {
        process.env.VITE_TONGRENLU_API_BASE = 'http://121.37.183.44/tongrenlu';
        vi.stubGlobal('window', {});
        expect(getTongrenluTransportAvailability()).toEqual({ configured: true });
    });

    it('reports not-configured when neither bridge nor env is present', () => {
        vi.stubGlobal('window', {});
        expect(getTongrenluTransportAvailability()).toEqual({ configured: false, reason: 'not-configured' });
    });
});

describe('Tongrenlu transport - Electron path', () => {
    it('returns the bridge data unchanged on a successful answer', async () => {
        const bridgeData = { id: 223443, url: 'http://m801.music.126.net/audio.mp3' };
        vi.stubGlobal('window', { electron: { tongrenluRequest: vi.fn().mockResolvedValue({ ok: true, data: bridgeData }) } });
        const result = await requestTongrenlu<typeof bridgeData>('track', { id: 223443 });
        expect(result).toEqual(bridgeData);
    });

    it('rethrows an IPC rejection as a persistent unavailable runtime error', async () => {
        const ipcFailure = new Error('IPC channel closed');
        vi.stubGlobal('window', { electron: { tongrenluRequest: vi.fn().mockRejectedValue(ipcFailure) } });
        const error = await rejectionOf(requestTongrenlu('track', { id: 1 }));
        expect(error).toBeInstanceOf(OnlineProviderError);
        // Local desktop failure (process died, channel dropped) — not a network failure,
        // and the original IPC error rides along as `cause`.
        expect(error.code).toBe('unavailable');
        expect(error.providerId).toBe('tongrenlu');
        expect(error.cause).toBe(ipcFailure);
    });

    it('rethrows a bridge-classified failure with its original code and HTTP status', async () => {
        vi.stubGlobal('window', {
            electron: {
                tongrenluRequest: vi.fn().mockResolvedValue({
                    ok: false,
                    error: { code: 'not-playable', message: 'Tongrenlu track returned 404', httpStatus: 404 },
                }),
            },
        });
        const error = await rejectionOf(requestTongrenlu('track', { id: 99999999 }));
        expect(error).toBeInstanceOf(OnlineProviderError);
        expect(error.code).toBe('not-playable');
        expect(error.providerId).toBe('tongrenlu');
        expect(error.httpStatus).toBe(404);
    });
});

describe('Tongrenlu transport - Web path', () => {
    it('fetches through the same-origin dev proxy with the operation appended', async () => {
        process.env.VITE_TONGRENLU_API_BASE = 'http://121.37.183.44/tongrenlu';
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ name: 'Looks', url: 'http://m801.music.126.net/audio.mp3' }),
        });
        vi.stubGlobal('window', {});
        vi.stubGlobal('fetch', fetchMock);
        const result = await requestTongrenlu<any>('track', { id: 223443 });
        expect(result).toEqual({ name: 'Looks', url: 'http://m801.music.126.net/audio.mp3' });
        // The proxy URL keeps `VITE_TONGRENLU_API_BASE` out of the browser fetch — only the
        // operation and query are sent to the same-origin dev server.
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/tongrenlu/track?id=223443',
            expect.objectContaining({ method: 'GET' }),
        );
    });

    it('classifies 404 as not-playable without inferring taken-down', async () => {
        process.env.VITE_TONGRENLU_API_BASE = 'http://121.37.183.44/tongrenlu';
        vi.stubGlobal('window', {});
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
        const error = await rejectionOf(requestTongrenlu('track', { id: 99999999 }));
        expect(error).toBeInstanceOf(OnlineProviderError);
        expect(error.code).toBe('not-playable');
        expect(error.httpStatus).toBe(404);
    });

    it('classifies 429 and 5xx as network failures, carrying their HTTP status', async () => {
        // 429/5xx are a server-side rate limit or outage, not a wrong song URL — both end up as
        // `network` so the failure case (retry-later / unreachable) is decided from the status.
        process.env.VITE_TONGRENLU_API_BASE = 'http://121.37.183.44/tongrenlu';
        vi.stubGlobal('window', {});
        for (const status of [429, 503]) {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({}) }));
            const error = await rejectionOf(requestTongrenlu('artists'));
            expect(error.code).toBe('network');
            expect(error.httpStatus).toBe(status);
        }
    });

    it('promotes a {success:false} envelope to an invalid-response failure', async () => {
        process.env.VITE_TONGRENLU_API_BASE = 'http://121.37.183.44/tongrenlu';
        vi.stubGlobal('window', {});
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ success: false, message: 'bad shape' }),
        }));
        const error = await rejectionOf(requestTongrenlu('detail', { albumId: 8444 }));
        expect(error).toBeInstanceOf(OnlineProviderError);
        expect(error.code).toBe('invalid-response');
    });

    it('reports a missing web base URL as a persistent unavailable config error', async () => {
        vi.stubGlobal('window', {});
        const error = await rejectionOf(requestTongrenlu('artists'));
        expect(error).toBeInstanceOf(OnlineProviderError);
        expect(error.code).toBe('unavailable');
        expect(error.providerId).toBe('tongrenlu');
    });

    it('reports a TypeError from fetch as a network failure', async () => {
        process.env.VITE_TONGRENLU_API_BASE = 'http://121.37.183.44/tongrenlu';
        vi.stubGlobal('window', {});
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
        const error = await rejectionOf(requestTongrenlu('detail', { albumId: 8444 }));
        expect(error.code).toBe('network');
    });
});
