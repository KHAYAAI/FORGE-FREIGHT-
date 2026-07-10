/**
 * SA tariff book (Schedule 1 Part 1) reference dataset.
 *
 * PROVENANCE AND LIMITS — read before relying on this for a real entry:
 * This is a curated reference extract (~90 headings) covering the commodity
 * categories most common on African trade-corridor lanes (electronics,
 * textiles/apparel, footwear, vehicles/parts, machinery, foodstuffs,
 * furniture, base metals). General (non-preferential, Most Favoured Nation
 * column) ad valorem rates are given at the band SARS publishes for each
 * heading as of this dataset's last review. It is NOT a verbatim copy of
 * the gazetted schedule, does not include every 8/10-digit tariff
 * subheading, specific/formula duties, anti-dumping margins, rebate items,
 * or SACU/EU/AfCFTA preferential rates. Every classification this produces
 * carries a confidence score for exactly this reason — low-confidence
 * matches and anything outside these headings require human confirmation
 * against the current SARS Schedule 1 before an entry is prepared.
 *
 * Loading the real book: set TARIFF_CSV_PATH to a CSV with columns
 * `hsCode,description,keywords,generalRateBps` (keywords semicolon-
 * separated) exported from SARS eFiling or a licensed tariff data provider.
 * tariff-loader.ts merges it over this extract at boot, keyed by hsCode —
 * so a real book entry always wins over the built-in reference line.
 */
export interface TariffLine {
  hsCode: string;
  description: string;
  keywords: string[];
  /** General ad valorem rate, basis points. */
  generalRateBps: number;
}

