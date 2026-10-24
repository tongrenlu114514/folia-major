import type { ProviderLyricsResult } from '../../../types/onlineMusic';
import { processNeteaseLyrics } from '../../../utils/lyrics/neteaseProcessing';
import type { RawNeteaseLyric } from '../../../utils/lyrics/types';

// src/services/onlineMusic/netease/publicLyricApi.ts

/**
 * The public NetEase lyric API.
 *
 * The endpoints are public: no login, no cookie, no signature. A caller that only knows a
 * NetEase song id can read that song's lyric through them, which is what a catalog that stores
 * a pointer to a NetEase song needs.
 *
 * - `/lyric/new?id=<songId>` — the full payload. Its `yrc` field carries the word-by-word lyric
 *   when the song has one, and `ytlrc` / `yromalrc` carry the translation and the romanization
 *   of those word-by-word lines.
 * - `/lyric?id=<songId>` — the line-timed lyric, for a song that has no word-by-word one.
 *
 * Both are asked in order, and the first answer that carries a lyric wins.
 */

/** The public NetEase lyric mirror. */
const NETEASE_LYRIC_BASE = 'https://apis.netstart.cn/music';

/** How long a lyric request may take before it is given up on. */
export const PUBLIC_LYRIC_TIMEOUT_MS = 15000;

/**
 * The lyric NetEase answers with when it has nothing for the song. It arrives as a normal 200
 * answer, not as an error, so it has to be recognized by its content.
 */
const EMPTY_LYRIC_MARKERS = ['[00:00.00]暂无歌词', '[00:00.000]暂无歌词'];

const isEmptyLyric = (text: string | undefined | null): boolean => {
    const trimmed = (text ?? '').trim();
    if (!trimmed) return true;
    return EMPTY_LYRIC_MARKERS.some((marker) => trimmed === marker);
};

/**
 * Whether a payload carries a lyric worth reading.
 *
 * A song the mirror does not know is answered with a 200 whose `lrc.lyric` is the "no lyric"
 * placeholder and whose `uncollected` flag is set. That answer is not a lyric.
 */
export const hasUsablePublicLyric = (payload: any): boolean => {
    if (!payload || typeof payload !== 'object') return false;
    if (payload.uncollected) return false;
    const lrc = payload.lrc?.lyric;
    const yrc = payload.yrc?.lyric;
    const nestedYrc = payload.lrc?.yrc?.lyric;
    return !isEmptyLyric(yrc) || !isEmptyLyric(nestedYrc) || !isEmptyLyric(lrc);
};

/**
 * Read one lyric payload from the mirror.
 *
 * @param path the endpoint path, `/lyric/new` or `/lyric`
 * @param songId the NetEase song id
 * @returns the parsed payload, or null when the request failed
 */
const requestLyricPayload = async (path: string, songId: string | number): Promise<any | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PUBLIC_LYRIC_TIMEOUT_MS);
    try {
        const response = await fetch(`${NETEASE_LYRIC_BASE}${path}?id=${encodeURIComponent(String(songId))}`, {
            method: 'GET',
            signal: controller.signal,
            credentials: 'omit',
        });
        if (!response.ok) return null;
        const payload = await response.json();
        return payload && typeof payload === 'object' ? payload : null;
    } catch {
        // A lyric is optional: a network failure or an abort must not break the playback.
        return null;
    } finally {
        clearTimeout(timer);
    }
};

/**
 * Read the raw lyric payload of a NetEase song.
 *
 * @param songId the NetEase song id
 * @returns the raw lyric payload in the shape the NetEase lyric pipeline reads, or null when the
 * song has no lyric
 */
export const fetchPublicNeteaseLyric = async (
    songId: string | number | null | undefined,
): Promise<RawNeteaseLyric | null> => {
    const id = String(songId ?? '').trim();
    if (!id || id === '0' || id === 'null' || id === 'undefined') return null;

    // The word-by-word endpoint first: it is the one that carries `yrc`.
    for (const path of ['/lyric/new', '/lyric']) {
        const payload = await requestLyricPayload(path, id);
        if (!hasUsablePublicLyric(payload)) continue;
        return {
            type: 'netease',
            ...payload,
        } as RawNeteaseLyric;
    }

    return null;
};

/**
 * Read the lyric of a NetEase song and parse it.
 *
 * @param songId the NetEase song id
 * @returns the parsed lyric, or null when the song has no lyric
 */
export const fetchPublicNeteaseLyrics = async (
    songId: string | number | null | undefined,
): Promise<ProviderLyricsResult | null> => {
    const payload = await fetchPublicNeteaseLyric(songId);
    if (!payload) return null;

    const processed = await processNeteaseLyrics(payload);
    return {
        lyrics: processed.lyrics,
        mainText: processed.mainLrc,
        wordByWordText: processed.yrcLrc,
        translationText: processed.transLrc,
        romanizationText: processed.romanizationLrc,
        isPureMusic: processed.isPureMusic,
    };
};
