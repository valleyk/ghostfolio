# Currency Effect A+B Implementation Plan

## Purpose

This document records the implementation plan for the first practical version of the currency effect work in Ghostfolio.

The target is to land **A + B-lite** from `CURRENCY_EFFECT_FEASIBILITY.md`:

- **A**: Let users choose whether performance is shown with or without currency effect.
- **B-lite**: Introduce an independent reporting currency while keeping `baseCurrency` for compatibility.

The first version should provide immediate product value without introducing a full manual FX ledger or per-transaction FX accounting.

## Expected User-Facing Result

After this work, a user should be able to:

1. Choose a **report currency** for portfolio-level valuation and performance display.
2. Keep the existing `baseCurrency` behavior as a compatibility fallback.
3. Choose the default performance display mode:
   - with currency effect
   - without currency effect
4. See portfolio summary, analysis, holdings, and detail views use the selected display mode by default.
5. Change `reportCurrency` without reading stale portfolio snapshots generated for a previous currency.

Example:

- A user mainly trades US assets but wants to measure wealth in `CNY`.
- They set `reportCurrency = CNY`.
- They set `performanceDisplayMode = WITHOUT_CURRENCY_EFFECT` if they want the default UI to emphasize asset performance.
- They can still inspect currency effect where the UI already exposes both values.

## Explicit Non-Goals For The First Version

The first version will not implement:

1. Full multi-currency average-cost FX ledgers.
2. Per-transaction manual FX rates.
3. First-class FX conversion activities.
4. Currency attribution tables such as `USD -> CNY`, `HKD -> CNY`, `EUR -> CNY`.
5. FIFO or lot-based currency accounting.
6. Renaming every existing `valueInBaseCurrency` field.

These items belong to later phases. The initial implementation should keep the change surgical.

## Current Project Fit

The current codebase already has useful foundations:

1. Portfolio performance already exposes both:
   - `netPerformance`
   - `netPerformanceWithCurrencyEffect`
2. Several frontend views already display currency effect values.
3. `PortfolioCalculator` already receives a target `currency`.
4. `ExchangeRateDataService.getExchangeRatesByCurrency()` already accepts a `targetCurrency`.

The main gaps are:

1. `baseCurrency` is still the only user-level currency setting.
2. Portfolio snapshot cache keys are based on `userId + filters`, but not target currency.
3. User setting changes only trigger portfolio recalculation when `baseCurrency` changes.
4. Frontend summary components usually hardcode the `WithCurrencyEffect` fields.

## Proposed Settings

Add these shared settings:

```ts
export enum PerformanceDisplayMode {
  WITH_CURRENCY_EFFECT = 'WITH_CURRENCY_EFFECT',
  WITHOUT_CURRENCY_EFFECT = 'WITHOUT_CURRENCY_EFFECT'
}

export enum FxLedgerMode {
  MARKET = 'MARKET',
  MANUAL_AVERAGE_COST = 'MANUAL_AVERAGE_COST',
  MANUAL_TRANSACTIONS = 'MANUAL_TRANSACTIONS'
}
```

Add optional fields to `UserSettings`:

```ts
reportCurrency?: string;
performanceDisplayMode?: PerformanceDisplayMode;
fxLedgerMode?: FxLedgerMode;
primaryInvestmentCurrency?: string;
```

Default behavior:

```ts
reportCurrency = baseCurrency ?? DEFAULT_CURRENCY;
performanceDisplayMode = WITH_CURRENCY_EFFECT;
fxLedgerMode = MARKET;
primaryInvestmentCurrency = undefined;
```

For the first version, `fxLedgerMode` is stored and validated, but only `MARKET` has active behavior. The other values are reserved so the data model does not need to be reshaped immediately later.

## Backend Plan

### 1. Shared Types And DTOs

Files:

- `libs/common/src/lib/interfaces/user-settings.interface.ts`
- `libs/common/src/lib/dtos/update-user-setting.dto.ts`
- possibly `libs/common/src/lib/types/*`

Tasks:

1. Add `reportCurrency`, `performanceDisplayMode`, `fxLedgerMode`, and `primaryInvestmentCurrency` to `UserSettings`.
2. Add DTO validation:
   - `reportCurrency`: `@IsCurrencyCode()`
   - `primaryInvestmentCurrency`: `@IsCurrencyCode()`
   - `performanceDisplayMode`: enum validator
   - `fxLedgerMode`: enum validator
3. Export new enum types through the common type barrel if the project pattern requires it.

Verification:

- TypeScript compile should catch missing exports or invalid imports.
- DTO tests should be added if there are existing user setting validation tests nearby.

### 2. User Settings Defaults

Files:

- `apps/api/src/app/user/user.service.ts`
- `apps/api/src/app/auth/jwt.strategy.ts`

Tasks:

1. Ensure `reportCurrency` defaults to existing `baseCurrency`.
2. Ensure `performanceDisplayMode` defaults to `WITH_CURRENCY_EFFECT`.
3. Ensure `fxLedgerMode` defaults to `MARKET`.
4. Avoid migrating or deleting `baseCurrency` in this phase.

