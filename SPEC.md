# Sigma Leather Accounting Panel — Spec

Single-admin web panel that answers one question every month: **are we earning or losing?**

Stack: SvelteKit (Svelte 5) · Turso (libSQL) · Drizzle ORM · Tailwind v4 · shadcn-svelte · Vercel (hosting + cron).

---

## 1. Scope

**In scope**

- Monthly income statement (main output), from the first Shopify sale (~Dec 2025) onward.
- Inventory value report (on hand + with courier + in transit from China). No full balance sheet.
- Landed cost of imports (DDP), weighted-average COGS, push stock + cost to Shopify.
- Courier data: PostEx (API sync + CSV fallback), DEX (xlsx statements), manual entry.
- Monthly expenses.

**Out of scope (for now)**

- Fixed assets, depreciation, owner equity, full balance sheet.
- Multi-user / roles.
- Courier booking (we only read courier data).

---

## 2. Core rules

| Rule           | Detail                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------- |
| Money          | Stored as **integer paisa**. Never floats. Display `Rs 12,345` (no decimals in reports). |
| Time zone      | All dates bucketed in **Asia/Karachi**.                                                  |
| Revenue timing | Recognized on **delivery** (courier final status date), not order date.                  |
| Cost method    | **Weighted average** per variant. Only receiving a batch changes unit cost.              |
| Stock in       | Only through panel import batches (or panel adjustments).                                |
| Courier tax    | ITWH 2% + STWH 2% of COD = permanent **expense** (not recoverable).                      |
| Every number   | Computed from ledger rows, drillable to source rows. Nothing typed into reports.         |

### Order / parcel lifecycle

| State                          | Accounting effect                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| Placed / unfulfilled           | none                                                                                       |
| Cancelled                      | none                                                                                       |
| Fulfilled (shipped)            | stock → "with courier" at snapshot avg cost                                                |
| Delivered                      | revenue + COGS (snapshot cost) + courier fee + fee tax + ITWH + STWH; courier receivable ↑ |
| Returned                       | stock back at snapshot cost; forward/return fee + tax = expense                            |
| Settled (CPR / statement paid) | receivable → bank                                                                          |

Prepaid orders (Shopify "marked as paid", or courier COD ≤ Rs 1): no ITWH/STWH, cash already received, courier fee still applies.

---

## 3. Data model (Drizzle / SQLite)

All money columns `*_paisa INTEGER`. All ids for Shopify objects = numeric part of GID.

**Catalog & cost**

- `variants` — shopify variant id, product id, product title, variant title, sku, inventory_item_id, weight_g, `avg_cost_paisa`, `cost_source` (`estimated` | `batch`), cn_price (foreign minor units) + currency for estimates, updated_at.
- `cost_history` — variant_id, at, old/new avg cost, reason (`opening` | `batch` | `manual`), ref.

**Imports (China → Pakistan, DDP)**

- `import_batches` — ref, supplier, currency (RMB/USD), fx_rate (PKR per unit, ×10⁴ int), ddp_rate_per_kg_paisa, status (`draft` → `paid` → `landed`), paid_on, landed_on, notes.
- `batch_items` — batch_id, variant_id, qty, unit_price_foreign_minor, unit_weight_g, landed_unit_cost_paisa (computed).
- `batch_costs` — batch_id, type (`ddp_cargo` | `local_cartage` | `other`), amount_paisa, alloc (`weight` | `value` | `qty`).

Landed unit cost = unit price × FX + share of batch costs (DDP cargo by weight by default).
On **landed**: write `stock_movements` (receipt), recompute avg cost, push qty (`inventoryAdjustQuantities`) and cost (`inventoryItemUpdate.cost`) to Shopify.

**Stock ledger**

- `stock_movements` — variant_id, at, qty_delta, type (`opening` | `receipt` | `shipped` | `returned` | `adjust` | `variance`), unit_cost_paisa, reason, ref_type, ref_id.
- Expected on-hand = Σ qty_delta (excluding shipped/returned pairs that net out) — compared nightly with Shopify `on_hand`.

**Sales**

