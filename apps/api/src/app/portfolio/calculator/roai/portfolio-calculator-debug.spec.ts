import {
  activityDummyData,
  assetProfileDummyData,
  loadExportFile,
  userDummyData
} from '@ghostfolio/api/app/portfolio/calculator/portfolio-calculator-test-utils';
import { PortfolioCalculatorFactory } from '@ghostfolio/api/app/portfolio/calculator/portfolio-calculator.factory';
import { CurrentRateService } from '@ghostfolio/api/app/portfolio/current-rate.service';
import { RedisCacheService } from '@ghostfolio/api/app/redis-cache/redis-cache.service';
import { RedisCacheServiceMock } from '@ghostfolio/api/app/redis-cache/redis-cache.service.mock';
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { ExchangeRateDataService } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.service';
import { PortfolioSnapshotService } from '@ghostfolio/api/services/queues/portfolio-snapshot/portfolio-snapshot.service';
import { PortfolioSnapshotServiceMock } from '@ghostfolio/api/services/queues/portfolio-snapshot/portfolio-snapshot.service.mock';
import { DATE_FORMAT, parseDate } from '@ghostfolio/common/helper';
import { Activity, ExportResponse } from '@ghostfolio/common/interfaces';
import { PerformanceCalculationType } from '@ghostfolio/common/types/performance-calculation-type.type';

import { Big } from 'big.js';
import { eachDayOfInterval, format } from 'date-fns';
import { join } from 'node:path';

const originalAccessTokenSalt = process.env.ACCESS_TOKEN_SALT;
const originalJwtSecretKey = process.env.JWT_SECRET_KEY;

// Change only these values to debug another holding from the export.
// const DEBUG_HOLDING = {
//   asOfDate: '2026-09-23',
//   dataSource: 'YAHOO',
//   marketPrice: 32.94,
//   reportCurrency: 'USD',
//   symbol: 'SCHD'
// };

const DEBUG_HOLDING = {
  asOfDate: '2026-09-17',
  dataSource: 'YAHOO',
  marketPrice: 25.91,
  reportCurrency: 'USD',
  symbol: 'IDVY.AS'
};

// Key rates are enough; the mock fills the dates in between with the latest
// configured rate so every transaction date gets a deterministic EURUSD rate.
const MOCK_EXCHANGE_RATES: Record<string, Record<string, number>> = {
  EURUSD: {
    '2025-10-07': 1.12,
    '2026-09-17': 1.18
  }
};

const exportResponse = loadExportFile(
  join(
    __dirname,
    '../../../../../../../.testdata/ghostfolio-export-202610012011.json'
  )
);
const activities = createActivities(exportResponse);

const currentRateServiceMock = {
  getValues: jest.fn(async ({ dateQuery }) => {
    return {
      dataProviderInfos: [],
      errors: [],
      // The export has activities but no historical market prices. Use a
      // fixed price so the test can replay the ROAI bookkeeping offline.
      values: eachDayOfInterval({
        end: dateQuery.lt,
        start: dateQuery.gte
      }).map((date) => ({
        dataSource: 'YAHOO',
        date,
        marketPrice: DEBUG_HOLDING.marketPrice,
        symbol: DEBUG_HOLDING.symbol
      }))
    };
  })
};

const exchangeRateDataServiceMock = {
  getExchangeRatesByCurrency: jest.fn(
    async ({ currencies, endDate, startDate, targetCurrency }) => {
      return Object.fromEntries(
        currencies.map((currency: string) => {
          const currencyPair = `${currency}${targetCurrency}`;
          const configuredRates = MOCK_EXCHANGE_RATES[currencyPair] ?? {};
          let latestRate = 1;
          const ratesByDate: Record<string, number> = {};

          for (const date of eachDayOfInterval({
            end: endDate,
            start: startDate
          })) {
            const dateString = format(date, DATE_FORMAT);
            if (configuredRates[dateString] !== undefined) {
              latestRate = configuredRates[dateString];
            }
            ratesByDate[dateString] = latestRate;
          }

          return [currencyPair, ratesByDate];
        })
      );
    }
  )
};

