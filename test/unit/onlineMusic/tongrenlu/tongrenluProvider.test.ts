import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';
import { OnlineProviderError } from '@/types/onlineMusic';
import { listOnlineMusicProviders, getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { tongrenluProvider } from '@/services/onlineMusic/tongrenlu/tongrenluProvider';
import { getTongrenluAvailability } from '@/services/onlineMusic/tongrenlu/tongrenluAvailability';

// test/unit/onlineMusic/tongrenluProvider.test.ts

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
            lyrics: false,
            auth: false,
            userLibrary: true,
            playlists: false,
            albums: true,
            artists: true,
            userAlbums: true,
            recommendations: false,
            mutations: false,
            wordByWordLyrics: false,
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
