import { IcsService } from '@ghostfolio/client/services/ics/ics.service';
import { ImpersonationStorageService } from '@ghostfolio/client/services/impersonation-storage.service';
import { UserService } from '@ghostfolio/client/services/user/user.service';
import { DEFAULT_PAGE_SIZE } from '@ghostfolio/common/config';
import { CreateOrderDto, UpdateOrderDto } from '@ghostfolio/common/dtos';
import { downloadAsFile } from '@ghostfolio/common/helper';
import {
  Activity,
  AssetProfileIdentifier,
  Filter,
  PortfolioPosition,
  User
} from '@ghostfolio/common/interfaces';
import { hasPermission, permissions } from '@ghostfolio/common/permissions';
import { DateRange } from '@ghostfolio/common/types';
import { GfActivitiesTableComponent } from '@ghostfolio/ui/activities-table';
import { translate } from '@ghostfolio/ui/i18n';
import { DataService } from '@ghostfolio/ui/services';

import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
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
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { Type as ActivityType } from '@prisma/client';
import { format, parseISO } from 'date-fns';
import { addIcons } from 'ionicons';
import { addOutline, closeOutline } from 'ionicons/icons';
import { DeviceDetectorService } from 'ngx-device-detector';
import { of } from 'rxjs';
import { Subscription } from 'rxjs';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  map,
  switchMap
} from 'rxjs/operators';

import { GfCreateOrUpdateActivityDialogComponent } from './create-or-update-activity-dialog/create-or-update-activity-dialog.component';
import { CreateOrUpdateActivityDialogParams } from './create-or-update-activity-dialog/interfaces/interfaces';
import { GfImportActivitiesDialogComponent } from './import-activities-dialog/import-activities-dialog.component';
import { ImportActivitiesDialogParams } from './import-activities-dialog/interfaces/interfaces';

interface HoldingFilterOption extends AssetProfileIdentifier {
  assetSubClassLabel?: string;
  currency: string;
  name: string;
}

