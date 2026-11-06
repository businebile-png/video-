import type {StudioConfig} from '../schemas/config.js';
import {searchVideos, type PexelsSearch} from './pexels.js';
import {searchPixabay} from './pixabay.js';

/** The stock-footage library in use: Pixabay by default (Pexels has paused new API keys). */
export type StockProvider = StudioConfig['footage']['provider'];

export const STOCK_LICENSES: Record<StockProvider, {name: string; license: string; licenseUrl: string}> = {
  pexels: {
    name: 'Pexels',
    license: 'Licence Pexels (usage commercial autorisé, attribution non obligatoire)',
    licenseUrl: 'https://www.pexels.com/fr-fr/license/',
  },
  pixabay: {
    name: 'Pixabay',
    license: 'Licence de contenu Pixabay (usage commercial autorisé, attribution non obligatoire, revente en l’état interdite)',
    licenseUrl: 'https://pixabay.com/fr/service/license-summary/',
  },
};

export async function searchStock(
  query: string,
  opts: {orientation?: 'portrait' | 'landscape'; perPage?: number; page?: number},
  config: StudioConfig,
): Promise<PexelsSearch> {
  if (config.footage.provider === 'pixabay') return searchPixabay(query, {perPage: opts.perPage, page: opts.page});
  return searchVideos(query, opts);
}
