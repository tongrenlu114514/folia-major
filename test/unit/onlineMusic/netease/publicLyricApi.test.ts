import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    fetchPublicNeteaseLyric,
    fetchPublicNeteaseLyrics,
    hasUsablePublicLyric,
} from '@/services/onlineMusic/netease/publicLyricApi';
import { parseLyricsAsync } from '@/utils/lyrics/workerClient';

// test/unit/onlineMusic/netease/publicLyricApi.test.ts

// The lyric parser runs in a Web Worker, which the node test environment does not have. The
// parsing itself is covered by the lyric unit tests; here it is stubbed so that this file tests
// the public API's own behavior: which endpoint it asks, what it makes of the answer, and what
// it does when the network fails.
vi.mock('@/utils/lyrics/workerClient', () => ({
    parseLyricsAsync: vi.fn(),
}));

const parseLyricsAsyncMock = vi.mocked(parseLyricsAsync);

const ok = (payload: unknown) => ({ ok: true, status: 200, json: async () => payload }) as unknown as Response;

describe('public NetEase lyric API', () => {
    beforeEach(() => {
        parseLyricsAsyncMock.mockReset();
        parseLyricsAsyncMock.mockResolvedValue({
            lines: [{ fullText: 'First line', startTime: 12.34, endTime: 18.9, words: [] }],
            isWordByWord: false,
        } as never);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('hasUsablePublicLyric', () => {
        it('accepts a payload with a line-timed lyric', () => {
            expect(hasUsablePublicLyric({ lrc: { lyric: '[00:12.34]A line' } })).toBe(true);
        });

        it('accepts a payload with only a word-by-word lyric', () => {
            expect(hasUsablePublicLyric({ yrc: { lyric: '[12,340,1200](0,0,0)A line' } })).toBe(true);
        });

        it('accepts a payload whose nested word-by-word lyric is filled', () => {
            expect(hasUsablePublicLyric({ lrc: { lyric: '', yrc: { lyric: '[0,1](0,0,0)A' } } })).toBe(true);
        });

        it('rejects the "no lyric" placeholder', () => {
            expect(hasUsablePublicLyric({ lrc: { lyric: '[00:00.00]暂无歌词' } })).toBe(false);
        });

        it('rejects a payload the mirror marks as uncollected', () => {
            expect(hasUsablePublicLyric({ uncollected: true, lrc: { lyric: '[00:12.34]A line' } })).toBe(false);
        });

        it('rejects an empty payload', () => {
            expect(hasUsablePublicLyric(null)).toBe(false);
            expect(hasUsablePublicLyric({})).toBe(false);
        });
    });

    describe('fetchPublicNeteaseLyric', () => {
        it('asks the word-by-word endpoint first', async () => {
            const fetchMock = vi.fn(async (_url: string) => ok({ lrc: { lyric: '[00:12.34]A line' }, code: 200 }));
            vi.stubGlobal('fetch', fetchMock);

            await fetchPublicNeteaseLyric(1500182591);

            expect(String(fetchMock.mock.calls[0][0])).toContain('/lyric/new?id=1500182591');
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('falls back to the line-timed endpoint when the first has nothing', async () => {
            const fetchMock = vi.fn(async (url: string) => (
                String(url).includes('/lyric/new')
                    ? ok({ lrc: { lyric: '' }, code: 200 })
                    : ok({ lrc: { lyric: '[00:05.00]Fallback line' }, code: 200 })
            ));
            vi.stubGlobal('fetch', fetchMock);

            const payload = await fetchPublicNeteaseLyric(1500182591);

            expect(payload?.lrc?.lyric).toContain('Fallback line');
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it('asks for nothing when the song id is missing or a placeholder', async () => {
            const fetchMock = vi.fn(async () => ok({}));
            vi.stubGlobal('fetch', fetchMock);

            expect(await fetchPublicNeteaseLyric('')).toBeNull();
            expect(await fetchPublicNeteaseLyric(0)).toBeNull();
            expect(await fetchPublicNeteaseLyric(null)).toBeNull();
            expect(await fetchPublicNeteaseLyric(undefined)).toBeNull();
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('returns null instead of throwing when the request fails', async () => {
            vi.stubGlobal('fetch', vi.fn(async () => {
                throw new Error('network down');
            }));

            expect(await fetchPublicNeteaseLyric(1500182591)).toBeNull();
        });

        it('returns null when the mirror answers with an error status', async () => {
            vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response));

            expect(await fetchPublicNeteaseLyric(1500182591)).toBeNull();
        });

        it('returns null when neither endpoint carries a lyric', async () => {
            vi.stubGlobal('fetch', vi.fn(async () => ok({ uncollected: true, lrc: { lyric: '[00:00.00]暂无歌词' } })));

            expect(await fetchPublicNeteaseLyric(1500182591)).toBeNull();
        });
    });

    describe('fetchPublicNeteaseLyrics', () => {
        it('parses the lyric it read', async () => {
            vi.stubGlobal('fetch', vi.fn(async () => ok({
                lrc: { lyric: '[00:12.34]First line' },
                tlyric: { lyric: '' },
                romalrc: { lyric: '' },
                code: 200,
            })));

            const result = await fetchPublicNeteaseLyrics(1500182591);

            expect(result?.mainText).toContain('First line');
            expect(result?.lyrics).not.toBeNull();
        });

        it('returns null when the song has no lyric', async () => {
            vi.stubGlobal('fetch', vi.fn(async () => ok({ uncollected: true, lrc: { lyric: '[00:00.00]暂无歌词' } })));

            expect(await fetchPublicNeteaseLyrics(1500182591)).toBeNull();
        });
    });
});
