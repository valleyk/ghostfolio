# Ghostfolio 汇率影响功能可行性分析

## 目标

基于当前 `4.0.0` 分支，评估将 Ghostfolio 扩展为以下能力的可行性，并给出推荐方案：

1. 用户可以选择收益展示是否考虑汇率影响。
2. 明确区分四层货币概念：
   - `交易货币偏好`
     - 指用户平时主要观察和横量投资时偏好的参考货币
     - 对大量投资美股的用户，这通常会是 `USD`
     - 这层更适合做成 UI 偏好，而不是底层会计核心
   - `衡量货币`
     - 指用户最终查看总收益、净值和购买力时采用的目标货币
     - 例如长期投资美股，但长期生活在中国，则可能是 `CNY`
   - `多币种换汇成本账本`
     - 指对 `USD`、`HKD`、`EUR` 等不同货币分别维护取得成本、余额和换汇损益
     - 这是比“单一交易货币”更贴近真实资金路径的核心模型
   - `分币种收益`
     - 指按实际持仓币种分别核算收益，例如 `USD`、`HKD`、`EUR`
3. 用户可以指定一个“衡量货币”，将收益统一折算到该货币；如果用户录入了手工汇率，则优先使用手工汇率，否则按市场汇率计算。
4. 当选择“考虑汇率影响”时，系统可以按币种拆分汇兑损益，例如：
   - `USD -> CNY`
   - `HKD -> CNY`
   - `EUR -> CNY`
5. 如果单独录入了换汇交易，希望它也能进入分币种收益计算。
6. 可选增强目标：允许用户像 Excel 一样，保存每笔交易对应的手工汇率。

---

## 结论摘要

这个功能是可行的，但建议分阶段做。

从当前代码结构来看，Ghostfolio 已经具备两个关键基础：

1. 后端已经同时计算了“考虑汇率影响”和“剔除汇率影响”的两套收益值。
2. 汇率服务已经支持把任意资产货币换算到任意目标货币，而不是只能换到单一固定货币。

因此：

- 如果只是要增加“用户可切换是否考虑汇率影响”，这是中等规模改动，可直接落地。
- 如果要增加“衡量货币”和“多币种换汇成本账本”，这是可行的，但需要扩展用户设置、缓存维度和收益接口语义。
- 如果还要做到“分币种收益”，同样可行，但需要扩展后端返回模型和聚合逻辑。
- 如果还要支持“每笔交易手工汇率”和“换汇交易计入分币种收益”，复杂度会明显上升，因为当前系统并不会持久化用户自己的成交汇率，也没有一等公民的外汇兑换交易模型。

我建议先落地一个 **Phase 1 / Phase 2 版本**：

- `Phase 1`：支持衡量货币、多币种 FX ledger 与是否计入汇率影响的用户设置
- `Phase 2`：支持按币种汇兑归因与分币种收益
- `Phase 3`：如确有必要，再支持每笔交易手工汇率和换汇交易模型

---

## 当前代码结构

项目是典型的 monorepo，与你这次需求最相关的模块主要是这几块：

- `apps/api`
  - 后端业务逻辑、收益计算、汇率换算、用户设置、缓存、任务队列
- `apps/client`
  - 用户设置页面、持仓详情、分析页、组合概览等 UI
- `libs/common`
  - 前后端共享接口、DTO、类型定义、模型

和本需求直接相关的关键文件：

- 用户设置
  - `libs/common/src/lib/interfaces/user-settings.interface.ts`
  - `libs/common/src/lib/dtos/update-user-setting.dto.ts`
  - `apps/api/src/app/user/user.service.ts`
  - `apps/api/src/app/user/user.controller.ts`
  - `apps/client/src/app/components/user-account-settings/*`

- 活动与交易币种
  - `libs/common/src/lib/dtos/create-order.dto.ts`
  - `libs/common/src/lib/dtos/update-order.dto.ts`
  - `apps/api/src/app/activities/activities.controller.ts`
  - `apps/api/src/app/activities/activities.service.ts`
  - `apps/client/src/app/pages/portfolio/activities/create-or-update-activity-dialog/*`

