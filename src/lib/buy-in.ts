// "Distributor buy-in": our invoiced orders for the Sales page's window, in LF
// and the dollars of those same lines. Lifted out of home/manager-home.tsx so
// the agent connector reads the same figure; the page calls this and behaves
// as before. THE LAW: only an invoiced order is a sale. THE MEASURE: LF; lines
// that cannot speak it are ignored (orderVolume).

import { ORDERS_CONSISTENT_FROM, orderVolume, type OrderItemLike } from "@/lib/domain/order-volume";

export const INVOICED_STATUSES = new Set(["Invoice_Sent", "Completed"]);

export interface BuyInOrder {
  status: string;
  order_date_po: string | null;
  created_at: string | null;
  items: OrderItemLike[] | null;
}

/** The window as the page resolves it: kind plus, for month and year, the anchor month. */
export type BuyInWindow =
  | { kind: "month" | "year"; anchorYm: string | null }
  | { kind: "range"; from: string; to: string }
  | { kind: "before" };

export function inBuyInWindow(m: string, w: BuyInWindow): boolean {
  switch (w.kind) {
    case "range":
      return m >= w.from && m <= w.to;
    case "before":
      return m < ORDERS_CONSISTENT_FROM;
    case "year":
      return (
        w.anchorYm !== null &&
        m.slice(0, 4) === w.anchorYm.slice(0, 4) &&
        m <= w.anchorYm &&
        m >= ORDERS_CONSISTENT_FROM
      );
    default:
      return w.anchorYm !== null && m === w.anchorYm;
  }
}

/** Invoiced LF and dollars inside the window (attribution by PO month). */
export function buyInTotals<T extends BuyInOrder>(
  orders: readonly T[],
  w: BuyInWindow,
  include: (o: T) => boolean = () => true,
): { lf: number; linearValue: number } {
  let lf = 0;
  let linearValue = 0;
  for (const o of orders) {
    if (!include(o)) continue;
    if (!INVOICED_STATUSES.has(o.status)) continue;
    const m = (o.order_date_po ?? o.created_at ?? "").slice(0, 7);
    if (!inBuyInWindow(m, w)) continue;
    const vol = orderVolume(o.items ?? []);
    lf += vol.lf;
    linearValue += vol.convertedValue;
  }
  return { lf, linearValue };
}
