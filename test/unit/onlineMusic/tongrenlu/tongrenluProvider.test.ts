import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';
import { OnlineProviderError } from '@/types/onlineMusic';
import { listOnlineMusicProviders, getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { tongrenluProvider } from '@/services/onlineMusic/tongrenlu/tongrenluProvider';
import { getTongrenluAvailability } from '@/services/onlineMusic/tongrenlu/tongrenluAvailability';
import { parseLyricsAsync } from '@/utils/lyrics/workerClient';

// test/unit/onlineMusic/tongrenluProvider.test.ts

// The lyric parser runs in a Web Worker, which the node test environment does not have. The
// parsing itself is covered by the lyric unit tests; here the parser is stubbed so that this
// file tests the provider's own behavior: which song it asks for and what it does with the
// answer.
vi.mock('@/utils/lyrics/workerClient', () => ({
    parseLyricsAsync: vi.fn(),
}));

afterEach(() => {
    vi.unstubAllGlobals();
    // Tongrenlu reads `process.env.VITE_TONGRENLU_API_BASE` at every transport call. Sibling
    // tests in `tongrenluTransport.test.ts` set it; clear it here so availability probes
    // start from a known baseline.
    delete process.env.VITE_TONGRENLU_API_BASE;
});

describe('Tongrenlu provider - registration', () => {
    it('is registered in providerRegistry with the expected id', () => {
        const found = getOnlineMusicProvider('tongrenlu');
        expect(found).toBe(tongrenluProvider);
        const ids = listOnlineMusicProviders().map(provider => provider.id);
        expect(ids).toContain('tongrenlu');
    });

    it('declares capabilities consistent with the public catalog contract', () => {
        expect(tongrenluProvider.capabilities).toMatchObject({
            search: true,
            playback: true,
            lyrics: true,
            auth: false,
            userLibrary: true,
            playlists: false,
            albums: true,
            artists: true,
            userAlbums: true,
            recommendations: false,
            mutations: false,
            wordByWordLyrics: true,
        });
    });

    it('treats the no-account provider as not requiring account sign-in', () => {
        // The provider summary comes through `getProviderSummaries` later; the static flag is
        // what the account snapshot surfaces today.
        expect(tongrenluProvider.capabilities.auth).toBe(false);
    });
});

describe('Tongrenlu provider - availability', () => {
    it('reports not-configured when neither bridge nor web base URL is present', () => {
        vi.stubGlobal('window', {});
        expect(getTongrenluAvailability()).toEqual({ configured: false, reason: 'not-configured' });
    });

    it('reports configured when the Electron bridge is mounted', () => {
        vi.stubGlobal('window', { electron: { tongrenluRequest: vi.fn() } });
        expect(getTongrenluAvailability().configured).toBe(true);
    });
});

describe('Tongrenlu provider - playback', () => {
    beforeEach(() => {
        vi.stubGlobal('window', {
            electron: {
                tongrenluRequest: vi.fn().mockResolvedValue({
                    ok: true,
                    data: { id: 223443, name: 'Looks', url: 'http://m801.music.126.net/audio.mp3', status: 0 },
                }),
            },
        });
    });

    it('produces a UnifiedSong whose playback key carries providerId and trackId', async () => {
        const detail = await tongrenluProvider.playback!.getSongDetail(223443);
        expect(detail).not.toBeNull();
        const song = detail!;
        expect(song.sourceRef).toMatchObject({ kind: 'online', providerId: 'tongrenlu', mediaId: '223443' });
        // The song key is what Omni uses for identity; it must include the providerId.
        expect(getPlaybackSongKey(song)).toBe('online:tongrenlu:223443');
    });

    it('returns a ProviderAudioSource when the bridge hands back a url', async () => {
        const detail = await tongrenluProvider.playback!.getSongDetail(223443);
        const audio = await tongrenluProvider.playback!.getAudioSource(detail!, 'standard');
        expect(audio).toMatchObject({ quality: 'standard', url: 'http://m801.music.126.net/audio.mp3' });
    });

    it('returns null instead of throwing when the bridge reports 404', async () => {
        vi.stubGlobal('window', {
            electron: {
                tongrenluRequest: vi.fn().mockResolvedValue({
                    ok: false,
                    error: { code: 'not-playable', message: 'Tongrenlu track returned 404', stage: 'upstream', httpStatus: 404 },
                }),
            },
        });
        // getSongDetail should swallow the not-playable failure and return null.
        const detail = await tongrenluProvider.playback!.getSongDetail(99999999);
        expect(detail).toBeNull();
    });

    it('rejects a non-tongrenlu song rather than guessing its identity', async () => {
        const detail = await tongrenluProvider.playback!.getSongDetail(223443);
        const foreignSong = { ...detail!, sourceRef: { kind: 'online' as const, providerId: 'qq' as const, mediaId: 'foo' } };
        await expect(tongrenluProvider.playback!.getAudioSource(foreignSong as never, 'standard'))
            .rejects.toMatchObject({ code: 'unsupported' });
    });

    it('rethrows IPC failures as a persistent unavailable runtime error', async () => {
        vi.stubGlobal('window', {
            electron: {
                tongrenluRequest: vi.fn().mockRejectedValue(new OnlineProviderError('network', 'IPC failure', 'tongrenlu')),
            },
        });
        await expect(tongrenluProvider.playback!.getSongDetail(223443)).rejects.toMatchObject({ code: 'unavailable' });
    });
});

describe('Tongrenlu provider - lyrics', () => {
    const parseLyricsAsyncMock = vi.mocked(parseLyricsAsync);

    beforeEach(() => {
        parseLyricsAsyncMock.mockReset();
        parseLyricsAsyncMock.mockResolvedValue({
            lines: [
                { fullText: 'First line', startTime: 12.34, endTime: 18.9, words: [] },
                { fullText: 'Second line', startTime: 18.9, endTime: 25, words: [] },
            ],
            isWordByWord: false,
        } as never);
    });

    const lyricSong = (cloudMusicId: unknown) => ({
        id: 223443,
        name: 'Looks',
        artists: [{ id: 'a', name: 'Reset All Controllers' }],
        album: { id: '8444', name: 'An Album' },
        durationMs: 0,
        sourceRef: {
            kind: 'online' as const,
            providerId: 'tongrenlu' as const,
            mediaId: '223443',
            providerData: { albumId: '8444', cloudMusicId },
        },
    });

    const stubFetch = (payloads: Record<string, unknown>) => {
        const fetchMock = vi.fn(async (url: string) => {
            const path = String(url).includes('/lyric/new') ? '/lyric/new' : '/lyric';
            const payload = payloads[path];
            if (payload === undefined) {
                return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
            }
            return { ok: true, status: 200, json: async () => payload } as unknown as Response;
        });
        vi.stubGlobal('fetch', fetchMock);
        return fetchMock;
    };

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('reads the lyric of the NetEase song the track was imported from', async () => {
        const fetchMock = stubFetch({
            '/lyric/new': {
                lrc: { version: 1, lyric: '[00:12.34]First line\n[00:18.90]Second line' },
                tlyric: { version: 0, lyric: '' },
                romalrc: { version: 0, lyric: '' },
                code: 200,
            },
        });

        const result = await tongrenluProvider.lyrics!.getLyrics(lyricSong(1500182591) as never);

        expect(result.mainText).toContain('First line');
        expect(result.lyrics).not.toBeNull();
        expect(result.lyrics!.lines.length).toBeGreaterThan(0);
        // The request must carry the NetEase song id, not the Tongrenlu track id.
        expect(String(fetchMock.mock.calls[0][0])).toContain('id=1500182591');
    });

    it('returns no lyric when the track has no imported NetEase song', async () => {
        const fetchMock = stubFetch({});
        const result = await tongrenluProvider.lyrics!.getLyrics(lyricSong(null) as never);

        expect(result.lyrics).toBeNull();
        expect(result.mainText).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns no lyric when the imported song id is the placeholder zero', async () => {
        const fetchMock = stubFetch({});
        const result = await tongrenluProvider.lyrics!.getLyrics(lyricSong(0) as never);

        expect(result.lyrics).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns no lyric when the lyric endpoint answers with the empty placeholder', async () => {
        stubFetch({
            '/lyric/new': { uncollected: true, lrc: { version: 1, lyric: '[00:00.00]暂无歌词' }, code: 200 },
            '/lyric': { uncollected: true, lrc: { version: 1, lyric: '[00:00.00]暂无歌词' }, code: 200 },
        });

        const result = await tongrenluProvider.lyrics!.getLyrics(lyricSong(1500182591) as never);
        expect(result.lyrics).toBeNull();
    });

    it('falls back to the line-timed endpoint when the word-by-word one has nothing', async () => {
        stubFetch({
            '/lyric/new': { lrc: { version: 1, lyric: '' }, code: 200 },
            '/lyric': { lrc: { version: 1, lyric: '[00:05.00]Fallback line' }, code: 200 },
        });

        const result = await tongrenluProvider.lyrics!.getLyrics(lyricSong(1500182591) as never);
        expect(result.mainText).toContain('Fallback line');
    });

    it('does not throw when the lyric request fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('network down');
        }));

        const result = await tongrenluProvider.lyrics!.getLyrics(lyricSong(1500182591) as never);
        expect(result.lyrics).toBeNull();
        expect(result.isPureMusic).toBe(false);
    });

    it('reads the word-by-word lyric when the payload carries one', async () => {
        parseLyricsAsyncMock.mockResolvedValue({
            lines: [{ fullText: 'First line', startTime: 12.34, endTime: 13.04, words: [] }],
            isWordByWord: true,
        } as never);
        stubFetch({
            '/lyric/new': {
                lrc: { version: 1, lyric: '[00:12.34]First line' },
                yrc: { version: 1, lyric: '[12,340,1200](0,0,0)First(12,340,700,0) line(13,040,600,0)' },
                tlyric: { version: 0, lyric: '' },
                romalrc: { version: 0, lyric: '' },
                code: 200,
            },
        });

        const result = await tongrenluProvider.lyrics!.getLyrics(lyricSong(1500182591) as never);
        expect(result.wordByWordText).toContain('First');
        expect(result.lyrics!.isWordByWord).toBe(true);
    });
});