Verification:

- Existing users without the new fields still receive complete settings.
- Newly created/demo users retain current behavior unless they change settings.

### 3. Report Currency Resolution

Files:

- `apps/api/src/app/portfolio/portfolio.service.ts`
- related endpoint services that currently receive `userCurrency`

Tasks:

1. Add a helper such as `getReportCurrency(user?)`.
2. Prefer:

```ts
settings.reportCurrency ?? settings.baseCurrency ?? DEFAULT_CURRENCY;
```

3. Use this helper for portfolio valuation and performance calculations.
4. Keep activity import/export and transaction-entry defaults on `baseCurrency` unless the UI explicitly needs report currency there.

Rationale:

- `reportCurrency` is for measuring portfolio results.
- `baseCurrency` remains a compatibility/default-entry concept until the broader model is clarified.

Verification:

- Portfolio responses should calculate in `reportCurrency`.
- Existing users with only `baseCurrency` should see unchanged results.

### 4. Snapshot Cache Key And Queue Payload

Files:

- `apps/api/src/app/redis-cache/redis-cache.service.ts`
- `apps/api/src/app/redis-cache/redis-cache.service.mock.ts`
- `apps/api/src/app/portfolio/calculator/portfolio-calculator.ts`
- `apps/api/src/services/queues/portfolio-snapshot/interfaces/portfolio-snapshot-queue-job.interface.ts`
- `apps/api/src/services/queues/portfolio-snapshot/portfolio-snapshot.processor.ts`
- `apps/api/src/events/portfolio-changed.listener.ts`
- `apps/api/src/app/auth/web-auth.service.ts`

Tasks:

1. Extend `getPortfolioSnapshotKey()` to include the effective report currency.
2. Optionally include `fxLedgerMode` in the key now, even though only `MARKET` is active.
3. Pass `reportCurrency` or resolved `userCurrency` consistently through snapshot queue jobs.
4. Ensure warm-up jobs and background recomputation use the same cache key dimensions.

Suggested key dimensions:

```text
portfolio-snapshot-{userId}-{reportCurrency}-{fxLedgerMode}-{filtersHash?}
```

Verification:

- Switching `reportCurrency` must not reuse a snapshot from the previous currency.
- Portfolio changed events should still remove all snapshots for the user.

### 5. User Setting Change Events

File:

- `apps/api/src/app/user/user.controller.ts`

Tasks:

1. Emit portfolio changed events when these settings change:
   - `baseCurrency`
   - `reportCurrency`
   - `fxLedgerMode`
2. Do not emit portfolio changed events for `performanceDisplayMode` if it only changes frontend field selection.
3. Do not emit portfolio changed events for `primaryInvestmentCurrency` while it is UI-only.

Verification:

- Changing `reportCurrency` invalidates snapshots.
- Changing `performanceDisplayMode` should be lightweight.

## Frontend Plan

### 1. User Account Settings UI

Files:

- `apps/client/src/app/components/user-account-settings/user-account-settings.html`
- `apps/client/src/app/components/user-account-settings/user-account-settings.component.ts`

Tasks:

1. Add a `Report Currency` setting using the existing currency selector pattern.
2. Add a `Performance Display Mode` selector.
3. Add an `FX Ledger Mode` selector, but clearly limit active behavior to market-rate mode in this first version.
4. Optionally add `Primary Investment Currency` only if it does not create UI confusion.

Preferred first pass:

- Add `reportCurrency`.
- Add `performanceDisplayMode`.
- Add `fxLedgerMode` only if we are comfortable showing a reserved setting.
- Defer `primaryInvestmentCurrency` unless a concrete UI use exists.

Verification:

- Settings save successfully through the existing `onChangeUserSetting()` path.
- Reloading the app preserves the new values.

### 2. Shared Display Helpers

Files:

- likely under `apps/client/src/app` or `libs/common/src/lib`

Tasks:

1. Add a small helper for selecting performance fields based on `performanceDisplayMode`.
2. Avoid duplicating ternaries across every component.
3. Keep labels understandable:
   - with currency effect
   - without currency effect

Possible helper shape:

```ts
function getPerformanceDisplayValues(item, mode) {
  return mode === 'WITHOUT_CURRENCY_EFFECT'
    ? {
        netPerformance: item.netPerformance,
        grossPerformance: item.grossPerformance
      }
    : {
        netPerformance: item.netPerformanceWithCurrencyEffect,
        grossPerformance: item.grossPerformanceWithCurrencyEffect
      };
}
```

Verification:

- Existing views still render with the default mode.
- Switching the setting changes the primary displayed values.

### 3. Portfolio Summary And Analysis Views

Files:

