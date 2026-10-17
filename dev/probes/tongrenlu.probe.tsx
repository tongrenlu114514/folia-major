import { useCallback, useEffect, useState } from 'react';
import { getOnlineMusicProvider, listOnlineMusicProviders } from '../../src/services/onlineMusic/providerRegistry';
import { getTongrenluAvailability } from '../../src/services/onlineMusic/tongrenlu/tongrenluAvailability';
import { requestTongrenlu } from '../../src/services/onlineMusic/tongrenlu/tongrenluTransport';
import { normalizeTongrenluSong } from '../../src/services/onlineMusic/tongrenlu/tongrenluNormalize';
import type { ProbeDefinition } from './definition';

// dev/probes/tongrenlu.probe.tsx

// Pick a circle with a known album from the public catalog and use it as the smoke fixture
// (real values from earlier probing: artist id 26 = 幽閉サテライト, album id 8444 = Looks).
const SMOKE_ARTIST_ID = 26;
const SMOKE_ALBUM_ID = 8444;
const SMOKE_TRACK_ID = 223443;

type StepStatus = 'idle' | 'running' | 'ok' | 'error';

type StepResult = {
    status: StepStatus;
    label: string;
    detail?: string;
    payload?: unknown;
};

const baseStep = (label: string): StepResult => ({ status: 'idle', label });

function TongrenluProbe() {
    const provider = getOnlineMusicProvider('tongrenlu');
    const [summary, setSummary] = useState<StepResult>(baseStep('Provider registered'));
    const [availability, setAvailability] = useState<StepResult>(baseStep('Availability'));
    const [randomAlbums, setRandomAlbums] = useState<StepResult>(baseStep('Random albums (raw /random-albums)'));
    const [artistAlbums, setArtistAlbums] = useState<StepResult>(baseStep(`Artist #${SMOKE_ARTIST_ID} albums (catalog.getArtistAlbums)`));
    const [albumTracks, setAlbumTracks] = useState<StepResult>(baseStep(`Album #${SMOKE_ALBUM_ID} tracks (catalog.getAlbumTracks)`));
    const [audioSource, setAudioSource] = useState<StepResult>(baseStep(`Track #${SMOKE_TRACK_ID} audio URL (playback.getAudioSource)`));

    const run = useCallback(async () => {
        // 1) Provider registration — does `tongrenlu` show up in `listOnlineMusicProviders`?
        try {
            const list = listOnlineMusicProviders().map((p: { id: string; displayName: string }) => ({ id: p.id, displayName: p.displayName }));
            const found = list.find((entry: { id: string }) => entry.id === 'tongrenlu');
            if (!found) throw new Error('tongrenlu is missing from providerRegistry');
            setSummary({ status: 'ok', label: 'Provider registered', detail: `id=${found.id} displayName=${found.displayName}`, payload: list });
        } catch (error) {
            setSummary({ status: 'error', label: 'Provider registered', detail: errorMessage(error) });
            return;
        }

        // 2) Availability — is VITE_TONGRENLU_API_BASE / Electron bridge configured?
        try {
            const value = getTongrenluAvailability();
            if (!value.configured) {
                throw new Error(`availability says not-configured: ${value.reason ?? 'unknown'}`);
            }
            setAvailability({ status: 'ok', label: 'Availability', detail: 'configured: true', payload: value });
        } catch (error) {
            setAvailability({ status: 'error', label: 'Availability', detail: errorMessage(error) });
            return;
        }

        // 3) Random albums — raw transport probe (the only provider-side shape that uses an array
        // body rather than `{ records, total, ... }`).
        try {
            setRandomAlbums(prev => ({ ...prev, status: 'running' }));
            const raw = await requestTongrenlu<any>('random-albums', { count: 5 });
            setRandomAlbums({ status: 'ok', label: 'Random albums (raw /random-albums)', detail: `got ${Array.isArray(raw) ? raw.length : 'n/a'} entries`, payload: raw });
        } catch (error) {
            setRandomAlbums({ status: 'error', label: 'Random albums (raw /random-albums)', detail: errorMessage(error), payload: extractErrorPayload(error) });
            return;
        }

        if (!provider) return;
        const catalog = provider.catalog;
        const playback = provider.playback;

        // 4) Artist albums — exercises the catalog adapter (the `/search?tag=<circle>` fallback).
        try {
            setArtistAlbums(prev => ({ ...prev, status: 'running' }));
            const page = await catalog?.getArtistAlbums!(SMOKE_ARTIST_ID, 5, 0);
            if (!page) throw new Error('catalog.getArtistAlbums is not implemented');
            setArtistAlbums({
                status: 'ok',
                label: `Artist #${SMOKE_ARTIST_ID} albums (catalog.getArtistAlbums)`,
                detail: `items=${page.items.length} hasMore=${page.hasMore}`,
                payload: page,
            });
        } catch (error) {
            setArtistAlbums({ status: 'error', label: `Artist #${SMOKE_ARTIST_ID} albums (catalog.getArtistAlbums)`, detail: errorMessage(error), payload: extractErrorPayload(error) });
            return;
        }

        // 5) Album tracks — exercises normalization + sourceRef.albumId back-fill.
        try {
            setAlbumTracks(prev => ({ ...prev, status: 'running' }));
            const page = await catalog?.getAlbumTracks!(SMOKE_ALBUM_ID, 5, 0);
            if (!page) throw new Error('catalog.getAlbumTracks is not implemented');
            const first = page.items[0];
            setAlbumTracks({
                status: 'ok',
                label: `Album #${SMOKE_ALBUM_ID} tracks (catalog.getAlbumTracks)`,
                detail: first ? `first="${first.name}" albumId=${((first.sourceRef as { providerData?: Record<string, unknown> }).providerData?.albumId as string | undefined) ?? 'n/a'}` : 'no items',
                payload: page,
            });
        } catch (error) {
            setAlbumTracks({ status: 'error', label: `Album #${SMOKE_ALBUM_ID} tracks (catalog.getAlbumTracks)`, detail: errorMessage(error), payload: extractErrorPayload(error) });
            return;
        }

        // 6) Audio source — full playback round-trip; this is the actual mp3 URL the player will load.
        try {
            setAudioSource(prev => ({ ...prev, status: 'running' }));
            const trackPage = await catalog?.getAlbumTracks!(SMOKE_ALBUM_ID, 1, 0);
            const firstSong = trackPage?.items[0] ?? normalizeTongrenluSong({ id: SMOKE_TRACK_ID, name: 'Looks', articleId: SMOKE_ALBUM_ID });
            const source = await playback?.getAudioSource(firstSong, 'standard');
            if (!source) throw new Error('playback.getAudioSource returned null');
            // Only show the host + path of the mp3 URL — never echo tokens or signatures.
            const safeUrl = sanitizeAudioUrl(source.url);
            setAudioSource({
                status: 'ok',
                label: `Track #${SMOKE_TRACK_ID} audio URL (playback.getAudioSource)`,
                detail: `quality=${source.quality} url=${safeUrl} fetchedAt=${new Date(source.fetchedAt).toISOString()}`,
                payload: { url: safeUrl, quality: source.quality },
            });
        } catch (error) {
            setAudioSource({ status: 'error', label: `Track #${SMOKE_TRACK_ID} audio URL (playback.getAudioSource)`, detail: errorMessage(error), payload: extractErrorPayload(error) });
        }
    }, [provider]);

    useEffect(() => { void run(); }, [run]);

    return (
        <div className="mx-auto flex max-w-4xl flex-col gap-3 p-4 font-mono text-sm text-zinc-100">
            <h1 className="text-lg font-bold text-white">Tongrenlu smoke probe</h1>
            <p className="text-zinc-400">
                Walks through the provider: registration → availability → random albums (raw transport) →
                artist albums → album tracks → audio URL. Open the browser DevTools Network tab to see
                the upstream calls. Set <code>VITE_TONGRENLU_API_BASE=http://121.37.183.44/tongrenlu</code> in
                <code>.env.local</code> first; otherwise step 2 will fail with <code>not-configured</code>.
            </p>
            <button onClick={() => void run()} className="self-start rounded border border-zinc-600 bg-zinc-800 px-3 py-1 hover:bg-zinc-700">Re-run</button>
            {([summary, availability, randomAlbums, artistAlbums, albumTracks, audioSource] as StepResult[]).map(step => (
                <StepView key={step.label} step={step} />
            ))}
        </div>
    );
}

