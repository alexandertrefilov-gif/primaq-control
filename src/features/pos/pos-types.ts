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
  /** VAT rate (%) in effect when this day was closed. Undefined for days closed
   *  before this field existed — reports fall back to the current VAT setting. */
  vatRate?: number;
};

export type PosState = {
  cart: CartItem[];
  daily: DailySummary;
};
