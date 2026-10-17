import type { ProviderAccountSummary } from '../../../types/onlineMusic';

// src/library/core/account/onlineProviderAccountView.ts
// 在线 provider 的账户视图（纯规则）：首页与账户切换器共用。P3.3 从 components/app/home 挪进 core，
// 任何 suite 的首页都按它决定显示列表、登录入口还是「无账户」面板。

/** `accountless`: a provider with no account at all (a Folium mod source), so no library to show either. */
export type OnlineProviderAccountView = 'resolving' | 'guest' | 'authenticated' | 'accountless';

// An accountless provider has neither an account flow to run nor a user-bound library to surface —
// a Folium mod source where the only meaningful UI is the search box. Providers that expose
// `userLibrary: true` (even without an auth flow, e.g. Tongrenlu's circle browser) are NOT
// accountless: their grid content path uses the registered sentinel user to load the library
// feed, and the standard tab list applies. Callers that don't know the capability fall back to
// the historical `requiresAccount === false` check (true when capability info is missing).
const isAccountless = (provider: ProviderAccountSummary | undefined, userLibrary?: boolean) => {
    if (provider?.requiresAccount !== false) return false;
    return userLibrary === undefined ? true : !userLibrary;
};

// Keeps an unresolved account distinct from a confirmed anonymous session during startup hydration.
// An accountless provider never gets an account entry, so its status stays 'unknown' for good; it is
// settled first, before that would read as an account still resolving.
export const resolveOnlineProviderAccountView = ({
    provider,
    userLibrary,
    hasUser,
    platformAvailable,
}: {
    provider?: ProviderAccountSummary;
    userLibrary: boolean;
    hasUser: boolean;
    platformAvailable: boolean;
}): OnlineProviderAccountView => {
    if (isAccountless(provider, userLibrary)) return 'accountless';
    if (hasUser) return 'authenticated';
    if (platformAvailable && (provider?.hydration === 'loading' || provider?.status === 'unknown')) return 'resolving';
    return 'guest';
};

/** Whether picking the provider switches to it now (signed in, or nothing to sign in to) rather than signing in first. */
export const canSwitchToProviderDirectly = (provider: ProviderAccountSummary, userLibrary?: boolean): boolean => (
    provider.status === 'authenticated' || isAccountless(provider, userLibrary)
);