- 汇率与收益计算
  - `apps/api/src/services/exchange-rate-data/exchange-rate-data.service.ts`
  - `apps/api/src/app/portfolio/calculator/portfolio-calculator.ts`
  - `apps/api/src/app/portfolio/calculator/roai/portfolio-calculator.ts`
  - `apps/api/src/app/portfolio/portfolio.service.ts`
  - `apps/api/src/app/portfolio/portfolio.controller.ts`

- 缓存 / 快照
  - `apps/api/src/app/redis-cache/redis-cache.service.ts`
  - `apps/api/src/services/queues/portfolio-snapshot/portfolio-snapshot.processor.ts`

---

## 术语定义

为了避免后续设计混乱，建议把本功能相关术语固定为下面五层：

### 1. 订单交易币种

- 指单笔活动真实录入时使用的币种
- 当前系统里已经存在，对应 `Order.currency`
- 这层是“订单级”的，不是“用户级”的偏好

### 2. 交易货币偏好

- 指用户主要投资、主要横量资产表现时采用的参考货币
- 对很多投资美股的用户，这通常会是 `USD`
- 这是一个“用户级偏好”，不应和单笔订单的 `Order.currency` 混淆
- 更适合作为 UI 默认观察货币，而不是底层成本计算的唯一锚点

### 3. 衡量货币

- 指用户最终查看总收益、净值、生活购买力时采用的目标货币
- 例如用户长期投资美股，但长期生活在中国，则可能是 `CNY`
- 这层决定收益最终展示成什么货币

### 4. 多币种换汇成本账本

- 指对每一种非 `reportCurrency` 的货币分别维护：
  - 当前余额
  - 取得成本
  - 综合换汇成本或 lot 成本
  - 已实现 / 未实现汇兑损益
- 例如：
  - `USD` 一套账
  - `HKD` 一套账
  - `EUR` 一套账
- 这是比“单一交易货币”更贴近真实投资者资金路径的核心模型

### 5. 分币种收益

- 不是一个单独的货币字段，而是一种收益视图
- 表示把组合收益按持仓币种，必要时再加上换汇币种，分别拆开计算

下面文档里如果出现“报告货币”，统一等同于 `衡量货币`。

---

## 当前实现到底怎么处理汇率

### 1. 系统里目前只有一个核心用户级货币概念：`baseCurrency`

当前用户设置里只有 `baseCurrency`，它承担了多个角色：

- 近似扮演了“衡量货币”
- 大部分页面的展示货币
- 组合收益计算的目标货币
- 账户/现金/分红/费用等汇总的统一货币

也就是说，当前系统默认假设：

> “用户平时看报表的货币” = “组合收益核算的目标货币”

这和你的使用场景不完全一致。你要的是：

> “衡量货币” 与 “多币种换汇成本账本” 可以独立存在，并且还要支持“分币种收益视图”

### 2. 当前系统其实已经同时算了两种收益

Ghostfolio 现在不是只算一套收益，而是已经并行维护两套值：

- `netPerformance`
- `netPerformanceWithCurrencyEffect`

以及对应的百分比、毛收益、持仓详情字段。

从 `apps/api/src/app/portfolio/calculator/roai/portfolio-calculator.ts` 的实现可以看出：

- **不考虑汇率影响** 的计算，会把历史买入成本和当前市值都按“当前汇率”折算到目标货币。
- **考虑汇率影响** 的计算，会把买入成本按“交易当日汇率”折算，而当前市值按“当前汇率”折算。

这意味着当前实现已经隐含了下面这个公式：

```text
汇率影响 = 考虑汇率影响后的收益 - 不考虑汇率影响后的收益
```

这点非常重要，因为它说明：

- “是否考虑汇率影响” 本身不是从零开始做
- “按币种拆分汇率损益” 也有现成基础

### 3. 交易本身已经区分了“资产货币”和“录入价格货币”

在创建/编辑活动时，前端表单里实际有两个货币概念：

- `currency`
- `currencyOfUnitPrice`（最终通过 `customCurrency` 写入后端）

后端落库后，`Order.currency` 可以和 `SymbolProfile.currency` 不同。

这代表系统已经支持类似下面的录入方式：

- 资产是 `USD`
- 你录入价格时可以使用另一个货币

但要注意：

> 当前系统不会把“你自己手工确认的成交汇率”单独保存下来。

