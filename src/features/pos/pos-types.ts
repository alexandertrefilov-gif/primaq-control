export type Size = "klein" | "mittel" | "gross";
export type Flavor =
  | "vanille"
  | "schokolade"
  | "mix-vanille-schoko"
  | "cheesecake"
  | "erdbeere"
  | "mix-cheesecake-erdbeere";
export type PaymentMethod = "bar" | "karte" | "qr";

export const SIZES: Record<Size, { label: string; priceCents: number }> = {
  klein: { label: "Klein", priceCents: 250 },
  mittel: { label: "Mittel", priceCents: 350 },
  gross: { label: "Groß", priceCents: 500 },
};

export const FLAVORS: Record<Flavor, { label: string }> = {
  vanille: { label: "Vanille" },
  schokolade: { label: "Schokolade" },
  "mix-vanille-schoko": { label: "Mix Vanille/Schoko" },
  cheesecake: { label: "Cheesecake" },
  erdbeere: { label: "Erdbeere" },
  "mix-cheesecake-erdbeere": { label: "Mix Cheesecake/Erdbeere" },
};

export const SIZE_ORDER: Size[] = ["klein", "mittel", "gross"];
export const FLAVOR_ORDER: Flavor[] = [
  "vanille",
  "schokolade",
  "mix-vanille-schoko",
  "cheesecake",
  "erdbeere",
  "mix-cheesecake-erdbeere",
];

export type CartItem = {
  id: string;
  size: Size;
  flavor: Flavor;
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
