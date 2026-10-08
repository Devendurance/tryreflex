import type { ReactNode } from "react";
import { Tag } from "@/components/decisions/decision-parts";
import { MISSING, PURPOSE_ORDER, PURPOSES, type ClassicOrder, type FinancialGroup, type Purpose } from "./activity-api";

export function Fact({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="t-eyebrow text-[11px]">{label}</dt>
      <dd className="mt-1 text-[15px] leading-[22px] break-words text-ink">{children}</dd>
      {hint && <p className="t-caption mt-0.5">{hint}</p>}
    </div>
  );
}

export function Num({ value, unit }: { value: string; unit?: string }) {
  return (
    <span className="t-data">
      {value}
      {unit && <span className="text-muted"> {unit}</span>}
    </span>
  );
}

export function DirectionTag({ direction }: { direction: "buy" | "sell" }) {
  return <Tag>{direction === "buy" ? "Buy" : "Sell"}</Tag>;
}

export function PurposeTag({ purpose }: { purpose: Purpose }) {
  return <Tag tone={purpose === "unknown" ? "neutral" : "confirmed"}>{PURPOSES[purpose].name}</Tag>;
}

export function Timestamp({ text }: { text: string }) {
  return (
    <span>
      <span className="t-data">{text}</span> <span className="t-caption whitespace-nowrap">timezone unknown</span>
    </span>
  );
}

export function OrderFacts({ order }: { order: ClassicOrder }) {
  const amountUnit = order.orderAmountUnit === "base_asset" ? order.baseAsset : order.quoteAsset;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
      <Fact label="Placed">
        <Timestamp text={order.dateText} />
      </Fact>
      <Fact label="Order type">{order.type}</Fact>
      <Fact label="Status">{order.status}</Fact>
      <Fact label="Order ID">
        <span className="t-data text-[13px] break-all">{order.orderId}</span>
      </Fact>
      <Fact label="Order price" hint="The price you set, not a fill price">
        <Num value={order.orderPrice} unit={order.quoteAsset} />
      </Fact>
      <Fact label="Order amount">
        <Num value={order.orderAmount} unit={amountUnit} />
      </Fact>
      <Fact label="Executed">
        <Num value={order.executedQuantity} unit={order.baseAsset} />
      </Fact>
      <Fact label="Average price" hint="As reported by Bitget">
        <Num value={order.averagePrice} unit={order.quoteAsset} />
      </Fact>
      <Fact label="Trading volume">
        <Num value={order.tradingVolume} unit={order.quoteAsset} />
      </Fact>
    </dl>
  );
}

export function Fills({ order }: { order: ClassicOrder }) {
  if (order.executions.length === 0) return <p className="text-[14px]">This order has no fills in the export.</p>;
  return (
    <ol className="divide-y divide-hairline rounded-[12px] border border-hairline">
      {order.executions.map((fill, index) => (
        <li key={fill.executionKey} className="p-4">
          <p className="t-eyebrow text-[11px]">Fill {index + 1}</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
            <Fact label="Time">
              <Timestamp text={fill.dateText} />
            </Fact>
            <Fact label="Fill price">
              <Num value={fill.price} unit={order.quoteAsset} />
            </Fact>
            <Fact label="Quantity">
              <Num value={fill.quantity} unit={order.baseAsset} />
            </Fact>
            <Fact label="Gross volume">
              <Num value={fill.grossVolume} unit={order.quoteAsset} />
            </Fact>
            <Fact label="Reported fee">
              <Num value={fill.feeAmount} unit={fill.feeCurrency} />
            </Fact>
          </dl>
        </li>
      ))}
    </ol>
  );
}

export function Totals({ group }: { group: FinancialGroup }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
      <Fact label="Filled quantity">
        <Num value={group.filledQuantity} unit={group.baseAsset} />
      </Fact>
      <Fact label={group.direction === "sell" ? "Gross proceeds" : "Gross cost"} hint="Sum of fill volumes">
        <Num value={group.grossVolume} unit={group.quoteAsset} />
      </Fact>
      <Fact label="Reported fees">
        {group.reportedFees.length === 0
          ? "None reported"
          : group.reportedFees.map((fee) => (
              <span key={fee.currency} className="block">
                <Num value={fee.amount} unit={fee.currency} />
              </span>
            ))}
      </Fact>
      {group.direction === "sell" && (
        <Fact label="Net of fees" hint="Gross proceeds minus reported fees. Not profit.">
          {group.netProceeds && group.netProceedsCurrency ? <Num value={group.netProceeds} unit={group.netProceedsCurrency} /> : "Unknown"}
        </Fact>
      )}
      <Fact label="Cost basis">Unknown</Fact>
      <Fact label="Realized P&L">Unknown</Fact>
    </dl>
  );
}

export function MissingData({ items }: { items: string[] }) {
  return (
    <p className="text-[14px] leading-[22px]">
      Not in this export, so Reflex leaves it unknown:{" "}
      <span className="text-ink">{items.map((item) => MISSING[item] ?? item).join(", ")}.</span>
    </p>
  );
}

export function PurposeChoice({
  name,
  value,
  onChange,
  disabled,
  legend,
}: {
  name: string;
  value: Purpose;
  onChange: (purpose: Purpose) => void;
  disabled?: boolean;
  legend: string;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="text-[15px] font-medium text-ink">{legend}</legend>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {PURPOSE_ORDER.map((purpose) => (
          <label
            key={purpose}
            className={`flex cursor-pointer gap-3 rounded-[12px] border p-3 transition-colors has-[:focus-visible]:shadow-[0_0_0_3px_rgba(242,107,29,.25)] ${
              value === purpose ? "border-ink bg-cream" : "border-hairline bg-white hover:bg-cream/50"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={purpose}
              checked={value === purpose}
              onChange={() => onChange(purpose)}
              className="mt-1 size-4 shrink-0 accent-[#241B15]"
            />
            <span className="min-w-0">
              <span className="block text-[14px] font-medium text-ink">{PURPOSES[purpose].name}</span>
              <span className="block text-[13px] leading-5">{PURPOSES[purpose].meaning}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
