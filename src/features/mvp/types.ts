export type SalesArea = "truck" | "tent" | "both";

export type PaymentKind = "cash" | "card" | "free" | "cancel";

export type OrderPaymentMethod = "cash" | "card" | "qr";

export type SumupSettings = {
  enabled: boolean;
  paymentLink: string;
  hintText: string;
};

export type ProductId = string;

export type InventoryItemId =
  | "soft_mix_liter"
  | "cup_small"
  | "cup_medium"
  | "cup_large"
  | "spoon"
  | "topping_material"
  | "napkin"
  | "cleaner";

export type Product = {
  id: ProductId;
  name: string;
  priceCents: number;
};

export type VatRate = 0 | 7 | 19;

export type PackagingType = "Becher" | "Waffel" | "Waffelbecher";
export type MachineLocation = "Wagen" | "Zelt";
export type MachineProductSlot = "A" | "B" | "MIX";

export type SoftServeRecipe = {
  powderKgPerBatch: number;
  waterLitersPerBatch: number;
  mixLitersPerBatch: number;
  packageKg: number | null;
  note?: string;
};

export type SoftServeRecipeTemplate = {
  id: string;
  name: string;
  powderKgPerBatch: number;
  waterLitersPerBatch: number;
  mixLitersPerBatch: number;
  note?: string;
  createdAt: string;
};

export type StockLink = {
  stockFlavorId: string;
  ratio: number;
};

export type StockFlavor = {
  id: string;
  name: string;
  colorHex?: string;
  recipe: SoftServeRecipe;
  recipeTemplateId?: string;
  warningThresholdPortions: number;
  active: boolean;
  portionWeights?: Record<PackagingType, number>;
};

export type SoftServeProduct = Product & {
  machineId?: string;
  machineName?: string;
  slot?: MachineProductSlot;
  /** Expliziter Betreiber-Schalter: true = immer Mix-Sorte, false = nie (Namens-Fallback wird übersprungen), undefined = Namens-Fallback */
  isMixVariant?: boolean;
  aroma: string;
  packagingType: PackagingType;
  packagingSize: string;
  portionGrams: number;
  stockLinks: StockLink[];
  recipe: SoftServeRecipe;
  spoonIncluded: boolean;
  toppingEnabled: boolean;
  toppingPriceCents: number;
  toppingVatRate: VatRate;
  colorHex?: string;
  visibleInSale: boolean;
  nameManuallyEdited: boolean;
  vatRate: VatRate;
};

export type Machine = {
  id: string;
  number: string;
  name: string;
  manualName: boolean;
  location: MachineLocation;
  colorHex?: string;
  active: boolean;
  visibleInSale: boolean;
  products: SoftServeProduct[];
};

export type ProductSettings = Record<
  ProductId,
  {
    priceCents: number;
    vatRate: VatRate;
    active: boolean;
  }
>;

export type Topping = {
  id: string;
  name: string;
  priceCents: number;
  vatRate: VatRate;
  active: boolean;
};

export type ShiftFormData = {
  date: string;
  eventName: string;
  salesArea: SalesArea;
  employees: string[];
  startingCashCents: number;
  mixStartInputs?: Record<ProductId, MixStockInput>;
  deploymentMachines?: ShiftMachineDeployment[];
};

export type Shift = ShiftFormData & {
  id: string;
  createdAt: string;
};

export type SaleTransaction = {
  id: string;
  shiftId?: string;
  orderId?: string;
  itemId?: string;
  originalOrderId?: string;
  originalItemId?: string;
  correctionReason?: string;
  correctedAt?: string;
  productId: ProductId;
  sortId?: string;
  itemNameAtBooking?: string;
  machineNameAtBooking?: string;
  machineDisplayNameAtBooking?: string;
  machineLocationAtBooking?: MachineLocation;
  packageNameAtBooking?: string;
  portionType?: PackagingType;
  unitGrossCents?: number;
  recipeProductId?: ProductId;
  portionGrams?: number;
  grossPriceCents?: number;
  grossTotalCents?: number;
  netTotalCents?: number;
  taxAmountCents?: number;
  taxRateAtBooking?: VatRate;
  toppingId?: string;
  toppingName?: string;
  parentProductId?: ProductId;
  paymentKind: PaymentKind;
  paymentMethod?: OrderPaymentMethod;
  quantity: 1 | -1;
  amountCents: number;
  vatRate?: VatRate;
  bookedAt?: string;
  createdAt: string;
};

