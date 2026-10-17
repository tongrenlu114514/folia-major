import type { Artist, UnifiedSong } from '../../../types';
import type {
    MediaId,
    OnlineProviderId,
    ProviderAlbumSummary,
    ProviderArtistSummary,
    ProviderCollection,
} from '../../../types/onlineMusic';


// src/services/onlineMusic/tongrenluNormalize.ts

const PROVIDER_ID: OnlineProviderId = 'tongrenlu';

const pick = (raw: any, ...keys: string[]): any => {
    for (const key of keys) {
        const value = raw?.[key];
        if (value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
};

const text = (value: unknown): string => (
    value === undefined || value === null ? '' : String(value).trim()
);

const record = (value: unknown): any => (
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);

/** The site uses both numeric and string-shaped ids; normalize to MediaId. */
const asMediaId = (value: unknown): MediaId => {
    if (value === undefined || value === null || value === '') return '' as MediaId;
    const numeric = Number(value);
    return Number.isFinite(numeric) && String(numeric) === String(value) ? numeric : String(value);
};

const tongrenluCatalogRef = (kind: 'album' | 'artist' | 'playlist', id: MediaId) => (
    id !== '' ? { providerId: PROVIDER_ID, kind, id } : undefined
);

export const normalizeTongrenluCoverUrl = (coverUrl: unknown): string | undefined => {
    const raw = text(coverUrl);
    if (!raw) return undefined;
    // The site ships image urls that sometimes already carry a `?param=WxH` qualifier (from
    // the 126.net CDN).  Strip it unconditionally so the offline cache and downstream
    // `getSizedCoverUrl` always see a clean origin URL; `getSizedCoverUrl` will add the
    // correct size suffix when actually fetching.
    return raw.replace(/\?param=\d+x?\d*$/i, '');
};

/**
 * Accepts both album-row payloads (`/search`, `/random-albums`) and track-row payloads
 * (`/detail.tracks[]`, `/track`). The two carry a different mix of fields; we lift the
 * shared ones out here so callers don't have to choose.
 */
export const normalizeTongrenluSong = (raw: unknown): UnifiedSong => {
    const item = record(raw);

    // Identity: track id is the only stable playback identity (mp3 url is regenerated per request).
    const trackId = asMediaId(pick(item, 'id'));

    // Album id lives on the row for `/search` (album id) and inside `articleId` for `/detail.tracks[]`.
    // A row that already carries a track-style `id` (track payload) falls back to that id when the
    // upstream omitted `articleId`, so the parent album stays reachable.
    const albumId = asMediaId(pick(item, 'articleId', 'albumId')) || asMediaId(item.id);
    const albumTitle = text(pick(item, 'albumTitle', 'cloudMusicName')) || (
        // Album-row payloads (search results, random albums) carry `title` for the album name.
        // Track-row payloads (detail.tracks[]) carry `name` for the track and never have a
        // top-level `title`, so we only pick `title` when the row lacks track-shape markers.
        ('trackNumber' in item || 'disc' in item || 'original' in item || 'originalUrl' in item)
            ? ''
            : text(pick(item, 'title'))
    ) || 'Unknown Album';
    const albumCover = normalizeTongrenluCoverUrl(pick(item, 'cloudMusicPicUrl'));

    const trackName = text(pick(item, 'name', 'title')) || 'Unknown Track';
    const trackNumber = Number(pick(item, 'trackNumber'));
    const discNumber = text(pick(item, 'disc')) || undefined;

    // Artist: every track belongs to exactly one circle. The catalog has it both flat on the
    // search row (`artist`) and nested-less on detail rows (no per-track artist field — it is
    // the album's artist).
    const artistName = text(pick(item, 'artist')) || 'Unknown Artist';

    const catalogRef = tongrenluCatalogRef('album', albumId);

    const artist: Artist = {
        id: asMediaId(artistName), // No per-artist id on a track row; use the name as a stable display key.
        name: artistName,
        ...(catalogRef ? {} : {}),
    };

    return {
        id: trackId,
        name: trackName,
        artists: [artist],
        album: {
            id: albumId,
            name: albumTitle,
            ...(albumCover ? { coverUrl: albumCover } : {}),
            ...(catalogRef ? { catalogRef } : {}),
        },
        durationMs: 0, // Tongrenlu's detail row gives `"duration"` as an `m:ss` string; the audio source has no time field either. Leave 0 and let the player surface it.
        ...(Number.isFinite(trackNumber) && trackNumber > 0 ? { t: 1 as const } : {}),
        sourceRef: {
            kind: 'online',
            providerId: PROVIDER_ID,
            mediaId: String(trackId),
            providerData: {
                albumId: String(albumId),
                trackNumber: Number.isFinite(trackNumber) ? trackNumber : null,
                disc: discNumber ?? null,
                cloudMusicId: pick(item, 'cloudMusicId') ?? null,
                cloudMusicName: pick(item, 'cloudMusicName') ?? null,
                original: pick(item, 'original') ?? null,
                originalUrl: pick(item, 'originalUrl') ?? null,
            },
        },
    };
};

/** Album-row payload -> ProviderCollection of type 'album'. */
export const normalizeTongrenluCollection = (raw: unknown, type: string = 'album'): ProviderCollection => {
    const item = record(raw);
    const id = asMediaId(pick(item, 'id'));
    const name = text(pick(item, 'title', 'name')) || 'Unknown Album';
    const coverUrl = normalizeTongrenluCoverUrl(pick(item, 'cloudMusicPicUrl'));
    const artist = text(pick(item, 'artist')) || undefined;
    const description = text(pick(item, 'description')) || undefined;
    const publishDate = pick(item, 'publishDate');
    const updDate = pick(item, 'updDate');
    const trackCount = Number(pick(item, 'trackCount'));
    const accessCount = Number(pick(item, 'accessCount'));
    const thbWikiUrl = text(pick(item, 'thbWikiUrl')) || undefined;

    const publishedAt = typeof publishDate === 'string' && publishDate ? Date.parse(publishDate) : undefined;
    const updatedAt = typeof updDate === 'string' && updDate ? Date.parse(updDate) : undefined;

    const artists: ProviderArtistSummary[] | undefined = artist
        ? [{
            id: asMediaId(artist),
            name: artist,
            ...(tongrenluCatalogRef('artist', asMediaId(artist)) ?? {}),
        }]
        : undefined;

    return {
        providerId: PROVIDER_ID,
        id,
        name,
        type,
        ...(coverUrl ? { coverUrl } : {}),
        ...(description ? { description } : {}),
        ...(Number.isFinite(trackCount) && trackCount > 0 ? { trackCount } : {}),
        ...(artists ? { artists } : {}),
        ...(Number.isFinite(publishedAt) ? { publishedAt } : {}),
        ...(Number.isFinite(updatedAt) ? { updatedAt } : {}),
        ...(thbWikiUrl ? { providerData: { thbWikiUrl } } : {}),
    };
};

/** Artist-row payload -> ProviderArtistSummary (also used as a tiny ProviderCollection for navigation). */
export const normalizeTongrenluArtist = (raw: unknown): ProviderArtistSummary & { providerId: OnlineProviderId } => {
    const item = record(raw);
    const id = asMediaId(pick(item, 'id'));
    const name = text(pick(item, 'name')) || 'Unknown Artist';
    const coverUrl = normalizeTongrenluCoverUrl(pick(item, 'cloud_music_pic_url'));
    return {
        providerId: PROVIDER_ID,
        id,
        name,
        ...(coverUrl ? { entityId: coverUrl } : {}),
        catalogRef: tongrenluCatalogRef('artist', id),
    };
};

/** Convenience: turn an artist summary into a navigable ProviderCollection of type 'artist'. */
export const tongrenluArtistAsCollection = (artist: ProviderArtistSummary): ProviderCollection => ({
    providerId: PROVIDER_ID,
    id: artist.id,
    name: artist.name,
    type: 'artist',
    ...(artist.entityId ? { coverUrl: artist.entityId } : {}),
});

/** Convenience: album summary used inside ProviderSongMetadata.album. */
export const normalizeTongrenluAlbumSummary = (raw: unknown): ProviderAlbumSummary => {
    const item = record(raw);
    const id = asMediaId(pick(item, 'id'));
    const name = text(pick(item, 'title', 'name')) || 'Unknown Album';
    const coverUrl = normalizeTongrenluCoverUrl(pick(item, 'cloudMusicPicUrl'));
    return {
        id,
        name,
        ...(coverUrl ? { coverUrl } : {}),
        ...(tongrenluCatalogRef('album', id) ? { catalogRef: tongrenluCatalogRef('album', id)! } : {}),
    };
};
