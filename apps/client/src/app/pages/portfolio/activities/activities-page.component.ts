import { IcsService } from '@ghostfolio/client/services/ics/ics.service';
import { ImpersonationStorageService } from '@ghostfolio/client/services/impersonation-storage.service';
import { UserService } from '@ghostfolio/client/services/user/user.service';
import { DEFAULT_PAGE_SIZE } from '@ghostfolio/common/config';
import { downloadAsFile } from '@ghostfolio/common/helper';
import {
  Activity,
  AssetProfileIdentifier,
  Filter,
  PortfolioPosition,
  User
} from '@ghostfolio/common/interfaces';
import { hasPermission, permissions } from '@ghostfolio/common/permissions';
import { internalRoutes } from '@ghostfolio/common/routes/routes';
import { GfActivitiesTableComponent } from '@ghostfolio/ui/activities-table';
import { GfFabComponent } from '@ghostfolio/ui/fab';
import { translate } from '@ghostfolio/ui/i18n';
import { DataService } from '@ghostfolio/ui/services';

import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  inject,
  OnInit,
  ViewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  MatAutocompleteModule,
  MatAutocompleteTrigger
} from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { Sort, SortDirection } from '@angular/material/sort';
import { MatTableDataSource } from '@angular/material/table';
import { Router, RouterModule } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { Type as ActivityType } from '@prisma/client';
import { format, parseISO } from 'date-fns';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';
import { DeviceDetectorService } from 'ngx-device-detector';
import { of } from 'rxjs';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  map,
  switchMap
} from 'rxjs/operators';

import { GfImportActivitiesDialogComponent } from './import-activities-dialog/import-activities-dialog.component';
import { ImportActivitiesDialogParams } from './import-activities-dialog/interfaces/interfaces';

interface HoldingFilterOption extends AssetProfileIdentifier {
  assetSubClassLabel?: string;
  currency?: string;
  name?: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    GfActivitiesTableComponent,
    GfFabComponent,
    IonIcon,
    MatAutocompleteModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
    ReactiveFormsModule,
    RouterModule
  ],
  selector: 'gf-activities-page',
  styleUrls: ['./activities-page.scss'],
  templateUrl: './activities-page.html'
})
export class GfActivitiesPageComponent implements OnInit {
  @ViewChild(MatAutocompleteTrigger)
  private holdingFilterAutocompleteTrigger?: MatAutocompleteTrigger;

  public readonly activityTypesTranslationMap = new Map<ActivityType, string>();
  public readonly symbolSearchControl = new FormControl('', {
    nonNullable: true
  });
  public readonly typeFilter = new FormControl<ActivityType | null>(null);
  public readonly typeFilterOptions: ActivityType[] = [
    'BUY',
    'SELL',
    'DIVIDEND'
  ];

  protected dataSource: MatTableDataSource<Activity> | undefined;
  protected defaultHoldings: HoldingFilterOption[] = [];
  protected deviceType: string;
  protected filteredHoldings: HoldingFilterOption[] = [];
  protected hasImpersonationId: boolean;
  protected hasPermissionToCreateActivity: boolean;
  protected hasPermissionToDeleteActivity: boolean;
  protected readonly internalRoutes = internalRoutes;
  protected isLoadingHoldings = false;
  protected pageIndex = 0;
  protected readonly pageSize = DEFAULT_PAGE_SIZE;
  protected selectedHoldingFilter: HoldingFilterOption | null = null;
  protected shouldOpenHoldingFilterPanel = false;
  protected sortColumn = 'date';
  protected sortDirection: SortDirection = 'desc';
  protected totalItems: number | undefined;
  protected user: User;

  private activityTypesFilter: string[] = [];

  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly dataService = inject(DataService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly deviceDetectorService = inject(DeviceDetectorService);
  private readonly dialog = inject(MatDialog);
  private readonly icsService = inject(IcsService);
  private readonly impersonationStorageService = inject(
    ImpersonationStorageService
  );
  private readonly router = inject(Router);
  private readonly userService = inject(UserService);

  public constructor() {
    for (const type of this.typeFilterOptions) {
      this.activityTypesTranslationMap.set(type, translate(type));
    }

    addIcons({ closeOutline });
  }

  public ngOnInit() {
    this.deviceType = this.deviceDetectorService.getDeviceInfo().deviceType;

    this.symbolSearchControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        if (
          this.selectedHoldingFilter &&
          value !== this.selectedHoldingFilter.symbol
        ) {
          this.selectedHoldingFilter = null;
          this.pageIndex = 0;
          this.fetchActivities();
        }
      });