export type CurrentOrderItem = {
  id: string;
  shiftId?: string;
  orderId?: string;
  itemId?: string;
  originalOrderId?: string;
  originalItemId?: string;
  correctionReason?: string;
  correctedAt?: string;
  sortId?: string;
  productId: ProductId;
  machineId?: string;
  machineNumber?: string;
  machineNameAtBooking?: string;
  machineDisplayNameAtBooking?: string;
  machineLocationAtBooking?: MachineLocation;
  name: string;
  itemNameAtBooking?: string;
  packagingType?: PackagingType;
  packagingSize?: string;
  portionType?: PackagingType;
  packageNameAtBooking?: string;
  quantity: number;
  unitGrossCents?: number;
  recipeProductId?: ProductId;
  portionGrams?: number;
  unitPriceGrossCents: number;
  grossPriceCents?: number;
  vatRate: VatRate;
  taxRateAtBooking?: VatRate;
  parentProductId?: ProductId;
  toppingName?: string;
  lineTotalGrossCents: number;
  grossTotalCents?: number;
  netTotalCents?: number;
  taxAmountCents?: number;
  vatCents?: number;
  paymentMethod?: OrderPaymentMethod;
  bookedAt?: string;
};

export type CurrentOrder = {
  id?: string;
  title?: string;
  items: CurrentOrderItem[];
  paymentMethod: OrderPaymentMethod;
  cashReceivedCents: number;
  totalGrossCents: number;
  vatCents: number;
  changeDueCents: number;
};

export type DailyOrder = {
  id: string;
  shiftId: string;
  orderNumber: number;
  bookedAt: string;
  createdAt: string;
  status: "completed" | "correction";
  originalOrderId?: string;
  originalItemId?: string;
  correctionReason?: string;
  correctedAt?: string;
  items: CurrentOrderItem[];
  paymentMethod: OrderPaymentMethod;
  cashReceivedCents: number;
  changeDueCents: number;
  paidAmountCents: number;
  totalGrossCents: number;
  totalVatCents: number;
  totalQuantity: number;
};

export type ConsumptionEntry = {
  id: string;
  shiftId: string;
  orderId: string;
  productId: ProductId;
  productName: string;
  inventoryItemId?: InventoryItemId;
  inventoryItemName?: string;
  sourceProductId?: ProductId;
  sourceProductName?: string;
  quantity: number;
  packagingType: PackagingType;
  packagingSize: string;
  recipeProductId?: ProductId;
  portionGrams?: number;
  createdAt: string;
};

export type StockEntryType =
  | "initial"
  | "refill"
  | "correction_initial"
  | "correction_refill"
  | "initial_plus"
  | "initial_minus"
  | "refill_plus"
  | "refill_minus";

export type MixStockMovement = {
  id: string;
  productId: string;
  type: StockEntryType | "start" | "correction";
  liters: number;
  packages?: number;
  reason?: string;
  createdAt: string;
  shiftId?: string;
};

export type EmergencyModeEntry = {
  id: string;
  stockFlavorId: string;
  flavorName: string;
  remainingLiters: number;
  activatedAt: string;
  shiftId?: string;
};

export type MixStockInput = {
  mode: "batches" | "liters" | "correction" | "packages";
  value: number | null;
};

export type ShiftSlotAssignment = {
  slot: "A" | "B";
  stockFlavorId: string;
};

export type ShiftMachineDeployment = {
  machineId: string;
  location?: MachineLocation;
  slots: ShiftSlotAssignment[];
};

