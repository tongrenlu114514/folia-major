import type { SongResult, UnifiedSong } from '../../../types';
import {
    OnlineProviderError,
    type MediaId,
    type OnlineMusicProvider,
    type OnlinePlaybackProvider,
    type ProviderAlbumSummary,
    type ProviderArtistSummary,
    type ProviderAudioSource,
    type ProviderCollection,
    type ProviderPage,
    type ProviderSongMetadata,
} from '../../../types/onlineMusic';
import { getPlaybackSourceRef } from '../../../utils/appPlaybackGuards';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';
import { getTongrenluAvailability } from './tongrenluAvailability';
import {
    normalizeTongrenluAlbumSummary,
    normalizeTongrenluArtist,
    normalizeTongrenluCollection,
    normalizeTongrenluCoverUrl,
    normalizeTongrenluSong,
    tongrenluArtistAsCollection,
} from './tongrenluNormalize';
import {
    getTongrenluTransportAvailability,
    requestTongrenlu,
} from './tongrenluTransport';

// src/services/onlineMusic/tongrenluProvider.ts

const PROVIDER_ID = 'tongrenlu' as const;

// ----- playback: detail + audio -----

const fetchTrackDetail = async (id: MediaId): Promise<UnifiedSong | null> => {
    try {
        const raw = await requestTongrenlu<any>('track', { id });
        // `/track` only returns the audio url and the display name; promote to a UnifiedSong by
        // back-filling `id` so `getSongDetail` is usable as the playback identity lookup.
        if (!raw) return null;
        const numericId = Number(id);
        return normalizeTongrenluSong({ ...raw, id: Number.isFinite(numericId) ? numericId : String(id) });
    } catch (error) {
        if (error instanceof OnlineProviderError && error.code === 'not-playable') return null;
        throw error;
    }
};

const resolveAudioUrl = async (song: SongResult): Promise<ProviderAudioSource | null> => {
    return resolveAudioUrlInner(song, new Set<string>());
};

const resolveAudioUrlInner = async (
    song: SongResult,
    seenAlbumIds: Set<string>,
): Promise<ProviderAudioSource | null> => {
    const sourceRef = getPlaybackSourceRef(song);
    if (sourceRef.kind !== 'online' || sourceRef.providerId !== PROVIDER_ID) {
        throw new OnlineProviderError('unsupported', 'Tongrenlu audio request received a non-tongrenlu song', PROVIDER_ID);
    }
    let raw: any;
    try {
        raw = await requestTongrenlu<any>('track', { id: sourceRef.mediaId });
    } catch (error) {
        if (error instanceof OnlineProviderError && error.code === 'not-playable') {
            // A documented "not playable" answer means the id is not a track id. For search results
            // (album rows normalized as songs) the id is an album id — fall back to the album's
            // first track so the user can still play from search.
            const albumId = song.album?.id;
            if (albumId && !seenAlbumIds.has(String(albumId))) {
                const albumIdStr = String(albumId);
                seenAlbumIds.add(albumIdStr);
                const tracks = await fetchAlbumTracks(albumId, 1, 0);
                if (tracks.items.length > 0) {
                    return resolveAudioUrlInner(tracks.items[0], seenAlbumIds);
                }
            }
            return null;
        }
        throw error;
    }
    if (!raw?.url) return null;
    // Return the dev proxy URL so the browser can stream audio with CORS headers.
    // In production (non-localhost) the raw CDN URL would be used directly.
    const isLocalhost = typeof window !== 'undefined' && window.location?.hostname === 'localhost';
    const audioUrl = isLocalhost
        ? `/api/tongrenlu/audio?id=${encodeURIComponent(String(raw.url))}`
        : String(raw.url);
    return {
        url: audioUrl,
        fetchedAt: Date.now(),
        quality: 'standard',
    };
};

const playback: OnlinePlaybackProvider = {
    getSongDetail: fetchTrackDetail,
    getAudioSource: resolveAudioUrl,
};

// ----- catalog: albums (album-detail) and artists (artist-detail w/ albums) -----