它会在读取活动时，通过 `ExchangeRateDataService.toCurrencyAtDate()`，按交易日市场汇率把 `Order.currency` 动态换算为资产货币和用户基准货币。

所以这和你 Excel 里“自己记一笔实际汇率”还不是同一件事。

### 4. 当前系统没有“多币种换汇成本账本”这个核心概念

系统当前具备的是：

- 单笔订单的交易币种
- 资产自身的计价币种
- 用户的 `baseCurrency`

但缺少你这次特别强调的这一层：

> 用户是按什么成本取得每一种外币，并在后续证券交易中消耗这些外币库存

这层概念会影响：

- 用户如何理解“去掉汇率影响后的收益”
- 用户是否希望把美股仓位先统一看成 `USD` 账本，再映射到 `CNY`
- 后续“分币种收益”到底按什么层次做聚合
- 系统会不会错误地把每笔证券买入都当成“当天现换了一次汇”

---

## 当前实现已经满足了哪些部分

### 已经具备的能力

1. 已经能同时得到“有汇率影响”和“无汇率影响”的收益值。
2. 已经能按日期获取历史汇率，并换算到任意目标货币。
3. 已经在持仓详情页展示了：
   - `Change with currency effect`
   - `Performance with currency effect`
4. 分析页已经能计算整体的 `Absolute Currency Performance`，即：

```text
netPerformanceWithCurrencyEffect - netPerformance
```

所以如果目标只是：

- 给用户一个“默认显示哪套收益”的开关
- 支持把收益统一换算到另一个衡量货币

那不是推翻重做，而是在现有体系上继续扩展。

---

## 当前实现的主要缺口

### 缺口 1：`baseCurrency` 还没有被拆成“衡量货币”和“多币种换汇成本账本”

现在所有地方几乎都把 `baseCurrency` 当成最终展示货币。

这会带来三个问题：

1. 你无法自然表达“我最终用 CNY 看收益，但证券买入实际消耗的是历史上累积下来的 USD / HKD / EUR 库存”。
2. 系统无法维护每一种外币自己的综合换汇成本。
3. 未来如果只想改衡量货币，不一定希望连底层换汇成本假设都一起改变。

### 缺口 2：目前没有“用户可选默认展示模式”

虽然后端已经算了两套收益，但前端多数页面默认使用的是 `withCurrencyEffect` 这套字段。

也就是说：

- 系统“能算”
- 但系统“还没有产品化为一个用户设置”

### 缺口 3：当前没有“按币种汇兑归因 / 分币种收益”的返回模型

目前系统能给你：

- 总收益
- 总汇率收益
- 单个持仓的带/不带汇率影响

但是还不能直接返回这样的结构：

```json
[
  {
    "sourceCurrency": "USD",
    "targetCurrency": "CNY",
    "marketPerformance": 12000,
    "fxPerformance": -2300,
    "totalPerformanceWithFx": 9700
  }
]
```

这层能力需要新增聚合逻辑。

而且你要求的“分币种收益”比单纯汇兑差值更进一步，它需要支持：

- 按持仓币种聚合收益
- 如果单独录入了换汇交易，也应纳入对应币种收益

这一层在当前模型里还不存在。

### 缺口 4：持仓层目前只有“带汇率影响”的区间映射，没有“无汇率影响”的区间映射

当前 `TimelinePosition` / `SymbolMetrics` 里有：

- `netPerformanceWithCurrencyEffectMap`
- `netPerformancePercentageWithCurrencyEffectMap`

但没有对称的：

- `netPerformanceMap`
- `netPerformancePercentageMap`

这意味着：

- 如果只是展示组合总收益，当前历史图表已经足够
- 但如果你想做“指定区间下，按持仓或按币种切换为不考虑汇率影响”，现有返回模型不完全够用

这是一个很关键的实现点。

### 缺口 5：没有持久化的“多币种手工换汇成本”

当前数据库里的 `Order` 只有：

- `currency`
- `unitPrice`
- `fee`

没有类似下面的字段：

- `fxRate`
- `fxRateSource`
- `unitPriceInAssetCurrencyLocked`
- `valueInReportingCurrencyLocked`

所以现在系统做的是：

> 按历史市场汇率重建汇率换算

而不是：

> 按用户当时真实成交汇率还原现金流