jest.mock('@ghostfolio/api/app/portfolio/current-rate.service', () => {
  return {
    CurrentRateService: jest.fn().mockImplementation(() => {
      return currentRateServiceMock;
    })
  };
});

jest.mock(
  '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.service',
  () => {
    return {
      ExchangeRateDataService: jest.fn().mockImplementation(() => {
        return exchangeRateDataServiceMock;
      })
    };
  }
);

jest.mock(
  '@ghostfolio/api/services/queues/portfolio-snapshot/portfolio-snapshot.service',
  () => {
    return {
      PortfolioSnapshotService: jest.fn().mockImplementation(() => {
        return PortfolioSnapshotServiceMock;
      })
    };
  }
);

jest.mock('@ghostfolio/api/app/redis-cache/redis-cache.service', () => {
  return {
    RedisCacheService: jest.fn().mockImplementation(() => {
      return RedisCacheServiceMock;
    })
  };
});

describe('RoaiPortfolioCalculator debug', () => {
  beforeAll(() => {
    process.env.ACCESS_TOKEN_SALT ??= 'roai-debug-access-token-salt';
    process.env.JWT_SECRET_KEY ??= 'roai-debug-jwt-secret-key';
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterAll(() => {
    restoreEnvironmentVariable('ACCESS_TOKEN_SALT', originalAccessTokenSalt);
    restoreEnvironmentVariable('JWT_SECRET_KEY', originalJwtSecretKey);
  });

  it('replays the configured holding from the local Ghostfolio export', async () => {
    jest
      .useFakeTimers()
      .setSystemTime(parseDate(DEBUG_HOLDING.asOfDate).getTime());
    PortfolioSnapshotServiceMock.reset();
    RedisCacheServiceMock.reset();

    const calculatorFactory = new PortfolioCalculatorFactory(
      new ConfigurationService(),
      new CurrentRateService(null, null, null, null),
      new ExchangeRateDataService(null, null, null, null),
      new PortfolioSnapshotService(null, null),
      new RedisCacheService(null, null)
    );

    const calculator = calculatorFactory.createCalculator({
      activities,
      calculationType: PerformanceCalculationType.ROAI,
      currency: DEBUG_HOLDING.reportCurrency,
      userId: userDummyData.id
    });

    // Set a breakpoint in RoaiPortfolioCalculator.getSymbolMetrics() before
    // this line. The loop will replay the configured export activities.
    const snapshot = await calculator.computeSnapshot();
    const [position] = snapshot.positions;

    expect(position.activitiesCount).toBe(activities.length);
    expect(position.quantity.gt(0)).toBe(true);
    expect(position.netPerformance).toBeInstanceOf(Big);
    expect(position.netPerformanceWithCurrencyEffectMap.max).toBeInstanceOf(
      Big
    );
  });
});

function createActivities(exportData: ExportResponse): Activity[] {
  return exportData.activities
    .filter(({ dataSource, symbol }) => {
      return (
        dataSource === DEBUG_HOLDING.dataSource &&
        symbol === DEBUG_HOLDING.symbol
      );
    })
    .map((activity) => {
      return {
        ...activityDummyData,
        assetProfile: {
          ...assetProfileDummyData,
          currency: activity.currency,
          dataSource: activity.dataSource,
          name: activity.symbol,
          symbol: activity.symbol
        },
        date: parseDate(activity.date),
        feeInAssetProfileCurrency: activity.fee,
        feeInBaseCurrency: activity.fee,
        quantity: activity.quantity,
        type: activity.type,
        unitPriceInAssetProfileCurrency: activity.unitPrice
      };
    });
}

function restoreEnvironmentVariable(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
