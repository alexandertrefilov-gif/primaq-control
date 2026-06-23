"use client";

import { useCallback, useEffect, useState } from "react";
import type { CartItem, DailySummary, Order, PaymentMethod, PosState } from "./pos-types";

const STORAGE_KEY = "primaq-pos-state";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function emptyDaily(): DailySummary {
  return {
    date: todayStr(),
    totalCents: 0,
    cashCents: 0,
    cardCents: 0,
    qrCents: 0,
    orderCount: 0,
    orders: [],
  };
}

function initialState(): PosState {
  return { cart: [], daily: emptyDaily() };
}

function readStorage(): PosState {
  if (typeof window === "undefined") return initialState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState();
    const parsed = JSON.parse(raw) as PosState;
    if (!parsed.daily || parsed.daily.date !== todayStr()) {
      return { cart: parsed.cart ?? [], daily: emptyDaily() };
    }
    return parsed;
  } catch {
    return initialState();
  }
}

function writeStorage(state: PosState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function createId() {
  return `pos_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function usePosStore() {
  const [state, setState] = useState<PosState>(initialState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(readStorage());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeStorage(state);
  }, [state, hydrated]);

  const addToCart = useCallback((sizeId: string, flavorId: string, unitPriceCents: number) => {
    setState((current) => {
      const existing = current.cart.find((i) => i.size === sizeId && i.flavor === flavorId);
      if (existing) {
        return {
          ...current,
          cart: current.cart.map((i) =>
            i.id === existing.id ? { ...i, quantity: i.quantity + 1 } : i
          ),
        };
      }
      const newItem: CartItem = {
        id: createId(),
        size: sizeId,
        flavor: flavorId,
        quantity: 1,
        unitPriceCents,
      };
      return { ...current, cart: [...current.cart, newItem] };
    });
  }, []);

  const removeFromCart = useCallback((id: string) => {
    setState((current) => ({ ...current, cart: current.cart.filter((i) => i.id !== id) }));
  }, []);

  const changeQty = useCallback((id: string, delta: number) => {
    setState((current) => {
      const item = current.cart.find((i) => i.id === id);
      if (!item) return current;
      const newQty = item.quantity + delta;
      if (newQty <= 0) return { ...current, cart: current.cart.filter((i) => i.id !== id) };
      return {
        ...current,
        cart: current.cart.map((i) => (i.id === id ? { ...i, quantity: newQty } : i)),
      };
    });
  }, []);

  const clearCart = useCallback(() => {
    setState((current) => ({ ...current, cart: [] }));
  }, []);

  const bookOrder = useCallback((paymentMethod: PaymentMethod) => {
    setState((current) => {
      if (current.cart.length === 0) return current;
      const totalCents = current.cart.reduce(
        (sum, i) => sum + i.quantity * i.unitPriceCents,
        0
      );
      const order: Order = {
        id: createId(),
        createdAt: new Date().toISOString(),
        items: current.cart,
        totalCents,
        paymentMethod,
      };
      const d = current.daily;
      return {
        cart: [],
        daily: {
          ...d,
          totalCents: d.totalCents + totalCents,
          cashCents: d.cashCents + (paymentMethod === "bar" ? totalCents : 0),
          cardCents: d.cardCents + (paymentMethod === "karte" ? totalCents : 0),
          qrCents: d.qrCents + (paymentMethod === "qr" ? totalCents : 0),
          orderCount: d.orderCount + 1,
          orders: [...d.orders, order],
        },
      };
    });
  }, []);

  const resetDaily = useCallback(() => {
    setState((current) => ({ ...current, daily: emptyDaily() }));
  }, []);

  const voidLastOrder = useCallback(() => {
    setState((current) => {
      const { daily } = current;
      if (daily.orders.length === 0) return current;
      const last = daily.orders[daily.orders.length - 1];
      return {
        ...current,
        daily: {
          ...daily,
          orders: daily.orders.slice(0, -1),
          totalCents: Math.max(0, daily.totalCents - last.totalCents),
          cashCents: Math.max(0, daily.cashCents - (last.paymentMethod === "bar" ? last.totalCents : 0)),
          cardCents: Math.max(0, daily.cardCents - (last.paymentMethod === "karte" ? last.totalCents : 0)),
          qrCents: Math.max(0, daily.qrCents - (last.paymentMethod === "qr" ? last.totalCents : 0)),
          orderCount: Math.max(0, daily.orderCount - 1),
        },
      };
    });
  }, []);

  const cartTotal = state.cart.reduce((sum, i) => sum + i.quantity * i.unitPriceCents, 0);

  return {
    hydrated,
    cart: state.cart,
    daily: state.daily,
    cartTotal,
    addToCart,
    removeFromCart,
    changeQty,
    clearCart,
    bookOrder,
    resetDaily,
    voidLastOrder,
  };
}