如果你非常重视和券商结算汇率完全一致，这一层需要额外设计。

而且这层不应该只针对 `USD`，而应该能覆盖：

- `USD`
- `HKD`
- `EUR`
- 以及未来可能新增的其他货币

### 缺口 6：当前没有“换汇交易”这一类一等公民模型

你提到：

> 如果单独录入了换汇交易，也算在分币种收益里

这是一个很关键的产品要求。

当前 Ghostfolio 的现金和活动模型更偏向：

- 买卖证券
- 分红
- 利息
- 费用

但并没有一个明确的“FX exchange / currency conversion”交易类型。

所以如果要把换汇交易计入分币种收益，后续需要二选一：

1. 用现有现金/手工资产/转账模型折中实现
2. 正式新增“换汇交易”模型

---

## 可行性判断

### A. “用户选择是否考虑汇率影响”

**可行性：高**

原因：

- 后端已有两套收益字段
- 前端已经部分展示了差值和带汇率影响指标
- 主要是设置项、接口透传、默认展示切换

这部分属于比较稳妥的产品化改造。

### B. “区分衡量货币和多币种换汇成本账本”

**可行性：高到中**

原因：

- `ExchangeRateDataService.getExchangeRatesByCurrency()` 已支持传入 `targetCurrency`
- 组合计算器构造函数本身就接受 `currency`
- 说明底层计算并没有被写死到某个固定货币

真正的工作量主要在：

- 用户设置设计
- API 统一透传
- 缓存 key
- 账户余额/现金/费用/分红/快照等联动
- 以及要明确“多币种 FX ledger”在计算中的优先级

### C. “按币种拆分汇率损益 / 分币种收益”

**可行性：中**

原因：

- 底层公式已有基础
- 但需要新增数据结构、聚合维度和 UI
- 还需要决定是否只按 `asset currency` 聚合，还是也要按 `account currency` / `transaction currency` / `fx exchange` 聚合

我建议第一版只按 **资产 / 持仓最终计价币种** 聚合，即：

- 美股 ETF 归到 `USD`
- 港股 ETF 归到 `HKD`
- 欧股 ETF 归到 `EUR`

这样复杂度可控，也最符合“不同币种对衡量货币造成的汇兑影响”这个目标。

### D. “每笔交易手工汇率”

**可行性：中到低**

原因：

- 这是一个数据模型层的增强，不只是显示层增强
- 需要决定汇率是相对于：
  - 资产货币
  - 账户货币
  - 衡量货币
  - 还是三者之间的某个关系
- 一旦设计不清楚，后续导入、编辑、历史重算都会很麻烦

因此不建议一开始就把这部分混在第一版里。

### E. “换汇交易计入分币种收益”

**可行性：中到低**

原因：

- 这不只是收益字段扩展，还涉及活动类型建模
- 需要定义换汇交易如何影响：
  - 现金余额
  - 币种敞口
  - 分币种收益
  - 汇率归因

如果第一版就做，会显著扩大改动面。

---

## 推荐方案

## Phase 1：先把“衡量货币”“多币种 FX ledger”和“默认收益展示模式”做出来

### 新增用户设置

建议在 `UserSettings` 中增加至少两个核心字段，加一个可选偏好字段：

```ts
reportCurrency?: string;
fxLedgerMode?: 'MARKET' | 'MANUAL_AVERAGE_COST' | 'MANUAL_TRANSACTIONS';
performanceDisplayMode?: 'WITH_CURRENCY_EFFECT' | 'WITHOUT_CURRENCY_EFFECT';
primaryInvestmentCurrency?: string;
```

说明：

- `reportCurrency`
  - 对应“衡量货币”
  - 用于收益、净值、费用、分红、现金、分析页等统一折算目标货币
  - 默认值等于当前 `baseCurrency`
- `fxLedgerMode`
  - 对应“多币种换汇成本账本”的工作模式
  - `MARKET`
    - 不录入手工换汇成本，全部按市场汇率近似
  - `MANUAL_AVERAGE_COST`
    - 允许用户为 `USD` / `HKD` / `EUR` 等货币维护综合换汇成本
  - `MANUAL_TRANSACTIONS`
    - 未来扩展为完整换汇交易账本