function StepView({ step }: { step: StepResult }) {
    const colorClass = step.status === 'ok' ? 'border-emerald-600'
        : step.status === 'error' ? 'border-rose-600'
            : step.status === 'running' ? 'border-amber-600' : 'border-zinc-700';
    return (
        <section className={`rounded border ${colorClass} bg-zinc-900 p-3`}>
            <header className="flex items-center justify-between">
                <span className="font-bold text-white">{step.label}</span>
                <span className="text-xs uppercase tracking-wider text-zinc-400">{step.status}</span>
            </header>
            {step.detail && <p className="mt-1 text-zinc-300">{step.detail}</p>}
            {step.payload !== undefined && (
                <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-zinc-400">payload</summary>
                    <pre className="mt-1 max-h-72 overflow-auto rounded bg-black/40 p-2 text-xs text-zinc-300">{JSON.stringify(step.payload, null, 2)}</pre>
                </details>
            )}
        </section>
    );
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    return String(error);
}

function extractErrorPayload(error: unknown): Record<string, unknown> | undefined {
    if (error && typeof error === 'object' && 'details' in error) {
        const candidate = (error as { details?: unknown }).details;
        if (candidate && typeof candidate === 'object') return candidate as Record<string, unknown>;
    }
    return undefined;
}

function sanitizeAudioUrl(url: string): string {
    // The mp3 URL carries a vuutv signature and cdntag marker that look like secrets; collapse them
    // to ".../audio.mp3?<sig>" so the probe never echoes them and we still know the shape.
    try {
        const parsed = new URL(url);
        const path = parsed.pathname.split('/').pop() ?? parsed.pathname;
        return `${parsed.protocol}//${parsed.host}/.../${path}?${parsed.searchParams.size > 0 ? '<sig>' : ''}`;
    } catch {
        return '<invalid url>';
    }
}

export default {
    id: 'tongrenlu',
    title: 'Tongrenlu smoke probe',
    description: '端到端验证 tongrenlu provider 注册、可用性、目录浏览与音源拉取。',
    Component: TongrenluProbe,
} satisfies ProbeDefinition;
