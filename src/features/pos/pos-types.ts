export type PaymentMethod = "bar" | "karte" | "qr";

export type CartItem = {
  id: string;
  size: string;
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
};

export type DailySummary = {
  date: string;
  totalCents: number;
  cashCents: number;
  cardCents: number;
  qrCents: number;
  orderCount: number;
  orders: Order[];
};

export type PosState = {
  cart: CartItem[];
  daily: DailySummary;
};