- `orders` — shopify order id, name (#2657 → 2657), created_at, cancelled_at, financial_status, gateway, is_prepaid, subtotal, total_discounts, prepaid_discount, shipping_charged, total.
- `order_lines` — order_id, line id, variant_id, qty, unit_price, line_discount, `cost_snapshot_paisa` (avg at fulfillment).

**Courier**

- `shipments` — UNIQUE(courier, tracking_no). original_tracking_no, order_ref_raw, order_id (nullable), match_status (`auto` | `manual` | `unmatched` | `excluded`), status (`booked` | `in_transit` | `delivered` | `returned` | `cancelled`), booked_at, pickup_at, final_at, weight_kg, cod_paisa, fee, fee_tax, return_fee, return_fee_tax, other_fees, itwh, stwh, net_payable, `fees_estimated`, `taxes_estimated`, statement_id, raw (json), updated_at.
- `shipment_changes` — shipment_id, at, source (`api` | `file:<id>` | `manual`), diff json. (audit)
- `statements` — courier, number (CPR-… / …NETOFF-…), period_start, period_end, statement_date, totals.
- `payouts` — courier, received_on, amount_paisa, bank_ref; link table `payout_statements`.
- `import_files` — sha256, filename, courier, imported_at, counts json.

**Expenses**

- `expense_categories` — name, group (`marketing` | `operating` | `other`).
- `expenses` — date, category_id, amount_paisa, note, recurring_id.
- `recurring_expenses` — category_id, amount_paisa, day_of_month, active.

**System**

- `month_locks` — month (YYYY-MM), locked_at.
- `sync_runs` — kind, started_at, finished_at, ok, summary.
- `settings` — key/value json (rate learning window, DDP default rate, etc.).

---

## 4. Courier ingestion

### PostEx — API (primary)

Base `https://api.postex.pk/services/integration/api/order`, header `token`.

- `GET v1/get-all-order?orderStatusId=0&startDate&endDate` → all parcels + status + fee + reversal fee.
- `GET v1/payment-status/{tracking}` → CPR number + settlement date (call only for delivered parcels with no statement yet).
- Fields: `invoicePayment`=COD, `transactionFee/Tax`=fee+GST, `reversalFee/Tax`=return fee+GST, `orderDeliveryDate`, `actualWeight`, `transactionStatus`.
- ITWH/STWH not in API → computed as 2% + 2% of COD on delivered, flagged `taxes_estimated`; CSV import overwrites with real values.
- Status map: Unbooked/Booked → `booked`; Picked/In Stock/Transferred/Out for delivery… → `in_transit`; Delivered → `delivered`; Return → `returned`; Cancelled → `cancelled`.
- Nightly cron + "Sync now" button. Window: last 60 days nightly; full history on demand.

### PostEx — CSV (fallback)

Columns: `ORDER_REF_NUMBER, TRACKING_NUMBER, COD_AMOUNT, TRANSACTION_STATUS, RESERVE_CPR_NUMBER, RESERVE_PAYMENT, RESERVE_CPR_DATE, ORDER_PICKUP_DATE, ORDER_DELIVERY_DATE, FEE, GST, ITWH (2%), STWH (2%)`.

### DEX — xlsx statements

- Header row 1; skip format-note rows and the `Total` row; **validate row sums against Total row**.
- Map columns **by normalized header name with aliases** (trim, lowercase, collapse spaces). Known aliases e.g. `COD Surcharge Fee` = `codFee`. Unknown column with non-zero values → block import, ask.
- `External Order No.` = `{orderName}_{shopifyOrderId}_{x}` → exact Shopify match.
- Returns: `Final Status = Package Returned`, fee in `Failed Delivery Fee`.
- `Original TrackingNumber` links reshipments.
- Taxes read as given (some early rows have none) — never assumed.

### Import pipeline (all files)

1. Upload → SHA-256 → if seen: "Already imported on <date>", stop.
2. Parse + normalize → validate totals.
3. Diff against DB by `(courier, tracking_no)`:
   - new → insert
   - identical → unchanged
   - new info (status, fees, statement) → update + `shipment_changes`
   - already in a **different statement with different amounts** → **conflict** (possible double charge), manual review
   - order ref not matched → **unmatched queue**
4. **Preview screen**: `New · Updated · Unchanged · Conflicts · Unmatched` with per-row diffs.
5. Confirm → commit in one transaction.

### Order ref normalization (PostEx)

Strip `#`, take leading digits. Suffixes `-2`, `Part 2` → extra parcel of same order (rare; confirm in unmatched queue). Refs not found in Shopify (e.g. pre-Shopify `00097`, `WP000254`) → `excluded`.

### Fee estimates

Until a fee is known: median actual fee of last 30 parcels for same courier + weight band (+ province for DEX). Flag `fees_estimated`. **Outlier alert** when actual fee > 3× median (e.g. DEX #1581 billed 38.56 kg → Rs 2,370).

---

## 5. Stock outside the panel

- Cancel + restock, RTO restock: no accounting impact (no sale was recognized).
- Damaged / lost / gift / count correction: done in panel → `adjust` movement → pushed to Shopify → "Inventory write-off" expense.
- **Nightly reconciliation** (source of truth): expected vs Shopify `on_hand` per variant → differences land in **Variance inbox**; admin classifies with one click.
- Webhook `inventory_levels/update`: optional, alert only (no reason given).

---

## 6. Opening balance & history

- Product cost estimate: `China price × FX + unit weight kg × DDP rate/kg`. Bulk grid + CSV upload. Marked `estimated`.
- Opening qty at first sale date = current on_hand + units shipped since − units returned/received since.
- History reports badged "estimated cost" where estimates were used.
- Past expenses: monthly totals per category are enough.
- Historical courier data: PostEx full API pull + `dex-complete.xlsx`.

---

## 7. Reports

### Income statement (monthly, by delivery date)

```
Gross sales                     (delivered order lines)
− Prepaid discount (5%)
− Other discounts
+ Shipping charged to customers
= NET SALES
− COGS                          (cost snapshot × qty delivered)
= GROSS PROFIT                  (+ margin %)
− Delivery fees + GST/VAT       (delivered parcels)
− Return fees + GST/VAT         (returned parcels)
− Courier withholding (ITWH 2% + STWH 2%)
− Marketing                     (expense group)
− Operating expenses            (expense group, by category)
− Inventory write-offs
= NET PROFIT / (LOSS)
```

KPIs: delivered orders, return rate %, AOV, gross margin %, courier cost per delivered order, net margin %.
Per-product profit table. Month status badge: `Provisional` (estimates present) → `Final` → `Locked`.
Late changes to locked months post to current month as "Prior-month adjustment".

### Inventory value

- On hand: qty × avg cost
- With courier: shipped, not final, at snapshot cost
- In transit from China: paid batches not landed
- Total + per-product table + `estimated` share.

### Courier

- Owed by courier (delivered, not settled), per courier.
- Statements vs payouts reconciliation.
- Return rate by courier / city / product.

---

## 8. UI conventions

- **Components**: shadcn-svelte on Tailwind v4. No other UI libraries.
- **Layout**: left sidebar — Dashboard · Imports (China) · Inventory · Orders · Couriers · Expenses · Reports · Settings. Top bar: **global month picker** (drives every page) + Sync status.
- **Numbers**: `Rs 1,234,567`, `tabular-nums`, right-aligned. Losses red as `(12,500)`. Profit green. Reports no decimals; detail rows may show paisa.
- **Status colors (fixed everywhere)**: gray draft/booked · blue in transit · green delivered/final · red returned/loss/conflict · amber estimated/provisional · violet excluded/unmatched.
- **Drill-down**: every number is a link to its source rows.
- **Forms**: right-side drawer (sheet). Keyboard friendly, Enter submits.
- **Tables**: dense, sticky header, search + filters, CSV export.
- **Imports**: always preview diff before commit.
- Desktop-first; dashboard + expense entry usable on phone. Light + dark.
- Fonts: Inter (UI) with tabular numerals.

---

## 9. Security

- Single admin: email + plain password in env (constant-time compare), signed session cookie (HttpOnly, Secure, SameSite=Lax), login rate limit. No signup.
- Secrets only in `.env` / Vercel env: `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_TOKEN`, `POSTEX_TOKEN`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `CRON_SECRET`.
- Cron endpoints require `CRON_SECRET`.

---

## 10. Phases

1. **Foundation** — scaffold, auth, schema, layout shell, Shopify product/variant sync.
2. **Couriers** — PostEx API sync, DEX import, import preview/dedupe, unmatched queue.
3. **Orders** — Shopify order sync (bulk history), order ↔ shipment linking, prepaid detection.
4. **Costing** — cost estimate grid, opening stock, import batches, push stock + cost to Shopify.
5. **Expenses + Income statement** — categories, recurring, monthly P&L, per-product profit, month lock.
6. **Inventory value + reconciliation** — nightly variance inbox, adjustments, inventory report.

## Open questions

- Exact title of the 5% advance-payment discount in Shopify.
- Is shipping charged to customers in Shopify? (→ "Shipping charged" line.)
- DDP rate: flat Rs/kg or per shipment?