const fetchAlbumDetail = async (albumId: MediaId): Promise<ProviderCollection | null> => {
    try {
        const raw = await requestTongrenlu<any>('detail', { albumId });
        return raw ? normalizeTongrenluCollection(raw, 'album') : null;
    } catch (error) {
        if (error instanceof OnlineProviderError && error.code === 'not-playable') return null;
        throw error;
    }
};

const fetchAlbumTracks = async (
    albumId: MediaId,
    limit: number = 1000,
    offset: number = 0,
): Promise<ProviderPage<UnifiedSong>> => {
    const raw = await requestTongrenlu<any>('detail', { albumId });
    const tracks = Array.isArray(raw?.tracks) ? raw.tracks : [];
    // Back-fill the parent album id and cover onto every track so the resulting UnifiedSongs
    // carry `sourceRef.providerData.albumId` and `album.coverUrl`. Track rows from `/detail`
    // never carry the cover themselves — it lives on the parent album payload.
    const albumCover = normalizeTongrenluCoverUrl(raw?.cloudMusicPicUrl);
    const normalized = tracks.map((track: any) => normalizeTongrenluSong({
        ...track,
        articleId: track.articleId ?? albumId,
        ...(albumCover ? { cloudMusicPicUrl: albumCover } : {}),
    }));
    const items = normalized.slice(offset, offset + limit);
    return {
        items,
        hasMore: offset + limit < normalized.length,
        nextOffset: offset + items.length,
    };
};

const ARTIST_PAGE_SIZE_MAX = 1000; // site rejects above this; one-shot fetch + client-side slice.

const RANDOM_ALBUM_BATCH = 200;

const fetchArtistList = async (
    _userId: MediaId,
    limit: number,
    offset: number,
): Promise<ProviderPage<ProviderCollection>> => {
    // Tongrenlu has no user-bound album list, so the Albums tab hands back a curated slice of
    // random albums (upstream `/random-albums?count=N`). A real `userLibrary` would page through
    // `/search`; we keep the noise low by streaming from `/random-albums` until the requested
    // window is filled.
    void _userId;
    const wanted = offset + limit;
    const items: ProviderCollection[] = [];
    while (items.length < wanted) {
        const batch = await requestTongrenlu<any[]>('random-albums', { count: RANDOM_ALBUM_BATCH });
        if (!Array.isArray(batch) || batch.length === 0) break;
        for (const row of batch) {
            const album = normalizeTongrenluCollection(row, 'album');
            // de-dupe by album id so two consecutive batches don't repeat the same row.
            if (!items.some(existing => existing.id === album.id)) items.push(album);
            if (items.length >= wanted) break;
        }
        if (batch.length < RANDOM_ALBUM_BATCH) break; // upstream exhausted
    }
    const sliced = items.slice(offset, offset + limit);
    return {
        items: sliced,
        hasMore: items.length > offset + limit,
        nextOffset: offset + sliced.length,
    };
};

const fetchArtistDetail = async (artistId: MediaId): Promise<ProviderCollection | null> => {
    // Site exposes no per-artist detail; scan the list until we find a matching id (the list
    // caps at 1000/page so it works in practice for the ~1859 artists the catalog has).
    const PAGE = 1000;
    let page = 1;
    for (;;) {
        const data = await requestTongrenlu<{ records: any[]; totalPages?: number }>(
            'artists',
            { page, limit: PAGE },
        );
        const records = Array.isArray(data?.records) ? data.records : [];
        const found = records.find(item => String(item.id) === String(artistId));
        if (found) return tongrenluArtistAsCollection(normalizeTongrenluArtist(found));
        const totalPages = data?.totalPages ?? 1;
        if (page >= totalPages) return null;
        page += 1;
    }
};

