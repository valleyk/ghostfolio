import { Filter } from '@ghostfolio/common/interfaces';
import { FxLedgerMode } from '@ghostfolio/common/types';

export const RedisCacheServiceMock = {
  cache: new Map<string, string>(),
  get: (key: string): Promise<string> => {
    const value = RedisCacheServiceMock.cache.get(key) || null;

    return Promise.resolve(value);
  },
  getPortfolioSnapshotKey: ({
    fxLedgerMode,
    filters,
    userCurrency,
    userId
  }: {
    fxLedgerMode?: FxLedgerMode;
    filters?: Filter[];
    userCurrency?: string;
    userId: string;
  }): string => {
    const filtersHash = filters?.length;

    return `portfolio-snapshot-${userId}${userCurrency ? `-${userCurrency}` : ''}${fxLedgerMode ? `-${fxLedgerMode}` : ''}${filtersHash > 0 ? `-${filtersHash}` : ''}`;
  },
  reset: () => {
    RedisCacheServiceMock.cache.clear();
  },
  set: (key: string, value: string): Promise<string> => {
    RedisCacheServiceMock.cache.set(key, value);

    return Promise.resolve(value);
  }
};