export type MixStockLine = {
  productId: ProductId;
  name?: string;
  recipe?: SoftServeRecipe;
  portionGrams?: number;
  startLiters: number;
  refilledLiters: number;
  correctedLiters: number;
};

export type MixStockState = Record<ProductId, MixStockLine>;

export type MaterialCostLine = {
  itemId: string;
  itemName: string;
  unit: string;
  assignedQty: number;
  returnedQty: number;
  lossQty: number;
  consumedQty: number;
  purchasePriceCents: number | null;
  costCents: number | null;
};

export type MaterialCostReport = {
  lines: MaterialCostLine[];
  totalCostCents: number;
};

export type DayReport = {
  id: string;
  createdAt: string;
  shift: Shift;
  endCashCents: number;
  cashDifferenceCents: number;
  totals: MvpTotals;
  inventoryReport: InventoryReport;
  taxReport: TaxReport;
  materialCostReport?: MaterialCostReport;
};

export type MvpState = {
  productConfigVersion: number;
  activeShift: Shift | null;
  transactions: SaleTransaction[];
  currentOrder: CurrentOrder;
  openOrders: CurrentOrder[];
  activeOrderId: string;
  dailySales: {
    orders: DailyOrder[];
  };
  completedOrders: DailyOrder[];
  consumptionEntries: ConsumptionEntry[];
  mixStocks: MixStockState;
  stockFlavors: Record<string, StockFlavor>;
  portionWeights: Record<PackagingType, number>;
  inventory: InventoryState;
  machines: Machine[];
  softServeItems: SoftServeProduct[];
  aromas: string[];
  packagingSizes: Record<PackagingType, string[]>;
  productSettings: ProductSettings;
  salesLayout: ProductId[];
  toppings: Topping[];
  dayReport: DayReport | null;
  reports: DayReport[];
  emergencyMode: Record<string, boolean>;
  emergencyModeLog: EmergencyModeEntry[];
  mixStockMovements: Record<string, MixStockMovement[]>;
  recipeTemplates: SoftServeRecipeTemplate[];
  generalStock: Record<string, GeneralStockItem>;
  generalStockMovements: Record<string, GeneralStockMovement[]>;
  inventoryMovements: Record<string, InventoryMovement[]>;
  materialCategories: MaterialCategory[];
  materialItems: Record<string, MaterialItem>;
  shiftMaterialAssignments: ShiftMaterialAssignment[];
  sumupSettings: SumupSettings;
  favorites: string[];
};

export type ProductTotals = Record<
  ProductId,
  {
    count: number;
    cash: number;
    card: number;
    free: number;
    cancel: number;
    revenueCents: number;
    cashCents: number;
    cardCents: number;
    freeCents: number;
    cancelCents: number;
  }
>;

export type ToppingNameTotal = {
  name: string;
  count: number;
  revenueCents: number;
};

export type MvpTotals = {
  productTotals: ProductTotals;
  totalPieces: number;
  toppingCount: number;
  toppingTotals: ToppingNameTotal[];
  expectedRevenueCents: number;
  softServeRevenueCents: number;
  toppingRevenueCents: number;
  cashCents: number;
  cardCents: number;
  freeCents: number;
  cancelCents: number;
};

export type InventoryItem = {
  id: InventoryItemId;
  name: string;
  unit: string;
};

export type InventoryLine = {
  itemId: InventoryItemId;
  unit: string;
  name?: string;
  active?: boolean;
  quantityOnHand?: number;
  startQuantity: number | null;
  endQuantity: number | null;
  purchasePriceCents: number | null;
};

export type InventoryMovementType =
  | "receipt"
  | "deduction"
  | "assigned_to_shift"
  | "returned_from_shift"
  | "loss"
  | "correction";

export type InventoryMovement = {
  id: string;
  itemId: string;
  type: InventoryMovementType;
  quantity: number;
  date: string;
  reason?: string;
  note?: string;
  shiftId?: string;
  shiftName?: string;
  createdAt: string;
};

export type InventoryState = Record<InventoryItemId, InventoryLine>;