- `apps/client/src/app/components/portfolio-summary/portfolio-summary.component.html`
- `apps/client/src/app/components/portfolio-summary/portfolio-summary.component.ts`
- `apps/client/src/app/components/portfolio-performance/portfolio-performance.component.html`
- `apps/client/src/app/pages/portfolio/analysis/analysis-page.html`
- `apps/client/src/app/pages/portfolio/analysis/analysis-page.component.ts`

Tasks:

1. Use `reportCurrency ?? baseCurrency` for displayed currency units where values are calculated in the report currency.
2. Use `performanceDisplayMode` for primary absolute and percentage performance cards.
3. Preserve explicit currency-effect breakdowns where the page already shows them.
4. Keep existing defaults equivalent to current behavior.

Verification:

- With default settings, screens should look functionally unchanged.
- With `WITHOUT_CURRENCY_EFFECT`, primary performance values should use non-currency-effect fields.

### 4. Holdings And Detail Views

Files:

- `apps/client/src/app/components/holding-detail-dialog/*`
- `apps/client/src/app/components/home-holdings/*`
- `apps/client/src/app/pages/portfolio/allocations/*`
- other components that receive `[baseCurrency]`

Tasks:

1. Pass effective display/report currency where the values are already report-currency-denominated.
2. Do not rename every `baseCurrency` input in this phase unless it is necessary for clarity.
3. Apply performance display mode to primary holding performance values.

Verification:

- Holdings still display asset currency where appropriate.
- Report-currency values use the new report currency label.

## Testing Plan

### Backend Tests

Add or update tests for:

1. User settings defaults.
2. `UpdateUserSettingDto` validation.
3. Portfolio snapshot key generation with:
   - no filters
   - filters
   - different report currencies
   - different `fxLedgerMode`
4. User setting changes triggering portfolio changed events.
5. Portfolio service using `reportCurrency` fallback order.

Suggested commands:

```bash
npm run test:api
npm run test:common
```

### Frontend Tests

Add or update tests for:

1. User account settings rendering and saving new settings.
2. Performance display helper.
3. Summary component rendering the selected performance mode.

Suggested commands:

```bash
npx nx test client
```

### Build / Type Verification

Run at least:

```bash
npx nx run api:build
npx nx run client:build
```

If time is tight, prioritize targeted tests plus TypeScript builds for touched projects.

## Suggested Implementation Order

### Step 1: Add Shared Types

Goal:

- Compile-time support for new settings.

Do:

1. Add enum/type definitions.
2. Extend `UserSettings`.
3. Extend `UpdateUserSettingDto`.

Verify:

- `npm run test:common` or targeted common tests.

### Step 2: Add Backend Defaults And Resolution

Goal:

- Existing users remain compatible.

Do:

1. Default `reportCurrency`.
2. Default `performanceDisplayMode`.
3. Default `fxLedgerMode`.
4. Add `getReportCurrency()`.

Verify:

- Existing tests around user/session/portfolio still pass.

### Step 3: Fix Snapshot Currency Dimension

Goal:

- Prevent stale cross-currency snapshots.

Do:

1. Extend cache key inputs.
2. Update calculator queue calls.
3. Update snapshot processor writes.
4. Update mocks and warm-up code.

Verify:

- Add focused tests for cache key generation.

### Step 4: Update Setting Change Invalidation

Goal:

- Recalculate only when calculation-affecting settings change.

Do:

1. Emit portfolio changed for `baseCurrency`, `reportCurrency`, and `fxLedgerMode`.
2. Keep `performanceDisplayMode` UI-only.

Verify:

- Unit test or controller/service test if existing patterns are available.

### Step 5: Add Frontend Settings

Goal:

- Users can configure the new behavior.

Do:

1. Add report currency selector.
2. Add performance display mode selector.
3. Optionally add FX ledger mode selector.

Verify:

- Existing settings save path still works.
- Values reload from user settings.

### Step 6: Apply Display Mode To Main Views

Goal:

- Primary performance values follow user preference.

Do:

1. Add display helper.
2. Update portfolio summary.
3. Update analysis page primary cards.
4. Update holdings/detail views where practical.

Verify:

- Default mode matches current UI.
- Alternate mode uses non-currency-effect fields.

## Acceptance Criteria

The work is complete when:

1. New settings exist in shared types and DTO validation.
2. Existing users get safe defaults.
3. Portfolio calculations use `reportCurrency` with fallback to `baseCurrency`.
4. Snapshot keys include report currency and FX ledger mode.
5. Changing `reportCurrency` invalidates/recomputes portfolio data.
6. Changing `performanceDisplayMode` changes primary frontend performance display without recomputing snapshots.
7. Existing default behavior remains effectively unchanged.
8. Targeted backend/common/frontend tests pass.

## Follow-Up Phase After A+B

Once A+B is stable, the next logical phase is C:

1. Add no-currency-effect date range maps at the position level.
2. Add a currency attribution response model.
3. Aggregate by asset currency first.
4. Add a simple analysis table for currency contribution.

Manual FX rates and first-class FX conversion activities should remain separate later work.