export const TARIFF_EXTRACT: TariffLine[] = [
  // --- Chapter 02-04: Foodstuffs -------------------------------------------
  { hsCode: "0201.30", description: "Bovine meat, boneless, fresh or chilled", keywords: ["beef", "meat", "bovine"], generalRateBps: 4000 },
  { hsCode: "0302.11", description: "Trout, fresh or chilled", keywords: ["fish", "trout", "seafood"], generalRateBps: 0 },
  { hsCode: "0402.21", description: "Milk powder, unsweetened", keywords: ["milk", "powder", "dairy"], generalRateBps: 500 },
  { hsCode: "0406.10", description: "Fresh cheese, unripened", keywords: ["cheese", "dairy"], generalRateBps: 1000 },

  // --- Chapter 07-11: Vegetables, fruit, cereals, milling ------------------
  { hsCode: "0713.33", description: "Kidney beans, dried, shelled", keywords: ["beans", "legumes", "dried"], generalRateBps: 0 },
  { hsCode: "0803.90", description: "Bananas, fresh or dried", keywords: ["bananas", "fruit"], generalRateBps: 0 },
  { hsCode: "0805.10", description: "Oranges, fresh or dried", keywords: ["oranges", "citrus", "fruit"], generalRateBps: 0 },
  { hsCode: "1006.30", description: "Semi-milled or wholly milled rice", keywords: ["rice", "grain", "cereal"], generalRateBps: 0 },
  { hsCode: "1101.00", description: "Wheat or meslin flour", keywords: ["flour", "wheat", "milling"], generalRateBps: 200 },

  // --- Chapter 15-22: Fats, prepared foods, beverages ----------------------
  { hsCode: "1507.90", description: "Soya-bean oil, refined", keywords: ["oil", "soya", "cooking oil"], generalRateBps: 1000 },
  { hsCode: "1701.99", description: "Refined cane or beet sugar", keywords: ["sugar", "refined"], generalRateBps: 1500 },
  { hsCode: "1806.32", description: "Chocolate, not filled, in blocks/slabs/bars", keywords: ["chocolate", "confectionery"], generalRateBps: 3700 },
  { hsCode: "2009.11", description: "Frozen orange juice, unfermented", keywords: ["juice", "orange", "beverage"], generalRateBps: 2500 },
  { hsCode: "2204.21", description: "Wine of fresh grapes, in containers ≤ 2l", keywords: ["wine", "grapes"], generalRateBps: 2500 },
  { hsCode: "2203.00", description: "Beer made from malt", keywords: ["beer", "malt", "beverage"], generalRateBps: 3200 },
  { hsCode: "2402.20", description: "Cigarettes containing tobacco", keywords: ["cigarettes", "tobacco"], generalRateBps: 5200 },

  // --- Chapter 25-27: Minerals, salt, fuel ---------------------------------
  { hsCode: "2523.29", description: "Portland cement, other than white", keywords: ["cement", "construction"], generalRateBps: 300 },
  { hsCode: "2710.19", description: "Diesel fuel, petroleum oils", keywords: ["diesel", "fuel", "petroleum"], generalRateBps: 0 },

  // --- Chapter 28-38: Chemicals, pharma, cosmetics -------------------------
  { hsCode: "3004.90", description: "Medicaments, mixed, for retail sale", keywords: ["medicine", "pharma", "medicament", "drugs"], generalRateBps: 0 },
  { hsCode: "3304.99", description: "Beauty or make-up preparations", keywords: ["cosmetics", "makeup", "beauty"], generalRateBps: 1000 },
  { hsCode: "3401.11", description: "Toilet soap, in bars/shapes", keywords: ["soap", "toiletries"], generalRateBps: 1000 },
  { hsCode: "3808.94", description: "Disinfectants, put up for retail sale", keywords: ["disinfectant", "sanitiser", "cleaning"], generalRateBps: 500 },

  // --- Chapter 39-40: Plastics, rubber --------------------------------------
  { hsCode: "3920.10", description: "Plates, sheets, film of polymers of ethylene", keywords: ["plastic sheet", "film", "polyethylene"], generalRateBps: 1500 },
  { hsCode: "3923.21", description: "Sacks and bags, of polymers of ethylene", keywords: ["plastic bags", "packaging"], generalRateBps: 1500 },
  { hsCode: "3926.90", description: "Other articles of plastics", keywords: ["plastic", "plastics", "articles"], generalRateBps: 2000 },
  { hsCode: "4011.10", description: "New pneumatic tyres, of rubber, for motor cars", keywords: ["tyres", "tires", "tyre", "rubber"], generalRateBps: 3000 },
  { hsCode: "4016.99", description: "Other articles of vulcanised rubber", keywords: ["rubber", "gasket", "seal"], generalRateBps: 2000 },

  // --- Chapter 41-43: Leather, furskins --------------------------------------
  { hsCode: "4202.22", description: "Handbags, with outer surface of plastic sheeting", keywords: ["handbag", "bag", "purse"], generalRateBps: 4000 },

  // --- Chapter 44-49: Wood, paper, printed matter -----------------------------
  { hsCode: "4407.11", description: "Coniferous wood, sawn or chipped", keywords: ["timber", "wood", "sawn", "lumber"], generalRateBps: 500 },
  { hsCode: "4818.10", description: "Toilet paper", keywords: ["toilet paper", "tissue"], generalRateBps: 1000 },
  { hsCode: "4901.99", description: "Printed books, brochures, leaflets", keywords: ["books", "printed", "brochure"], generalRateBps: 0 },
  { hsCode: "4820.10", description: "Registers, notebooks, letter pads", keywords: ["notebook", "stationery", "paper"], generalRateBps: 1000 },

  // --- Chapter 50-63: Textiles and apparel (major SA import category) --------
  { hsCode: "5208.52", description: "Woven cotton fabric, printed, ≤200g/m²", keywords: ["cotton fabric", "textile", "woven"], generalRateBps: 2200 },
  { hsCode: "5407.61", description: "Woven fabric of synthetic filament yarn", keywords: ["synthetic fabric", "polyester fabric"], generalRateBps: 2200 },
  { hsCode: "6101.20", description: "Men's overcoats, anoraks, of cotton, knitted", keywords: ["coat", "jacket", "outerwear"], generalRateBps: 4500 },
  { hsCode: "6109.10", description: "T-shirts, singlets, of cotton, knitted", keywords: ["t-shirt", "tshirt", "shirt", "cotton", "apparel", "clothing"], generalRateBps: 4500 },
  { hsCode: "6110.20", description: "Jerseys, pullovers, cardigans, of cotton", keywords: ["jersey", "pullover", "cardigan", "sweater"], generalRateBps: 4500 },
  { hsCode: "6203.42", description: "Men's trousers, bib and brace overalls, of cotton", keywords: ["trousers", "pants", "overalls", "mens"], generalRateBps: 4500 },
  { hsCode: "6204.62", description: "Women's trousers of cotton", keywords: ["trousers", "pants", "jeans", "denim", "womens"], generalRateBps: 4500 },
  { hsCode: "6205.20", description: "Men's shirts, of cotton", keywords: ["shirt", "mens", "cotton shirt"], generalRateBps: 4500 },
  { hsCode: "6211.32", description: "Men's tracksuits, ski suits, swimwear, of cotton", keywords: ["tracksuit", "sportswear", "swimwear"], generalRateBps: 4500 },
  { hsCode: "6302.60", description: "Toilet and kitchen linen, of terry towelling", keywords: ["towel", "linen", "kitchen"], generalRateBps: 2200 },
  { hsCode: "6402.99", description: "Footwear with outer soles and uppers of rubber/plastic", keywords: ["shoes", "footwear", "sandals", "plastic"], generalRateBps: 3000 },
  { hsCode: "6403.99", description: "Footwear with rubber/plastic soles and leather uppers", keywords: ["shoes", "footwear", "sneakers", "boots"], generalRateBps: 3000 },
  { hsCode: "6404.11", description: "Sports footwear, outer soles of rubber/plastic", keywords: ["sports shoes", "sneakers", "trainers"], generalRateBps: 3000 },

  // --- Chapter 68-70: Stone, ceramics, glass ----------------------------------
  { hsCode: "6907.21", description: "Ceramic flags and tiles, water absorption ≤0.5%", keywords: ["tiles", "ceramic", "flooring"], generalRateBps: 3000 },
  { hsCode: "7013.37", description: "Glassware for table/kitchen use, other than glass-ceramics", keywords: ["glassware", "glasses", "kitchenware"], generalRateBps: 1500 },

  // --- Chapter 72-83: Base metals and articles ---------------------------------
  { hsCode: "7213.91", description: "Bars and rods, hot-rolled, iron/non-alloy steel", keywords: ["steel bars", "rebar", "rods"], generalRateBps: 500 },
  { hsCode: "7308.90", description: "Structures and parts of structures, of iron or steel", keywords: ["steel", "iron", "structure", "beams", "frames"], generalRateBps: 1000 },
  { hsCode: "7318.15", description: "Bolts and screws, of iron or steel", keywords: ["bolts", "screws", "fasteners"], generalRateBps: 1500 },
  { hsCode: "7326.90", description: "Other articles of iron or steel", keywords: ["steel articles", "iron articles", "metalwork"], generalRateBps: 1500 },
  { hsCode: "7615.10", description: "Table, kitchen, household articles of aluminium", keywords: ["aluminium", "cookware", "kitchenware"], generalRateBps: 1500 },

  // --- Chapter 84-85: Machinery, electronics (major import category) ----------
  { hsCode: "8415.10", description: "Air conditioning machines, window/wall type", keywords: ["aircon", "air conditioner", "hvac"], generalRateBps: 1000 },
  { hsCode: "8418.10", description: "Combined refrigerator-freezers", keywords: ["fridge", "refrigerator", "freezer", "appliance"], generalRateBps: 3000 },
  { hsCode: "8443.32", description: "Printers, capable of connecting to a computer/network", keywords: ["printer", "computer peripheral"], generalRateBps: 0 },
  { hsCode: "8450.11", description: "Fully automatic washing machines, ≤10kg dry linen", keywords: ["washing machine", "appliance", "laundry"], generalRateBps: 1500 },
  { hsCode: "8471.30", description: "Portable automatic data processing machines (laptops, tablets)", keywords: ["laptop", "notebook", "tablet", "computer", "portable"], generalRateBps: 0 },
  { hsCode: "8471.50", description: "Processing units for automatic data processing machines", keywords: ["cpu", "processor", "computer parts"], generalRateBps: 0 },
  { hsCode: "8501.40", description: "AC motors, single-phase", keywords: ["motor", "electric", "ac"], generalRateBps: 1000 },
  { hsCode: "8504.40", description: "Static converters (chargers, inverters, power supplies)", keywords: ["charger", "power supply", "inverter", "adapter"], generalRateBps: 0 },
  { hsCode: "8507.60", description: "Lithium-ion accumulators (batteries)", keywords: ["battery", "lithium", "power bank"], generalRateBps: 0 },
  { hsCode: "8515.31", description: "Fully or partly automatic machines for arc welding of metals", keywords: ["welding machine", "welder"], generalRateBps: 500 },
  { hsCode: "8517.13", description: "Smartphones", keywords: ["smartphone", "cellphone", "mobile", "phone"], generalRateBps: 0 },
  { hsCode: "8518.30", description: "Headphones and earphones", keywords: ["headphones", "earphones", "earbuds"], generalRateBps: 0 },
  { hsCode: "8528.72", description: "Reception apparatus for television, colour", keywords: ["television", "tv", "monitor"], generalRateBps: 2500 },
  { hsCode: "8544.42", description: "Electric conductors, fitted with connectors, ≤1000V", keywords: ["cable", "wire", "connector"], generalRateBps: 1000 },

  // --- Chapter 86-89: Vehicles, vessels, aircraft (major import category) -----
  { hsCode: "8701.91", description: "Agricultural tractors, ≤18kW", keywords: ["tractor", "agricultural", "farm equipment"], generalRateBps: 0 },
  { hsCode: "8703.23", description: "Motor cars, spark-ignition engine, 1500-3000cc", keywords: ["car", "sedan", "vehicle", "motor car"], generalRateBps: 2500 },
  { hsCode: "8704.21", description: "Diesel goods vehicles, GVW ≤5 tonnes", keywords: ["truck", "bakkie", "pickup", "goods vehicle"], generalRateBps: 2500 },
  { hsCode: "8708.29", description: "Parts and accessories of motor vehicle bodies", keywords: ["auto", "vehicle", "car", "parts", "body"], generalRateBps: 2000 },
  { hsCode: "8708.30", description: "Brakes and servo-brakes, and parts thereof", keywords: ["brakes", "brake pads", "auto parts"], generalRateBps: 2000 },
  { hsCode: "8711.20", description: "Motorcycles, 50-250cc reciprocating piston engine", keywords: ["motorcycle", "motorbike", "scooter"], generalRateBps: 0 },

  // --- Chapter 90-92: Optical, medical, precision instruments -----------------
  { hsCode: "9018.90", description: "Other instruments and appliances for medical use", keywords: ["medical device", "medical equipment"], generalRateBps: 0 },
  { hsCode: "9028.30", description: "Electricity meters", keywords: ["meter", "electricity meter"], generalRateBps: 500 },

  // --- Chapter 94-96: Furniture, toys, misc manufactured ------------------------
  { hsCode: "9401.61", description: "Upholstered seats with wooden frames", keywords: ["chair", "seat", "furniture", "upholstered"], generalRateBps: 2000 },
  { hsCode: "9403.20", description: "Metal furniture", keywords: ["metal furniture", "cabinet", "shelving"], generalRateBps: 2000 },
  { hsCode: "9403.60", description: "Wooden furniture", keywords: ["furniture", "wooden", "table", "chair", "desk"], generalRateBps: 2000 },
  { hsCode: "9404.30", description: "Sleeping bags", keywords: ["sleeping bag", "camping"], generalRateBps: 3000 },
  { hsCode: "9503.00", description: "Toys, scale models, puzzles", keywords: ["toys", "toy", "puzzle", "model", "games"], generalRateBps: 0 },
  { hsCode: "9506.62", description: "Inflatable balls (footballs, basketballs)", keywords: ["ball", "football", "basketball", "sports"], generalRateBps: 0 },
];