export type MaterialCategoryType =
  | "verkauf_eis"
  | "pflege_reinigung"
  | "zubehoer"
  | "technik_ersatzteile"
  | "sonstiges";

export type MaterialItem = {
  id: string;
  name: string;
  description?: string | null;
  unit: string;
  quantityOnHand: number;
  minQuantity?: number | null;
  purchasePriceCents: number | null;
  note?: string | null;
  active: boolean;
  createdAt: string;
  // Verknüpfung mit Verkaufsprodukten (z.B. "Waffel", "Becher", "Waffelbecher", "Löffel", "topping")
  saleTag?: string;
  // Einkaufseinheit (z.B. "Karton"), Stückzahl pro Einheit (z.B. 1000)
  purchaseUnit?: string;
  itemsPerPurchaseUnit?: number;
};

export type MaterialCategory = {
  id: string;
  name: string;
  type?: MaterialCategoryType;
  defaultUnit?: string;
  itemIds: string[];
};

export type ShiftMaterialAssignment = {
  id: string;
  shiftId: string;
  categoryId: string;
  itemId: string;
  itemName: string;
  unit: string;
  assignedQty: number;
  consumedQty: number;   // Auto-Abzug beim Checkout (Verkauf)
  returnedQty: number;
  lossQty: number;
  lossReason?: string;
  createdAt: string;
  // true = automatisch ohne manuelle Lager-Zuweisung erzeugt (assignedQty === consumedQty,
  // returnedQty/lossQty = 0); quantityOnHand wird in diesem Fall direkt mitgeführt.
  autoTracked?: boolean;
};

export type InventoryUsageLine = {
  itemId: InventoryItemId;
  name: string;
  unit: string;
  expectedQuantity: number;
  actualQuantity: number | null;
  differenceQuantity: number | null;
  purchasePriceCents: number | null;
  estimatedCostCents: number | null;
  warning: string | null;
};

export type InventoryReport = {
  lines: InventoryUsageLine[];
  mixLines: MixInventoryLine[];
  estimatedCostCents: number;
  warnings: string[];
};

export type MixInventoryStatus = "OK" | "Bald leer" | "Nachfüllen" | "Leer" | "Notbetrieb";

export type GeneralStockItem = {
  id: string;
  productName: string;
  flavorName: string;
  flavorId?: string;
  manufacturer?: string;
  recipe: SoftServeRecipe;
  unit: "Pkg" | "kg" | "Stück";
  quantityOnHand: number;
  minQuantity?: number | null;
  purchasePriceCents: number | null;
  note?: string;
  active: boolean;
  createdAt: string;
  lastUpdatedAt: string;
};

export type GeneralStockMovement = {
  id: string;
  itemId: string;
  type: "receipt" | "deduction" | "return";
  quantity: number;
  date: string;
  priceCents?: number | null;
  note?: string;
  createdAt: string;
};

export type MixInventoryLine = {
  productId: ProductId;
  name: string;
  machineName?: string;
  recipe: SoftServeRecipe;
  startLiters: number;
  refilledLiters: number;
  consumedLiters: number;
  remainingLiters: number;
  correctedLiters: number;
  estimatedRemainingPortions: number | null;
  status: MixInventoryStatus;
  isEmergencyMode: boolean;
};

export type TaxLine = {
  productId: ProductId;
  name: string;
  grossCents: number;
  netCents: number;
  vatCents: number;
  vatRate: VatRate;
};

export type TaxReport = {
  grossCents: number;
  netCents: number;
  vatCents: number;
  softServeGrossCents: number;
  toppingGrossCents: number;
  vat7Cents: number;
  vat19Cents: number;
  lines: TaxLine[];
};

export type ReportSummary = {
  reportCount: number;
  grossCents: number;
  netCents: number;
  vatCents: number;
  vat7Cents: number;
  vat19Cents: number;
  cashCents: number;
  cardCents: number;
  softServeRevenueCents: number;
  toppingRevenueCents: number;
  freeCents: number;
  cancelCents: number;
  cashDifferenceCents: number;
  inventoryCostCents: number;
};
