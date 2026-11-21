export const ITEMS = {
  tailwind: { name: 'Energy Drink', cost: 4, text: '+3 to this roll', usable: true },
  twin: { name: 'Double Shot', cost: 8, text: 'Roll two dice', usable: true },
  umbrella: { name: 'Hoodie', cost: 3, text: 'Shrugs off the next bummer', usable: false },
} as const;

export type ItemId = keyof typeof ITEMS;
export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
export const MAX_ITEMS = 2;

export function isItemId(value: unknown): value is ItemId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ITEMS, value);
}