    this.symbolSearchControl.valueChanges
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((value) => {
          const query = value.trim();

          if (!query) {
            return this.defaultHoldings.length > 0
              ? of(this.defaultHoldings)
              : this.fetchHoldingFilterOptions();
          }

          if (this.selectedHoldingFilter?.symbol === query) {
            return of<HoldingFilterOption[]>([]);
          }

          return this.fetchHoldingFilterOptions(query);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((holdings) => {
        this.filteredHoldings = holdings;

        if (!this.symbolSearchControl.value.trim()) {
          this.defaultHoldings = holdings;
        }

        this.isLoadingHoldings = false;
        this.changeDetectorRef.markForCheck();

        if (
          this.shouldOpenHoldingFilterPanel &&
          this.filteredHoldings.length > 0
        ) {
          this.openHoldingFilterPanel();
        }
      });

    this.typeFilter.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.activityTypesFilter = value ? [value] : [];
        this.pageIndex = 0;
        this.fetchActivities();
      });

    this.impersonationStorageService
      .onChangeHasImpersonation()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((impersonationId) => {
        this.hasImpersonationId = !!impersonationId;

        this.changeDetectorRef.markForCheck();
      });

    this.userService.stateChanged
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) => {
        if (state?.user) {
          const previousDateRange = this.getDateRange();

          this.updateUser(state.user);

          if (previousDateRange !== this.getDateRange()) {
            this.pageIndex = 0;
          }

          this.fetchActivities();

          this.changeDetectorRef.markForCheck();
        }
      });
  }

  protected onChangePage(page: PageEvent) {
    this.pageIndex = page.pageIndex;

    this.fetchActivities();
  }

  protected onClickActivity({ dataSource, symbol }: AssetProfileIdentifier) {
    this.router.navigate([], {
      queryParams: {
        dataSource,
        symbol,
        holdingDetailDialog: true
      }
    });
  }

  protected onDeleteActivities() {
    this.dataService
      .deleteActivities({
        activityTypes: this.activityTypesFilter.length
          ? this.activityTypesFilter
          : undefined,
        filters: this.getActivityFilters(),
        range: this.getDateRange()
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.userService
          .get(true)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe();

        this.fetchActivities();

        this.changeDetectorRef.markForCheck();
      });
  }

  protected onDeleteActivity(aId: string) {
    this.dataService
      .deleteActivity(aId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.userService
          .get(true)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe();

        this.fetchActivities();

        this.changeDetectorRef.markForCheck();
      });
  }

  protected onExport(activityIds?: string[]) {
    let fetchExportParams: any = { activityIds };

    if (!activityIds) {
      fetchExportParams = {
        activityTypes: this.activityTypesFilter.length
          ? this.activityTypesFilter
          : undefined,
        filters: this.getActivityFilters(),
        range: this.getDateRange()
      };
    }

    this.dataService
      .fetchExport(fetchExportParams)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((data) => {
        downloadAsFile({
          content: data,
          fileName: `ghostfolio-export-${format(
            parseISO(data.meta.date),
            'yyyyMMddHHmm'
          )}.json`,
          format: 'json'
        });
      });
  }

  protected onExportDrafts(activityIds?: string[]) {
    this.dataService
      .fetchExport({ activityIds, withActivityIds: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((data) => {
        downloadAsFile({
          content: this.icsService.transformActivitiesToIcsContent(
            data.activities
          ),
          contentType: 'text/calendar',
          fileName: `ghostfolio-draft${
            data.activities.length > 1 ? 's' : ''
          }-${format(parseISO(data.meta.date), 'yyyyMMddHHmmss')}.ics`,
          format: 'string'
        });
      });
  }

  protected onImport() {
    const dialogRef = this.dialog.open<
      GfImportActivitiesDialogComponent,
      ImportActivitiesDialogParams
    >(GfImportActivitiesDialogComponent, {
      data: {
        deviceType: this.deviceType,
        user: this.user
      },
      height: this.deviceType === 'mobile' ? '98vh' : undefined,
      width: this.deviceType === 'mobile' ? '100vw' : '50rem'
    });

    dialogRef
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.userService
          .get(true)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe();

        this.fetchActivities();

        this.changeDetectorRef.markForCheck();
      });
  }

  protected onImportDividends() {
    const dialogRef = this.dialog.open<
      GfImportActivitiesDialogComponent,
      ImportActivitiesDialogParams
    >(GfImportActivitiesDialogComponent, {
      data: {
        activityTypes: ['DIVIDEND'],
        deviceType: this.deviceType,
        user: this.user
      },
      height: this.deviceType === 'mobile' ? '98vh' : undefined,
      width: this.deviceType === 'mobile' ? '100vw' : '50rem'
    });

    dialogRef
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.userService
          .get(true)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe();

        this.fetchActivities();

        this.changeDetectorRef.markForCheck();
      });
  }

  protected onSortChanged({ active, direction }: Sort) {
    this.pageIndex = 0;
    this.sortColumn = active;
    this.sortDirection = direction;

    this.fetchActivities();
  }

  protected onTypesFilterChanged(aTypes: string[]) {
    this.activityTypesFilter = aTypes;
    this.pageIndex = 0;

    this.fetchActivities();
  }

  protected onClearSymbolFilter() {
    this.selectedHoldingFilter = null;
    this.filteredHoldings = [];
    this.symbolSearchControl.setValue('');
    this.pageIndex = 0;
    this.fetchActivities();
  }

  protected onClearTypeFilter() {
    this.typeFilter.setValue(null);
  }

  protected onOpenHoldingFilter() {
    this.shouldOpenHoldingFilterPanel = true;

    if (this.filteredHoldings.length > 0) {
      this.openHoldingFilterPanel();
      return;
    }

    if (this.isLoadingHoldings) {
      return;
    }

    if (!this.symbolSearchControl.value.trim()) {
      if (this.defaultHoldings.length > 0) {
        this.filteredHoldings = this.defaultHoldings;
        this.changeDetectorRef.markForCheck();
        this.openHoldingFilterPanel();
      } else {
        this.isLoadingHoldings = true;

        this.fetchHoldingFilterOptions()
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((holdings) => {
            this.defaultHoldings = holdings;
            this.filteredHoldings = holdings;
            this.isLoadingHoldings = false;
            this.changeDetectorRef.markForCheck();

            if (this.shouldOpenHoldingFilterPanel && holdings.length > 0) {
              this.openHoldingFilterPanel();
            }
          });
      }
    } else {
      this.openHoldingFilterPanel();
    }
  }

  protected onSelectHoldingFilter(holding: HoldingFilterOption) {
    this.selectedHoldingFilter = holding;
    this.filteredHoldings = [];
    this.shouldOpenHoldingFilterPanel = false;
    this.symbolSearchControl.setValue(holding.symbol, { emitEvent: false });
    this.holdingFilterAutocompleteTrigger?.closePanel();
    this.pageIndex = 0;
    this.fetchActivities();
  }

  private fetchActivities() {
    // Reset dataSource and totalItems to show loading state
    this.dataSource = undefined;
    this.totalItems = undefined;

    this.dataService
      .fetchActivities({
        activityTypes: this.activityTypesFilter.length
          ? this.activityTypesFilter
          : undefined,
        filters: this.getActivityFilters(),
        range: this.getDateRange(),
        skip: this.pageIndex * this.pageSize,
        sortColumn: this.sortColumn,
        sortDirection: this.sortDirection,
        take: this.pageSize
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ activities, count }) => {
        this.dataSource = new MatTableDataSource(activities);
        this.totalItems = count;

        if (
          this.hasPermissionToCreateActivity &&
          this.user?.activitiesCount === 0
        ) {
          void this.router.navigate(
            internalRoutes.portfolio.subRoutes.activities.subRoutes.create
              .routerLink
          );
        }

        this.changeDetectorRef.markForCheck();
      });
  }

  private getDateRange() {
    const dateRange = this.user?.settings?.dateRange;

    // Omit the date ranges which do not apply to activities: '1d' spans today
    // only, while 'max' would exclude drafts dated in the future
    if (!dateRange || ['1d', 'max'].includes(dateRange)) {
      return undefined;
    }

    return dateRange;
  }

  private getActivityFilters(): Filter[] {
    const filters = this.userService.getFilters().filter(({ type }) => {
      return (
        type !== 'SYMBOL' &&
        (!this.selectedHoldingFilter?.dataSource || type !== 'DATA_SOURCE')
      );
    });

    if (
      this.selectedHoldingFilter?.dataSource &&
      this.selectedHoldingFilter.symbol
    ) {
      filters.push({
        id: this.selectedHoldingFilter.dataSource,
        type: 'DATA_SOURCE'
      });
      filters.push({
        id: this.selectedHoldingFilter.symbol,
        type: 'SYMBOL'
      });
    }

    return filters;
  }

  private fetchHoldingFilterOptions(query?: string) {
    this.isLoadingHoldings = true;

    const filters: Filter[] = this.userService
      .getFilters()
      .filter(({ type }) => {
        return type !== 'SYMBOL' && type !== 'DATA_SOURCE';
      });

    if (query) {
      filters.push({ id: query, type: 'SEARCH_QUERY' });
    }

    return this.dataService.fetchPortfolioHoldings({ filters }).pipe(
      map(({ holdings }) => {
        return holdings.map((holding) => {
          return this.mapHoldingToFilterOption(holding);
        });
      }),
      catchError(() => of<HoldingFilterOption[]>([]))
    );
  }

  private mapHoldingToFilterOption(
    holding: PortfolioPosition
  ): HoldingFilterOption {
    return {
      assetSubClassLabel: holding.assetProfile.assetSubClassLabel,
      currency: holding.assetProfile.currency,
      dataSource: holding.assetProfile.dataSource,
      name: holding.assetProfile.name,
      symbol: holding.assetProfile.symbol
    };
  }

  private openHoldingFilterPanel() {
    setTimeout(() => {
      this.holdingFilterAutocompleteTrigger?.openPanel();
    });
  }

  private updateUser(aUser: User) {
    this.user = aUser;

    this.hasPermissionToCreateActivity =
      !this.hasImpersonationId &&
      hasPermission(this.user.permissions, permissions.createActivity) &&
      !this.user.settings?.isRestrictedView;

    this.hasPermissionToDeleteActivity =
      !this.hasImpersonationId &&
      hasPermission(this.user.permissions, permissions.deleteActivity);
  }
}
