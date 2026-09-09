import { Filter } from '@ghostfolio/common/interfaces';
import { FxLedgerMode } from '@ghostfolio/common/types';
import { PerformanceCalculationType } from '@ghostfolio/common/types/performance-calculation-type.type';

export interface PortfolioSnapshotQueueJob {
  calculationType: PerformanceCalculationType;
  filters: Filter[];
  fxLedgerMode?: FxLedgerMode;
  userCurrency: string;
  userId: string;
}
