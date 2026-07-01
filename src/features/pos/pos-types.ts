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
};

export type PosState = {
  cart: CartItem[];
  daily: DailySummary;
};