- `performanceDisplayMode`
  - 仅决定前端默认展示哪套收益
  - 默认值建议为 `WITH_CURRENCY_EFFECT`，以保持兼容当前行为
- `primaryInvestmentCurrency`
  - 可选偏好字段
  - 仅用于 UI 默认观察货币，不建议作为底层成本核算的唯一锚点

### 为什么不建议直接重命名 `baseCurrency`

因为当前项目里 `baseCurrency` 使用范围很广，直接改语义会牵动非常多位置。

更稳妥的做法是：

1. 短期保留 `baseCurrency`
2. 新增 `reportCurrency`
3. 新增 `fxLedgerMode`
4. 如有需要，再新增 `primaryInvestmentCurrency` 作为 UI 偏好
5. 渐进式把组合分析、收益、估值改为优先使用 `reportCurrency`
6. 后续再决定 `baseCurrency` 是否继续保留为兼容字段

### 后端改造点

- `libs/common/src/lib/interfaces/user-settings.interface.ts`
- `libs/common/src/lib/dtos/update-user-setting.dto.ts`
- `apps/api/src/app/user/user.service.ts`
  - 设置默认值
- `apps/api/src/app/user/user.controller.ts`
  - 这些新设置变化时也应触发组合缓存失效，不应只盯着 `baseCurrency`
- `apps/api/src/app/portfolio/portfolio.service.ts`
  - 新增 `getReportCurrency()`
  - 新增 `getFxLedgerMode()`
  - 收益、持仓、详情、分析等统一改为取 `reportCurrency`
- `apps/api/src/services/queues/portfolio-snapshot/*`
  - 快照 job payload 要带上 `reportCurrency` 和 `fxLedgerMode`
- `apps/api/src/app/redis-cache/redis-cache.service.ts`
  - snapshot key 需要包含 `reportCurrency` 和 `fxLedgerMode`

### 前端改造点

- `apps/client/src/app/components/user-account-settings/*`
  - 新增设置项：
    - `Report Currency`
    - `FX Ledger Mode`
    - `Performance Display Mode`
    - 可选的 `Primary Investment Currency`
- 组合概览、分析页、持仓卡片、持仓详情等页面
  - 根据 `performanceDisplayMode` 选择默认字段：
    - `netPerformance` 或 `netPerformanceWithCurrencyEffect`
    - `grossPerformance` 或 `grossPerformanceWithCurrencyEffect`
    - 对应百分比字段

### Phase 1 的产出

用户会得到：

- 一个独立的衡量货币
- 一个可扩展到多种货币的 FX ledger 工作模式
- 一个默认展示模式开关
- 现有计算逻辑最大化复用

### Phase 1 最值得优先落地的具体形式

如果希望第一版既有价值、又不会把系统复杂度一下拉得太高，我建议优先做：

`多币种综合换汇成本表`

例如允许用户维护：

- `USD`
  - 当前持有量
  - 综合换汇成本（例如 `7.21 CNY / USD`）
- `HKD`
  - 当前持有量
  - 综合换汇成本（例如 `0.91 CNY / HKD`）
- `EUR`
  - 当前持有量
  - 综合换汇成本

这样做的优点是：

- 非常贴近个人投资者现实中的记账方式
- 不要求用户一次性补齐所有历史换汇流水
- 又能显著降低 `baseCurrency = CNY` 时系统错误重构历史换汇路径的问题

这会比第一版直接上“完整换汇交易模型”更现实。

---

## Phase 2：加入“按币种汇兑损益归因”和“分币种收益”

### 推荐的数据模型

建议新增一个共享接口，例如：

```ts
export interface CurrencyEffectAttribution {
  sourceCurrency: string;
  targetCurrency: string;
  investmentWithoutCurrencyEffect: number;
  investmentWithCurrencyEffect: number;
  netPerformanceWithoutCurrencyEffect: number;
  netPerformanceWithCurrencyEffect: number;
  fxPerformance: number;
  currentValueInTargetCurrency: number;
}
```

其中：

```text
fxPerformance =
  netPerformanceWithCurrencyEffect - netPerformanceWithoutCurrencyEffect
```

### 最推荐的聚合维度

第一版建议按 `position.currency` 聚合，也就是按资产币种聚合。

原因：