const fetchArtistAlbums = async (
    artistId: MediaId,
    limit: number,
    offset: number,
): Promise<ProviderPage<ProviderCollection>> => {
    // Site does not expose an artist-id filter on `/search`. Resolve the artist name and reuse
    // the tag-based search shape that the public archive uses (`/search?tag=<circleName>`).
    const artist = await fetchArtistDetail(artistId);
    if (!artist) return { items: [], hasMore: false, nextOffset: 0 };

    const pageNumber = Math.floor(offset / limit) + 1;
    const data = await requestTongrenlu<{ records: any[]; pages?: number }>(
        'search',
        { tag: artist.name, pageNumber, pageSize: ARTIST_PAGE_SIZE_MAX },
    );
    const records = Array.isArray(data?.records) ? data.records : [];
    const items = records.map(record => normalizeTongrenluCollection(record, 'album'));
    const sliced = items.slice(offset, offset + limit);
    return { items: sliced, hasMore: offset + limit < items.length, nextOffset: offset + sliced.length };
};

// ----- song metadata -----

const fetchSongMetadata = (song: SongResult): ProviderSongMetadata => {
    const sourceRef = getPlaybackSourceRef(song);
    const providerData = sourceRef.kind === 'online' ? (sourceRef.providerData ?? {}) : {};
    const albumId = (providerData as { albumId?: string }).albumId ?? '';
    const albumName = song.album?.name ?? 'Unknown Album';
    const albumCover = song.album?.coverUrl;
    const artistName = song.artists?.[0]?.name ?? 'Unknown Artist';

    const artists: ProviderArtistSummary[] = [{
        id: (song.artists?.[0]?.id ?? artistName) as MediaId,
        name: artistName,
    }];
    const album: ProviderAlbumSummary = {
        id: albumId as MediaId,
        name: albumName,
        ...(albumCover ? { coverUrl: albumCover } : {}),
    };
    return {
        artists,
        album,
        durationMs: song.durationMs ?? 0,
        ...(albumCover ? { coverUrl: albumCover } : {}),
        aliases: [],
        translatedNames: [],
    };
};

// ----- provider assembly -----

/**
 * Tongrenlu is a public, read-only catalog: no auth, no user library, no mutations, no lyrics,
 * no recommendations. The capabilities declared here are the exact subset that the upstream
 * API can answer today; anything else returns null and the UI hides the corresponding entry.
 */
