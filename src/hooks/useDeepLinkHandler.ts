// src/hooks/useDeepLinkHandler.ts
// 处理来自外部链接的 deep link，例如 ?album=13002
// 支持：
//   ?album=<id>                 自动打开默认 provider 的专辑
//   ?provider=<id>&album=<id>   指定 provider 打开专辑

import { useEffect, useRef } from 'react';
import { omni } from '../services/onlineMusic/omni';
import type { OnlineProviderId } from '../types/onlineMusic';
import type { GridViewCollectionDescriptor } from '../components/app/home/gridViewCollectionAdapters';
import { setStatusMessage } from '../stores/useStatusMessageStore';
import { useCollectionNavigationStore } from '../stores/useCollectionNavigationStore';
import { useAppViewStore } from '../stores/useAppViewStore';
import { useOnlineProviderAccountStore } from '../stores/useOnlineProviderAccountStore';

interface DeepLinkHandlerOptions {
    navigateToCollection: (collection: GridViewCollectionDescriptor, origin: 'home' | 'search' | 'player') => void;
}

// 链接不带 ?provider= 时打开的 provider。
const DEFAULT_DEEP_LINK_PROVIDER_ID: OnlineProviderId = 'tongrenlu';

const stripDeepLinkFromUrl = () => {
    if (!window.location.search) return;
    const next = new URLSearchParams(window.location.search);
    next.delete('album');
    next.delete('provider');
    const query = next.toString();
    const hash = window.location.hash || '';
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${hash}`;
    window.history.replaceState(null, '', nextUrl);
};

const normalizeAlbumId = (raw: string | null): string | null => {
    if (!raw) return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const getCollectionHash = (collection: GridViewCollectionDescriptor) => (
    `#collection/${collection.source}/${collection.type}/${encodeURIComponent(String(collection.id))}`
);

const pushDeepLink = (
    collection: GridViewCollectionDescriptor,
    navigateToCollection: DeepLinkHandlerOptions['navigateToCollection'],
) => {
    navigateToCollection(collection, 'home');
    useAppViewStore.getState().setView('home');
    const hash = getCollectionHash(collection);
    if (window.location.hash !== hash) {
        window.history.replaceState(null, '', hash);
    }
};

export function useDeepLinkHandler({ navigateToCollection }: DeepLinkHandlerOptions) {
    const handledRef = useRef(false);

    useEffect(() => {
        if (handledRef.current) return;
        const params = new URLSearchParams(window.location.search);
        const albumId = normalizeAlbumId(params.get('album'));
        const providerParam = params.get('provider');
        if (!albumId) return;

        handledRef.current = true;
        // 链接里的 provider id 交给 Omni 校验：没登记的 id 会被 Omni 拒绝，
        // 而不是悄悄打开另一个 provider 的同名专辑。
        const providerId: OnlineProviderId = providerParam?.trim() || DEFAULT_DEEP_LINK_PROVIDER_ID;

        const openAlbum = async () => {
            try {
                // Verify provider is registered before fetching.
                omni.getProviderCapabilities(providerId);

                // Switch the active provider if necessary, so the home view shows the
                // right catalogue. The user is starting from a deep link, so it is OK
                // to commit the change without going through the provider switch UI.
                const activeProviderId = useOnlineProviderAccountStore.getState().activeProviderId;
                if (providerId !== activeProviderId) {
                    useOnlineProviderAccountStore.getState().setActiveProviderId(providerId);
                }

                const detail = await omni.getCollectionDetail({
                    providerId,
                    id: albumId,
                    type: 'album',
                    name: '',
                });

                const collection: GridViewCollectionDescriptor = {
                    source: 'online',
                    providerId,
                    id: albumId,
                    type: 'album',
                    name: detail?.name || 'Loading…',
                    coverUrl: detail?.coverUrl,
                    description: detail?.description,
                    trackCount: detail?.trackCount,
                    publisher: detail?.publisher,
                    publishedAt: detail?.publishedAt,
                    updatedAt: detail?.updatedAt,
                    providerData: detail?.providerData,
                };

                pushDeepLink(collection, navigateToCollection);
            } catch (error) {
                console.warn('[DeepLink] Failed to open album:', error);
                setStatusMessage({
                    type: 'error',
                    text: 'Failed to open album',
                });
            } finally {
                stripDeepLinkFromUrl();
            }
        };

        void openAlbum();
    }, [navigateToCollection]);
}
