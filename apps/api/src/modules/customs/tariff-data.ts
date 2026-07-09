/**
 * Working extract of the SA tariff book (Schedule 1 Part 1) for the launch
 * lanes' common commodities. This is a STARTER DATASET — the full tariff
 * book is published by SARS and must be loaded into the tariff table (and
 * kept current with amendment notices) before classifying outside these
 * headings. Rates here follow the general (non-preferential) column shape;
 * clearing staff must confirm the applicable rate at entry preparation.
 */
export interface TariffLine {
  hsCode: string;
  description: string;
  keywords: string[];
  /** General ad valorem rate, basis points. */
  generalRateBps: number;
}

export const TARIFF_EXTRACT: TariffLine[] = [
  { hsCode: "8471.30", description: "Portable automatic data processing machines (laptops, tablets)", keywords: ["laptop", "notebook", "tablet", "computer", "portable"], generalRateBps: 0 },
  { hsCode: "8517.13", description: "Smartphones", keywords: ["smartphone", "cellphone", "mobile", "phone"], generalRateBps: 0 },
  { hsCode: "8528.72", description: "Reception apparatus for television, colour", keywords: ["television", "tv", "monitor"], generalRateBps: 2500 },
  { hsCode: "6403.99", description: "Footwear with rubber/plastic soles and leather uppers", keywords: ["shoes", "footwear", "sneakers", "boots"], generalRateBps: 3000 },
  { hsCode: "6109.10", description: "T-shirts, singlets, of cotton, knitted", keywords: ["t-shirt", "tshirt", "shirt", "cotton", "apparel", "clothing"], generalRateBps: 4500 },
  { hsCode: "6204.62", description: "Women's trousers of cotton", keywords: ["trousers", "pants", "jeans", "denim"], generalRateBps: 4500 },
  { hsCode: "9403.60", description: "Wooden furniture", keywords: ["furniture", "wooden", "table", "chair", "desk"], generalRateBps: 2000 },
  { hsCode: "8708.29", description: "Parts and accessories of motor vehicle bodies", keywords: ["auto", "vehicle", "car", "parts", "body"], generalRateBps: 2000 },
  { hsCode: "4011.10", description: "New pneumatic tyres, of rubber, for motor cars", keywords: ["tyres", "tires", "tyre", "rubber"], generalRateBps: 3000 },
  { hsCode: "3926.90", description: "Other articles of plastics", keywords: ["plastic", "plastics", "articles"], generalRateBps: 2000 },
  { hsCode: "7308.90", description: "Structures and parts of structures, of iron or steel", keywords: ["steel", "iron", "structure", "beams", "frames"], generalRateBps: 1000 },
  { hsCode: "8501.40", description: "AC motors, single-phase", keywords: ["motor", "electric", "ac"], generalRateBps: 1000 },
  { hsCode: "9503.00", description: "Toys, scale models, puzzles", keywords: ["toys", "toy", "puzzle", "model", "games"], generalRateBps: 0 },
  { hsCode: "2204.21", description: "Wine of fresh grapes, in containers ≤ 2l", keywords: ["wine", "grapes"], generalRateBps: 2500 },
  { hsCode: "8418.10", description: "Combined refrigerator-freezers", keywords: ["fridge", "refrigerator", "freezer", "appliance"], generalRateBps: 3000 },
];
