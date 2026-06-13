export type SalesLocation = "truck" | "tent";

export type TeamMemberRole = "admin" | "shift_lead" | "sales";

export type ShiftStatus = "planned" | "active" | "closed";

export type InventoryMovementType = "inbound" | "outbound" | "adjustment";

export type PaymentMethod = "cash" | "card" | "other";

export type Shift = {
  id: string;
  date: string;
  status: ShiftStatus;
  locationName: string | null;
  notes: string | null;
  createdAt: string;
};

export type TeamMember = {
  id: string;
  displayName: string;
  role: TeamMemberRole;
  active: boolean;
};

export type Sale = {
  id: string;
  shiftId: string;
  salesLocation: SalesLocation;
  amountCents: number;
  paymentMethod: PaymentMethod;
  createdAt: string;
};

export type SoftServeCounter = {
  id: string;
  shiftId: string;
  salesLocation: SalesLocation;
  count: number;
  updatedAt: string;
};

export type InventoryItem = {
  id: string;
  name: string;
  unit: string;
  active: boolean;
};

export type InventoryMovement = {
  id: string;
  shiftId: string | null;
  itemId: string;
  movementType: InventoryMovementType;
  quantity: number;
  createdAt: string;
};

export type DayClose = {
  id: string;
  shiftId: string;
  closedAt: string;
  totalSalesCents: number;
  softServeTotal: number;
  exportReady: boolean;
};
