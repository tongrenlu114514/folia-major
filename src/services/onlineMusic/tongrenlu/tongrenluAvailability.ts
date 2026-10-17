import type { ProviderAvailability } from '../../../types/onlineMusic';
import { getTongrenluTransportAvailability } from './tongrenluTransport';

// src/services/onlineMusic/tongrenluAvailability.ts

/**
 * Tongrenlu is a public catalog with no auth and no per-account concept. "Configured" is the
 * only thing we can truthfully report: the UI layer treats the provider as available whenever
 * the Web base URL is set or the Electron bridge is mounted. Reachability is observed at the
 * moment of the first real request — that is where transient failures belong, not here.
 */
export const getTongrenluAvailability = (): ProviderAvailability => {
    const availability = getTongrenluTransportAvailability();
    if (availability.configured) return { configured: true };
    return { configured: false, reason: availability.reason ?? 'not-configured' };
};
