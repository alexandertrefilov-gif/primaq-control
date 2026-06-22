// Central configuration for the POS system.
// Change sizes, flavors, prices and images here — no code changes needed elsewhere.

export type SizeConfig = {
  id: string;
  name: string;
  priceCents: number;
  image: string;
};

export type FlavorConfig = {
  id: string;
  name: string;
  group: string;
  image?: string;
  backgroundColor: string;
  textColor: string;
  isMix?: true;
  mixColors?: [string, string];
};

export const SIZES: SizeConfig[] = [
  { id: "klein",  name: "Klein",  priceCents: 250, image: "/pos/sizes/klein.svg"  },
  { id: "mittel", name: "Mittel", priceCents: 350, image: "/pos/sizes/mittel.svg" },
  { id: "gross",  name: "Groß",   priceCents: 500, image: "/pos/sizes/gross.svg"  },
];

export const FLAVORS: FlavorConfig[] = [
  {
    id: "vanille",
    name: "Vanille",
    group: "machine1",
    image: "/pos/flavors/vanilla.svg",
    backgroundColor: "#FFF3B0",
    textColor: "#5C4200",
  },
  {
    id: "schokolade",
    name: "Schokolade",
    group: "machine1",
    image: "/pos/flavors/chocolate.svg",
    backgroundColor: "#3D1800",
    textColor: "#fff",
  },
  {
    id: "mix-vanille-schoko",
    name: "Mix Vanille/Schoko",
    group: "machine1",
    isMix: true,
    mixColors: ["#FFF3B0", "#3D1800"],
    backgroundColor: "#3D1800",
    textColor: "#fff",
  },
  {
    id: "cheesecake",
    name: "Cheesecake",
    group: "machine2",
    image: "/pos/flavors/cheesecake.svg",
    backgroundColor: "#FFE5A0",
    textColor: "#5C3800",
  },
  {
    id: "erdbeere",
    name: "Erdbeere",
    group: "machine2",
    image: "/pos/flavors/strawberry.svg",
    backgroundColor: "#E8204A",
    textColor: "#fff",
  },
  {
    id: "mix-cheesecake-erdbeere",
    name: "Mix Cheesecake/Erdbeere",
    group: "machine2",
    isMix: true,
    mixColors: ["#FFE5A0", "#E8204A"],
    backgroundColor: "#E8204A",
    textColor: "#fff",
  },
];

export const MACHINE_GROUP_LABELS: Record<string, string> = {
  machine1: "Maschine 1",
  machine2: "Maschine 2",
};

export function getSizeName(id: string): string {
  return SIZES.find((s) => s.id === id)?.name ?? id;
}

export function getFlavorName(id: string): string {
  return FLAVORS.find((f) => f.id === id)?.name ?? id;
}
