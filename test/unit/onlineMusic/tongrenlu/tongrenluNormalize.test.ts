import { describe, expect, it } from 'vitest';
import {
    normalizeTongrenluAlbumSummary,
    normalizeTongrenluArtist,
    normalizeTongrenluCollection,
    normalizeTongrenluSong,
    tongrenluArtistAsCollection,
} from '@/services/onlineMusic/tongrenlu/tongrenluNormalize';

// test/unit/onlineMusic/tongrenluNormalize.test.ts

describe('normalizeTongrenluSong', () => {
    it('promotes a search-row payload into a UnifiedSong with provider-scoped identity', () => {
        const raw = {
            id: 8444,
            title: 'Looks',
            artist: 'Reset All Controllers',
            cloudMusicId: 99085083,
            cloudMusicPicUrl: 'https://p2.music.126.net/x.jpg',
        };
        const song = normalizeTongrenluSong(raw);
        expect(song.id).toBe(8444);
        expect(song.name).toBe('Looks');
        expect(song.artists).toEqual([{ id: 'Reset All Controllers', name: 'Reset All Controllers' }]);
        expect(song.album.id).toBe(8444);
        expect(song.album.name).toBe('Looks');
        expect(song.album.coverUrl).toBe('https://p2.music.126.net/x.jpg');
        expect(song.sourceRef).toMatchObject({
            kind: 'online',
            providerId: 'tongrenlu',
            mediaId: '8444',
        });
        expect((song.sourceRef as { providerData?: Record<string, unknown> }).providerData).toMatchObject({
            albumId: '8444',
            cloudMusicId: 99085083,
        });
    });

    it('lifts the parent album id from a track row that carries articleId instead of albumId', () => {
        const raw = {
            id: 223443,
            name: 'Looks',
            articleId: 8444,
            trackNumber: 1,
            disc: '01',
            cloudMusicId: 1500182591,
        };
        const song = normalizeTongrenluSong(raw);
        expect(song.id).toBe(223443);
        expect(song.album.id).toBe(8444);
        expect((song.sourceRef as { providerData?: Record<string, unknown> }).providerData).toMatchObject({
            albumId: '8444',
            trackNumber: 1,
            disc: '01',
        });
    });

    it('falls back to stable strings when fields are missing rather than coercing to undefined', () => {
        const song = normalizeTongrenluSong({});
        expect(song.name).toBe('Unknown Track');
        expect(song.artists).toEqual([{ id: 'Unknown Artist', name: 'Unknown Artist' }]);
        expect(song.album.name).toBe('Unknown Album');
        expect(song.sourceRef.mediaId).toBe('');
    });

    it('preserves the THBWiki original-info evidence inside providerData', () => {
        const raw = {
            id: 223443,
            name: 'Looks',
            articleId: 8444,
            original: '万年置き傘にご注意を ／ 东方星莲船',
            originalUrl: 'https://thbwiki.cc/%E4%B8%9C%E6%96%B9%E6%98%9F%E8%8E%B2%E8%88%B9',
        };
        const song = normalizeTongrenluSong(raw);
        expect((song.sourceRef as { providerData?: Record<string, unknown> }).providerData).toMatchObject({
            original: '万年置き傘にご注意を ／ 东方星莲船',
            originalUrl: 'https://thbwiki.cc/%E4%B8%9C%E6%96%B9%E6%98%9F%E8%8E%B2%E8%88%B9',
        });
    });
});

describe('normalizeTongrenluCollection', () => {
    it('builds a ProviderCollection of type album with publication metadata', () => {
        const raw = {
            id: 8444,
            title: 'Looks',
            description: 'winter omnibus',
            artist: 'Reset All Controllers',
            cloudMusicPicUrl: 'https://p2.music.126.net/x.jpg',
            publishDate: '2025-12-30T16:00:00.000+00:00',
            accessCount: 42,
            trackCount: 7,
            thbWikiUrl: 'https://thbwiki.cc/Looks',
        };
        const collection = normalizeTongrenluCollection(raw, 'album');
        expect(collection.providerId).toBe('tongrenlu');
        expect(collection.type).toBe('album');
        expect(collection.name).toBe('Looks');
        expect(collection.trackCount).toBe(7);
        expect(collection.coverUrl).toBe('https://p2.music.126.net/x.jpg');
        expect(collection.publishedAt).toBe(Date.parse('2025-12-30T16:00:00.000+00:00'));
        expect(collection.artists?.length).toBe(1);
        expect(collection.providerData?.thbWikiUrl).toBe('https://thbwiki.cc/Looks');
    });
});

describe('normalizeTongrenluArtist', () => {
    it('keeps the public archive id and adds a catalogRef keyed for navigation', () => {
        const summary = normalizeTongrenluArtist({
            id: 26,
            name: '幽閉サテライト',
            cloud_music_pic_url: 'https://p2.music.126.net/y.jpg',
            album_count: 232,
        });
        expect(summary.providerId).toBe('tongrenlu');
        expect(summary.id).toBe(26);
        expect(summary.name).toBe('幽閉サテライト');
        expect(summary.entityId).toBe('https://p2.music.126.net/y.jpg');
        expect(summary.catalogRef).toEqual({ providerId: 'tongrenlu', kind: 'artist', id: 26 });
    });
});

describe('tongrenluArtistAsCollection', () => {
    it('wraps an artist summary as a navigable ProviderCollection of type artist', () => {
        const summary = normalizeTongrenluArtist({ id: 26, name: '幽閉サテライト', cloud_music_pic_url: 'https://p2.music.126.net/y.jpg' });
        const collection = tongrenluArtistAsCollection(summary);
        expect(collection.type).toBe('artist');
        expect(collection.id).toBe(26);
        expect(collection.name).toBe('幽閉サテライト');
        expect(collection.coverUrl).toBe('https://p2.music.126.net/y.jpg');
    });
});

describe('normalizeTongrenluAlbumSummary', () => {
    it('keeps a stable catalogRef when present', () => {
        const summary = normalizeTongrenluAlbumSummary({ id: 8444, title: 'Looks', cloudMusicPicUrl: 'https://p2.music.126.net/x.jpg' });
        expect(summary.id).toBe(8444);
        expect(summary.coverUrl).toBe('https://p2.music.126.net/x.jpg');
        expect(summary.catalogRef).toEqual({ providerId: 'tongrenlu', kind: 'album', id: 8444 });
    });
});