1. 当前 `TimelinePosition` 已经有 `currency`
2. 对用户理解最直观
3. 和你“分别知道某种货币上的盈亏”这个目标最接近
4. 不需要第一版就引入更多账户层或现金流层复杂性

如果后续要把“换汇交易”正式算进去，可以扩展为两层聚合：

1. 持仓币种收益
2. 现金 / 换汇币种收益

但这更适合放在第二轮迭代。

### 为什么这里不建议把单一 `primaryInvestmentCurrency` 作为核心

因为一旦用户同时持有：

- `USD`
- `HKD`
- `EUR`

那么单一主交易货币就不足以表达真实资金路径。

更稳的底层模型应当是：

- 一个 `reportCurrency`
- 一组 `currency ledgers`

其中每种货币分别维护自己的余额和成本，而不是让所有非 `CNY` 持仓都依附在某一个“主交易货币”之下。

### 后端实现位置建议

最合适的位置不是直接塞进最底层汇率服务，而是：

- 先在 `PortfolioCalculator` / `TimelinePosition` 层补齐需要的字段
- 再在 `PortfolioService` 中做按币种归因聚合

推荐原因：

- 组合计算器负责“算单个持仓”
- `PortfolioService` 负责“组合、汇总、展示模型”

职责更清晰。

### 一个现实问题

如果要支持“指定时间区间下的按币种归因”，当前模型还不够。

因为当前持仓级别只有：

- `netPerformanceWithCurrencyEffectMap`

没有：

- `netPerformanceMap`

所以推荐在 Phase 2 一起补：

```ts
netPerformanceMap: { [key: DateRange]: Big };
netPerformancePercentageMap: { [key: DateRange]: Big };
```

这样以后前端切换时间区间时，才能完整地对称展示：

- 不考虑汇率影响
- 考虑汇率影响
- 汇率贡献差值

### UI 方案建议

可以新增一个区块：

`Currency Attribution / Multi-Currency P&L`

示例：

| Source | Target | Market P/L | FX P/L | Total P/L |
| ------ | ------ | ---------: | -----: | --------: |
| USD    | CNY    |     12,000 | -2,300 |     9,700 |
| HKD    | CNY    |      1,800 |    250 |     2,050 |
| EUR    | CNY    |       -900 |   -120 |    -1,020 |

第一版我建议先做表格，不要先做复杂图形。

---

## Phase 3：如果要支持“每笔交易手工汇率”和“换汇交易”

### 为什么这是单独一个阶段

因为这是“数据真实性增强”，不是单纯“报表维度增强”。

你 Excel 的价值在于：

> 你保存的是实际成交汇率，而不是市场日线汇率。

当前 Ghostfolio 做不到这件事。

### 可以考虑的几种设计

#### 方案 A：给 `Order` 新增直接汇率字段

例如：

```ts
fxRate?: number;
fxRateType?: 'TRANSACTION_TO_ASSET' | 'TRANSACTION_TO_REPORT';
```

优点：

- 结构简单

缺点：

- 语义容易混乱
- 当 `reportCurrency` 可变时，`TRANSACTION_TO_REPORT` 会有历史兼容问题

#### 方案 B：保存锁定后的资产货币价格

例如新增：

```ts
unitPriceInAssetProfileCurrencyLocked?: number;
feeInAssetProfileCurrencyLocked?: number;
```

优点：

- 不必每次再按历史市场汇率反推
- 更接近“当时这笔交易实际被确认的资产成本”

缺点：

- 对“以衡量货币衡量的真实现金流”仍然不完全够

#### 方案 C：把外汇兑换建模为独立现金 / 货币活动

这是最准确、也最复杂的方案。

优点：

- 会计意义最完整

缺点：

- 对产品交互和数据模型影响太大
- 已经接近重新定义现金流体系

### 推荐判断

如果只是先满足大多数跨币种投资用户，建议 **暂不做 Phase 3**。

先用历史市场汇率完成：

- 衡量货币与多币种 FX ledger 分离
- 币种归因
- 分币种收益

后续再看是否真的需要引入手工汇率和换汇交易模型。

---

## 推荐的最小可落地版本

如果希望用最稳妥、最有性价比的方式先把功能放进 Ghostfolio，我建议最小版本是：

### 第一批必须做