@Component({
  host: { class: 'has-fab' },
  imports: [
    GfActivitiesTableComponent,
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
  public holdingFilterAutocompleteTrigger?: MatAutocompleteTrigger;

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

  public dataSource: MatTableDataSource<Activity>;
  public defaultHoldings: HoldingFilterOption[] = [];
  public deviceType: string;
  public filteredHoldings: HoldingFilterOption[] = [];
  public hasImpersonationId: boolean;
  public hasPermissionToCreateActivity: boolean;
  public hasPermissionToDeleteActivity: boolean;
  public isLoadingHoldings = false;
  public pageIndex = 0;
  public pageSize = DEFAULT_PAGE_SIZE;
  public routeQueryParams: Subscription;
  public selectedHoldingFilter: HoldingFilterOption | null = null;
  public shouldOpenHoldingFilterPanel = false;
  public sortColumn = 'date';
  public sortDirection: SortDirection = 'desc';
  public totalItems: number | undefined;
  public typeFilterValue: ActivityType | null = null;
  public user: User;

  public constructor(
    private changeDetectorRef: ChangeDetectorRef,
    private dataService: DataService,
    private destroyRef: DestroyRef,
    private deviceDetectorService: DeviceDetectorService,
    private dialog: MatDialog,
    private icsService: IcsService,
    private impersonationStorageService: ImpersonationStorageService,
    private route: ActivatedRoute,
    private router: Router,
    private userService: UserService
  ) {
    this.routeQueryParams = route.queryParams
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        if (params['createDialog']) {
          if (params['activityId']) {
            this.dataService
              .fetchActivity(params['activityId'])
              .pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe((activity) => {
                this.openCreateActivityDialog(activity);
              });
          } else {
            this.openCreateActivityDialog();
          }
        } else if (params['editDialog']) {
          if (params['activityId']) {
            this.dataService
              .fetchActivity(params['activityId'])
              .pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe((activity) => {
                this.openUpdateActivityDialog(activity);
              });
          } else {
            this.router.navigate(['.'], { relativeTo: this.route });
          }
        }
      });

    for (const type of this.typeFilterOptions) {
      this.activityTypesTranslationMap.set(type, translate(type));
    }

    addIcons({ addOutline, closeOutline });
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
            if (this.defaultHoldings.length > 0) {
              return of(this.defaultHoldings);
            }

            return this.fetchHoldingFilterOptions();
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
        this.typeFilterValue = value;
        this.pageIndex = 0;

        this.fetchActivities();
      });

    this.impersonationStorageService
      .onChangeHasImpersonation()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((impersonationId) => {
        this.hasImpersonationId = !!impersonationId;
      });

    this.userService.stateChanged
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) => {
        if (state?.user) {
          this.updateUser(state.user);

          this.fetchActivities();

          this.changeDetectorRef.markForCheck();
        }
      });
  }

  public fetchActivities() {
    // Reset dataSource and totalItems to show loading state
    this.dataSource = undefined;
    this.totalItems = undefined;

    const dateRange = this.user?.settings?.dateRange;
    const range = this.isCalendarYear(dateRange) ? dateRange : undefined;

    this.dataService
      .fetchActivities({
        range,
        activityTypes: this.typeFilterValue
          ? [this.typeFilterValue]
          : undefined,
        filters: this.getActivityFilters(),
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
          this.router.navigate([], { queryParams: { createDialog: true } });
        }

        this.changeDetectorRef.markForCheck();
      });
  }

  public onChangePage(page: PageEvent) {
    this.pageIndex = page.pageIndex;

    this.fetchActivities();
  }

  public onClickActivity({ dataSource, symbol }: AssetProfileIdentifier) {
    this.router.navigate([], {
      queryParams: {
        dataSource,
        symbol,
        holdingDetailDialog: true
      }
    });
  }

  public onCloneActivity(aActivity: Activity) {
    this.openCreateActivityDialog(aActivity);
  }

  public onDeleteActivities() {
    this.dataService
      .deleteActivities({
        filters: this.getActivityFilters()
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

  public onDeleteActivity(aId: string) {
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

  public onExport(activityIds?: string[]) {
    let fetchExportParams: any = { activityIds };

    if (!activityIds) {
      fetchExportParams = {
        activityTypes: this.typeFilterValue
          ? [this.typeFilterValue]
          : undefined,
        filters: this.getActivityFilters()
      };
    }

    this.dataService
      .fetchExport(fetchExportParams)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((data) => {
        for (const activity of data.activities) {
          delete activity.id;
        }

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

  public onExportDrafts(activityIds?: string[]) {
    this.dataService
      .fetchExport({ activityIds })
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

  public onImport() {
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

  public onImportDividends() {
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

  public onSortChanged({ active, direction }: Sort) {
    this.pageIndex = 0;
    this.sortColumn = active;
    this.sortDirection = direction;

    this.fetchActivities();
  }

  public onClearSymbolFilter() {
    this.selectedHoldingFilter = null;
    this.filteredHoldings = [];
    this.symbolSearchControl.setValue('');
    this.pageIndex = 0;

    this.fetchActivities();
  }

  public onClearTypeFilter() {
    this.typeFilter.setValue(null);
  }

  public onOpenHoldingFilter() {
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

  public onSelectHoldingFilter(holding: HoldingFilterOption) {
    this.selectedHoldingFilter = holding;
    this.filteredHoldings = [];
    this.shouldOpenHoldingFilterPanel = false;
    this.symbolSearchControl.setValue(holding.symbol, { emitEvent: false });
    this.holdingFilterAutocompleteTrigger?.closePanel();
    this.pageIndex = 0;

    this.fetchActivities();
  }

  public onUpdateActivity(aActivity: Activity) {
    this.router.navigate([], {
      queryParams: { activityId: aActivity.id, editDialog: true }
    });
  }

  public openUpdateActivityDialog(aActivity: Activity) {
    const dialogRef = this.dialog.open<
      GfCreateOrUpdateActivityDialogComponent,
      CreateOrUpdateActivityDialogParams
    >(GfCreateOrUpdateActivityDialogComponent, {
      data: {
        activity: aActivity,
        accounts: this.user?.accounts,
        user: this.user
      },
      height: this.deviceType === 'mobile' ? '98vh' : '80vh',
      width: this.deviceType === 'mobile' ? '100vw' : '50rem'
    });

    dialogRef
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((activity: UpdateOrderDto) => {
        if (activity) {
          this.dataService
            .putActivity(activity)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: () => {
                this.fetchActivities();

                this.changeDetectorRef.markForCheck();
              }
            });
        }

        this.router.navigate(['.'], { relativeTo: this.route });
      });
  }

  private isCalendarYear(dateRange: DateRange) {
    if (!dateRange) {
      return false;
    }

    return /^\d{4}$/.test(dateRange);
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

    const filters: Filter[] = [
      ...this.userService.getFilters().filter(({ type }) => {
        return type !== 'SYMBOL' && type !== 'DATA_SOURCE';
      })
    ];

    if (query) {
      filters.push({
        id: query,
        type: 'SEARCH_QUERY'
      });
    }

    return this.dataService.fetchPortfolioHoldings({ filters }).pipe(
      map(({ holdings }) => {
        return holdings.map((holding) => {
          return this.mapHoldingToFilterOption(holding);
        });
      }),
      catchError(() => {
        return of<HoldingFilterOption[]>([]);
      })
    );
  }

  private mapHoldingToFilterOption(
    holding: PortfolioPosition
  ): HoldingFilterOption {
    return {
      assetSubClassLabel:
        holding.assetProfile.assetSubClassLabel ?? holding.assetSubClassLabel,
      currency: holding.assetProfile.currency ?? holding.currency,
      dataSource: holding.assetProfile.dataSource ?? holding.dataSource,
      name: holding.assetProfile.name ?? holding.name,
      symbol: holding.assetProfile.symbol ?? holding.symbol
    };
  }

  private openHoldingFilterPanel() {
    setTimeout(() => {
      this.holdingFilterAutocompleteTrigger?.openPanel();
    });
  }

  private openCreateActivityDialog(aActivity?: Activity) {
    this.userService
      .get()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((user) => {
        this.updateUser(user);

        const dialogRef = this.dialog.open<
          GfCreateOrUpdateActivityDialogComponent,
          CreateOrUpdateActivityDialogParams
        >(GfCreateOrUpdateActivityDialogComponent, {
          data: {
            accounts: this.user?.accounts,
            activity: {
              ...aActivity,
              accountId: aActivity?.accountId,
              date: new Date(),
              id: null,
              fee: 0,
              type: aActivity?.type ?? 'BUY',
              unitPrice: null
            },
            user: this.user
          },
          height: this.deviceType === 'mobile' ? '98vh' : '80vh',
          width: this.deviceType === 'mobile' ? '100vw' : '50rem'
        });

        dialogRef
          .afterClosed()
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((transaction: CreateOrderDto | null) => {
            if (transaction) {
              this.dataService.postActivity(transaction).subscribe({
                next: () => {
                  this.userService
                    .get(true)
                    .pipe(takeUntilDestroyed(this.destroyRef))
                    .subscribe();

                  this.fetchActivities();

                  this.changeDetectorRef.markForCheck();
                }
              });
            }

            this.router.navigate(['.'], { relativeTo: this.route });
          });
      });
  }

  private updateUser(aUser: User) {
    this.user = aUser;

    this.hasPermissionToCreateActivity =
      !this.hasImpersonationId &&
      hasPermission(this.user.permissions, permissions.createActivity);
    this.hasPermissionToDeleteActivity =
      !this.hasImpersonationId &&
      hasPermission(this.user.permissions, permissions.deleteActivity);
  }
}