describe('Tongrenlu provider - catalog', () => {
    it('returns null when the album-detail endpoint reports 404', async () => {
        vi.stubGlobal('window', {
            electron: {
                tongrenluRequest: vi.fn().mockResolvedValue({
                    ok: false,
                    error: { code: 'not-playable', message: '404', stage: 'upstream', httpStatus: 404 },
                }),
            },
        });
        const detail = await tongrenluProvider.catalog!.getAlbumDetail!(99999999);
        expect(detail).toBeNull();
    });

    it('rewrites a detail row track so the parent album id is preserved', async () => {
        vi.stubGlobal('window', {
            electron: {
                tongrenluRequest: vi.fn().mockResolvedValue({
                    ok: true,
                    data: {
                        id: 8444,
                        title: 'Looks',
                        artist: 'Reset All Controllers',
                        cloudMusicPicUrl: 'https://p2.music.126.net/x.jpg',
                        tracks: [
                            { id: 223443, name: 'Looks', trackNumber: 1, cloudMusicId: 1500182591 },
                            { id: 223444, name: 'Seraphic Gate', trackNumber: 2, cloudMusicId: 1500184271 },
                        ],
                    },
                }),
            },
        });
        const tracks = await tongrenluProvider.catalog!.getAlbumTracks!(8444);
        expect(tracks.items.length).toBe(2);
        expect(tracks.items.every(track => String((track.sourceRef as { providerData?: Record<string, unknown> }).providerData?.albumId) === '8444')).toBe(true);
    });
});
