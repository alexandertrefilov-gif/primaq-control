export type PaymentMethod = "bar" | "karte" | "qr";

export type CartItem = {
  id: string;
  size: string;
  sizeName?: string; // display label at time of sale; falls back to getSizeName(size)
  flavor: string;
  quantity: number;
  unitPriceCents: number;
};

export type Order = {
  id: string;
  createdAt: string;
  items: CartItem[];
  totalCents: number;
  paymentMethod: PaymentMethod;
  dailyNumber: number;
};

export type DailySummary = {
  date: string;
  totalCents: number;
  cashCents: number;
  cardCents: number;
  qrCents: number;
  orderCount: number;
  orders: Order[];
  eventName?: string | null;
  /** Links this day to a PlannedEvent (event-types.ts). Undefined for days
   *  closed before eventId existed, or where no plan matched — eventName
   *  alone remains the fallback for grouping/display in that case. */
  eventId?: string | null;
  eventStartDate?: string | null;
  eventEndDate?: string | null;
  /** 1-based day index within the event's range, e.g. 2 of 3. */
  eventDayIndex?: number | null;
  eventTotalDays?: number | null;
  /** VAT rate (%) in effect when this day was closed. Undefined for days closed
   *  before this field existed — reports fall back to the current VAT setting. */
  vatRate?: number;
};

export type PosState = {
  cart: CartItem[];
  daily: DailySummary;
};