1. 新增 `reportCurrency`
2. 新增 `fxLedgerMode`
3. 可选新增 `primaryInvestmentCurrency`
4. 所有组合收益接口改用 `reportCurrency`
5. 组合快照缓存 key 包含 `reportCurrency` 和 `fxLedgerMode`
6. 用户设置修改 `reportCurrency` / `fxLedgerMode` 时也触发快照失效
7. 前端主要页面允许默认显示：
   - 考虑汇率影响
   - 不考虑汇率影响
8. 为多币种综合换汇成本表预留数据结构

### 第二批强烈建议做

1. 新增 `currency attribution` 聚合接口
2. 按资产币种拆分 `fxPerformance`
3. 为后续换汇交易预留聚合入口
4. 分析页增加“币种汇率贡献”区块

### 第三批再评估

1. 交易手工汇率
2. 导入模板支持手工汇率字段
3. 现金 / 外汇兑换单独建模
4. 换汇交易纳入分币种收益

---

## 风险与注意点

### 1. 快照缓存一定要改

当前 `portfolio snapshot` 的 cache key 只包含：

- `userId`
- `filters`

如果引入新的 `reportCurrency` / `fxLedgerMode`，但缓存 key 不带这些维度，就会出现：

- 同一个用户切换货币设定后，读到旧货币快照

这是必须避免的。

### 2. 用户设置变更触发条件要扩展

当前 `updateUserSetting()` 里，是否触发组合变更事件主要看 `baseCurrency`。

如果新增：

- `reportCurrency`
- `fxLedgerMode`
- `performanceDisplayMode`
- 可选的 `primaryInvestmentCurrency`

至少 `reportCurrency` 和 `fxLedgerMode` 变化时必须触发重新计算和缓存失效。
如果 `primaryInvestmentCurrency` 只用于 UI 偏好，那么它不一定需要触发全量快照失效。

### 3. 持仓级区间收益模型不对称

如果未来要做“任意区间切换 + 任意模式切换 + 币种归因”，建议尽早把：

- `with currency effect`
- `without currency effect`

这两套 map 做对称，否则后续每个页面都要单独补逻辑。

### 4. 现金和账户余额是否纳入汇率归因，需要产品决策

这是一个很重要但容易被忽略的问题。

例如用户持有：

- `USD cash`
- `USD ETF`

那“USD 对 CNY 的汇率损益”是否既包含 ETF，也包含现金余额？

建议：

- 第一版只做投资持仓
- 第二版再决定是否纳入现金余额和换汇交易

这样可以先把主流程做稳。

---

## 我对实现路径的建议

### 推荐路线

1. 先做 `reportCurrency`
2. 再做 `fxLedgerMode`
3. 如有需要，再做 `primaryInvestmentCurrency` 作为 UI 偏好
4. 再做 `performanceDisplayMode`
5. 接着补持仓级别的无汇率影响区间 map
6. 最后做按币种归因

### 不建议的路线

不建议一上来就同时做：

- 衡量货币分离
- 多币种 FX ledger
- 默认模式切换
- 币种归因
- 手工汇率
- 换汇交易
- 导入兼容

因为那样会把：

- 数据模型
- API
- 缓存
- 前端
- 导入逻辑

全部缠在一起，改动面过大，回归成本也会显著上升。

---

## 最终判断

这项改动适合做，而且和 Ghostfolio 当前已有的收益计算体系是有衔接点的，不属于“方向完全相反”的需求。

最关键的判断有三条：

1. **“考虑汇率影响 / 不考虑汇率影响”其实已经存在于底层计算里，缺的是产品化开关。**
2. **“衡量货币”和“多币种 FX ledger”的分离在技术上可行，因为汇率服务和组合计算器都支持任意目标货币。**
3. **“按币种拆分汇兑损益 / 分币种收益”需要新增聚合模型，但不需要推翻现有收益计算。**

如果要兼顾收益、复杂度和可维护性，我建议把这次需求定义为：

> “给 Ghostfolio 增加独立的衡量货币、多币种 FX ledger 和收益展示模式，并在分析页提供按币种的汇率归因与分币种收益视图。”

而不是第一版就直接做到：

> “完整支持用户手工维护每笔外汇成交汇率，并把换汇交易一起纳入收益模型。”

后者不是不能做，而是更适合作为第二轮设计。