export const tongrenluProvider: OnlineMusicProvider = {
    id: PROVIDER_ID,
    displayName: '东方同人录',
    shortName: '同人录',
    getAvailability: getTongrenluAvailability,
    capabilities: {
        search: true, // `/search?keyword=...` returns album rows; we map them to UnifiedSong
                       // so the search surface can display album cards and open album detail.
        playback: true,
        lyrics: false,
        auth: false,
        userLibrary: true, // The home grid "Albums" tab reads through `library.getUserAlbums`,
                            // which the provider implements as a circle browser. Marking the
                            // capability true unblocks that tab; `capabilities.auth: false`
                            // still keeps the account-summary flow out of the login picture.
        playlists: false,
        albums: true,
        artists: true,
        userAlbums: true,
        recommendations: false,
        mutations: false,
        wordByWordLyrics: false,
    },
    normalizeSong: normalizeTongrenluSong,
    normalizeCollection: normalizeTongrenluCollection,
    songMetadata: { getSongMetadata: fetchSongMetadata },
    getSongPageUrl: (song) => {
        const sourceRef = getPlaybackSourceRef(song);
        if (sourceRef.kind !== 'online' || sourceRef.providerId !== PROVIDER_ID) return null;
        const albumId = (sourceRef.providerData as { albumId?: string } | undefined)?.albumId;
        return albumId ? `https://thbwiki.cc/${encodeURIComponent(song.name)}` : null;
    },
    playback,
    search: {
        async searchSongs(query, limit, offset): Promise<ProviderPage<UnifiedSong>> {
            // `/track-search` returns individual track results with `id` (track id), `article_id`
            // (album id), `album_title`, `cloud_music_pic_url` etc. — all fields `normalizeTongrenluSong`
            // needs. Upstream does not support pagination; we slice the returned window.
            const raw = await requestTongrenlu<{ total?: number; hasMore?: boolean; nextOffset?: number; items: any[] }>(
                'track-search',
                { keyword: query },
            );
            const allItems = Array.isArray(raw?.items) ? raw.items : [];
            const sliced = allItems.slice(offset, offset + limit);
            const items = sliced.map(item => normalizeTongrenluSong({
                ...item,
                // Map track-search field names to what normalizeTongrenluSong expects.
                articleId: item.article_id,
                albumTitle: item.album_title,
                cloudMusicPicUrl: item.cloud_music_pic_url,
            }));
            return {
                items,
                total: raw?.total,
                hasMore: raw?.hasMore ?? false,
                nextOffset: raw?.nextOffset ?? offset + items.length,
            };
        },
    },
    catalog: {
        getAlbumDetail: fetchAlbumDetail,
        getAlbumTracks: fetchAlbumTracks,
        getArtistDetail: fetchArtistDetail,
        getArtistAlbums: fetchArtistAlbums,
        getArtistSongs: async (artistId, _limit, _offset): Promise<ProviderPage<UnifiedSong>> => {
            // Site exposes no "all tracks by artist" endpoint; the only path is album-by-artist
            // and then expanding each album. We implement that here so the call surface stays
            // symmetrical with the rest of the Omni contract.
            const albums = await fetchArtistAlbums(artistId, ARTIST_PAGE_SIZE_MAX, 0);
            const tracks: UnifiedSong[] = [];
            for (const album of albums.items) {
                const detail = await fetchAlbumTracks(album.id);
                tracks.push(...detail.items);
            }
            return { items: tracks, hasMore: false, nextOffset: tracks.length };
        },
        canResolveSongCatalogRefs: (song: UnifiedSong) => {
            const sourceRef = getPlaybackSourceRef(song);
            if (sourceRef.kind !== 'online' || sourceRef.providerId !== PROVIDER_ID) return false;
            const albumId = (sourceRef.providerData as { albumId?: string } | undefined)?.albumId;
            return Boolean(albumId);
        },
        resolveSongCatalogRefs: async (song: UnifiedSong): Promise<UnifiedSong> => {
            const sourceRef = getPlaybackSourceRef(song);
            if (sourceRef.kind !== 'online' || sourceRef.providerId !== PROVIDER_ID) return song;
            const albumId = (sourceRef.providerData as { albumId?: string } | undefined)?.albumId;
            if (!albumId) return song;
            const detail = await fetchAlbumDetail(albumId);
            if (!detail) return song;
            return {
                ...song,
                album: {
                    id: detail.id,
                    name: detail.name,
                    ...(detail.coverUrl ? { coverUrl: detail.coverUrl } : {}),
                    catalogRef: { providerId: PROVIDER_ID, kind: 'album', id: detail.id },
                },
            };
        },
    },
    /**
     * Tongrenlu has no per-user library, but the Omni contract has a `library.getUserAlbums`
     * hook that some UI surfaces use as "browse a user's albums". We satisfy the contract with
     * a circle-browser: each returned `ProviderCollection.type` is `'artist'`, so the UI knows
     * it is a circle entry, not a real user album. The `userId` argument is ignored on purpose.
     */
    library: {
        getUserPlaylists: async () => ({ items: [], hasMore: false, nextOffset: 0 }),
        getUserAlbums: fetchArtistList,
    },
};

// Module-level singletons used by the registry entry point and capability probes.
export const tongrenluHasBridge = (): boolean => getTongrenluTransportAvailability().configured;
export const tongrenluIsConfigured = (): boolean => tongrenluHasBridge();

// Re-export the metadata helper used by `ProviderSongMetadata.album` so `normalizeTongrenluAlbumSummary`
// is reachable from adapters that build metadata outside the provider's own entry points.
export { normalizeTongrenluAlbumSummary };

// Tongrenlu has no per-user account, so the homepage "favorite albums" feed would otherwise see
// an empty `userId` and refuse to attach an owner. We register a sentinel account once on module
// load so the grid's Albums tab can call `library.getUserAlbums` and stream the circle list back
// through the standard `favoriteAlbums` resource. The sentinel user id is empty string rather
// than null so the `ownerOf(providerId, userId, capable)` check accepts it without a per-provider
// branch in the home sources.
if (typeof window !== 'undefined') {
    useOnlineProviderAccountStore.getState().updateAccount(PROVIDER_ID, {
        status: 'anonymous',
        user: { id: '', nickname: '东方同人录' },
        hydration: 'ready',
        freshness: 'fresh',
    });
}
