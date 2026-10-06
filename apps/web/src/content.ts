/**
 * Showcase content — PLACEHOLDER, replaced by the BFF in Phase 2.
 *
 * These three entries exist so the shell can be composed and reviewed
 * for restraint (typography, spacing, proportion) before live catalog
 * data arrives. They are NOT inventory: no quantities, no reserving,
 * no checkout reads them. Prices are integer minor units (ADR 0002);
 * formatting is display-only via `packages/money`.
 */

export const AVAILABILITY = [
  "available",
  "reserved",
  "sold",
  "coming_soon",
] as const;

export type Availability = (typeof AVAILABILITY)[number];

export interface ShowcaseProduct {
  readonly slug: string;
  readonly brand: string;
  readonly model: string;
  readonly reference: string;
  /** Integer minor units, e.g. 1250000 = $12,500.00. */
  readonly priceMinor: number;
  readonly currency: string;
  readonly availability: Availability;
}

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  available: "Available",
  reserved: "Reserved",
  sold: "Sold",
  coming_soon: "Coming soon",
};

export const SHOWCASE: readonly ShowcaseProduct[] = [
  {
    slug: "daytona-116500ln",
    brand: "Rolex",
    model: "Cosmograph Daytona",
    reference: "116500LN",
    priceMinor: 1_450_000,
    currency: "USD",
    availability: "available",
  },
  {
    slug: "nautilus-5711",
    brand: "Patek Philippe",
    model: "Nautilus",
    reference: "5711/1A",
    priceMinor: 9_800_000,
    currency: "USD",
    availability: "reserved",
  },
  {
    slug: "royal-oak-15510",
    brand: "Audemars Piguet",
    model: "Royal Oak Selfwinding",
    reference: "15510ST",
    priceMinor: 3_650_000,
    currency: "USD",
    availability: "coming_soon",
  },
];
