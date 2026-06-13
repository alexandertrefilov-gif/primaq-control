import type {
  InventoryItem,
  InventoryItemId,
  Machine,
  MachineProductSlot,
  PackagingType,
  Product,
  ProductId,
  ProductSettings,
  SoftServeProduct,
  Topping
} from "./types";

export const defaultSoftServeRecipe = {
  powderKgPerBatch: 2,
  waterLitersPerBatch: 4,
  mixLitersPerBatch: 6,
  packageKg: 2
};

export const products: Product[] = [
  { id: "soft_small", name: "Softeis klein", priceCents: 300 },
  { id: "soft_medium", name: "Softeis mittel", priceCents: 400 },
  { id: "soft_large", name: "Softeis gross", priceCents: 500 },
  { id: "topping", name: "Topping", priceCents: 50 }
];

export const defaultAromas = ["Vanille", "Schokolade", "Erdbeere", "Karamell", "Mix"];

export const defaultPortionWeights: Record<PackagingType, number> = {
  Waffel: 160,
  Waffelbecher: 170,
  Becher: 140
};

export const defaultPackagingSizes: Record<PackagingType, string[]> = {
  Becher: ["120cc", "160cc", "200cc"],
  Waffel: ["klein", "mittel", "groß"],
  Waffelbecher: ["klein", "mittel", "groß"]
};

export function buildSoftServeName(aroma: string, packagingType: PackagingType, packagingSize: string) {
  return `Softeis ${aroma} ${packagingType} ${packagingSize}`.trim();
}

export function createBlankSoftServeProduct(id = "soft_base"): SoftServeProduct {
  return {
    id,
    name: "",
    priceCents: 0,
    vatRate: 7,
    aroma: "Vanille",
    packagingType: "Becher",
    packagingSize: "120cc",
    portionGrams: 0,
    stockLinks: [],
    recipe: defaultSoftServeRecipe,
    spoonIncluded: true,
    toppingEnabled: false,
    toppingPriceCents: 0,
    toppingVatRate: 7,
    colorHex: undefined,
    visibleInSale: false,
    nameManuallyEdited: true
  };
}

export function createMachineProduct(machineId: string, machineName: string, slot: MachineProductSlot): SoftServeProduct {
  return {
    ...createBlankSoftServeProduct(`${machineId}_${slot.toLowerCase()}`),
    machineId,
    machineName,
    slot,
    name: "",
    visibleInSale: false,
    nameManuallyEdited: true
  };
}

export function createCustomMachineProduct(machineId: string, machineName: string, id: string): SoftServeProduct {
  return {
    ...createBlankSoftServeProduct(id),
    machineId,
    machineName,
    name: "",
    visibleInSale: true,
    nameManuallyEdited: true
  };
}

export function createBlankMachine(id = "machine_base", name = "Gelmatic 1", number = "1"): Machine {

  return {
    id,
    number,
    name,
    manualName: false,
    location: "Wagen",
    colorHex: undefined,
    active: true,
    visibleInSale: true,
    products: []
  };
}

export const defaultSoftServeItems: SoftServeProduct[] = [];

export const defaultSalesLayout: ProductId[] = [
  "soft_medium",
  "soft_small",
  "soft_large",
];

export const softServeProducts = defaultSoftServeItems;

export const defaultToppings: Topping[] = [];

export const defaultProductSettings: ProductSettings = products.reduce(
  (acc, product) => ({
    ...acc,
    [product.id]: {
      priceCents: product.priceCents,
      vatRate: product.id === "topping" ? 19 : 7,
      active: true
    }
  }),
  {} as ProductSettings
);

export const paymentLabels = {
  cash: "Barzahlung",
  card: "Kartenzahlung",
  free: "Gratis",
  cancel: "Storno"
} as const;

export const salesAreaLabels = {
  truck: "Wagen",
  tent: "Zelt",
  both: "Beide"
} as const;

export const softMixInventoryItemId: InventoryItemId = "soft_mix_liter";

export const inventoryItems: InventoryItem[] = [
  { id: softMixInventoryItemId, name: "Softeis-Mix Liter", unit: "L" },
  { id: "cup_small", name: "Becher klein", unit: "Stk." },
  { id: "cup_medium", name: "Becher mittel", unit: "Stk." },
  { id: "cup_large", name: "Becher gross", unit: "Stk." },
  { id: "spoon", name: "Loeffel", unit: "Stk." },
  { id: "topping_material", name: "Toppings", unit: "kg" },
  { id: "napkin", name: "Servietten", unit: "Stk." },
  { id: "cleaner", name: "Reinigungsmittel", unit: "L" }
];

export const inventoryDisplayItems = inventoryItems.filter((item) => item.id !== softMixInventoryItemId);

export function isGenericSoftMixInventoryName(name: string | undefined) {
  if (!name) {
    return false;
  }

  const normalized = name.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized === "mix" || normalized === "softeis-mix liter";
}

// Verbrauchsregeln: PackagingType → welche MaterialItem-saleTags werden pro Verkauf verbraucht
// saleTags müssen beim jeweiligen MaterialItem hinterlegt sein.
export const packagingConsumptionRules: Record<PackagingType, { saleTag: string; qty: number }[]> = {
  Waffel: [{ saleTag: "Waffel", qty: 1 }],
  Waffelbecher: [{ saleTag: "Waffelbecher", qty: 1 }],
  // Becher: inkl. Löffel (kann durch Nicht-Vergabe des saleTag "Löffel" deaktiviert werden)
  Becher: [{ saleTag: "Becher", qty: 1 }, { saleTag: "Löffel", qty: 1 }],
};

// Löffel-saleTag: wird verbraucht wenn spoonIncluded=true (Becher-Produkte)
export const LOESSEL_SALE_TAG = "Löffel";

// Servietten-saleTag: 1 pro Verkaufsvorgang (wenn konfiguriert)
export const SERVIETTEN_SALE_TAG = "Serviette";

// Topping-saleTag
export const TOPPING_SALE_TAG = "topping";

export const recipes: Record<ProductId, Partial<Record<InventoryItemId, number>>> = {
  soft_small: {
    soft_mix_liter: 0.12,
    cup_small: 1,
    spoon: 1
  },
  soft_medium: {
    soft_mix_liter: 0.18,
    cup_medium: 1,
    spoon: 1
  },
  soft_large: {
    soft_mix_liter: 0.25,
    cup_large: 1,
    spoon: 1
  },
  topping: {
    topping_material: 0.03
  }
};
