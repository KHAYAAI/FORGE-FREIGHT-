/**
 * UN/LOCODE → coordinates, for plotting corridors on a map.
 *
 * Shipment origins and destinations are stored as UN/LOCODEs (`ZADUR`,
 * `CNSHA`, …). Rendering them geographically needs a gazetteer, and the full
 * UN/LOCODE list is ~110,000 entries — far too much to ship to a browser for a
 * console that only ever touches a few dozen of them.
 *
 * So this is a curated extract: the seaports, airports and inland points that
 * actually appear on the corridors this platform serves — Southern Africa in
 * depth, plus the Asia/Europe/Americas counterparties those corridors trade
 * with. Coordinates are the port or city centroid, rounded to two decimals,
 * which is well inside a pixel at any zoom this map renders.
 *
 * Codes outside this list aren't an error — `lookupLocode` returns null and the
 * map reports them as unmapped rather than guessing at a position. Add entries
 * here as new corridors open.
 */

export interface Place {
  /** UN/LOCODE, five characters: ISO 3166-1 country + three-character place. */
  code: string;
  name: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  lat: number;
  lon: number;
  kind: "SEAPORT" | "INLAND" | "AIRPORT";
}

function p(
  code: string,
  name: string,
  lat: number,
  lon: number,
  kind: Place["kind"] = "SEAPORT",
): Place {
  return { code, name, country: code.slice(0, 2), lat, lon, kind };
}

const LIST: Place[] = [
  // --- South Africa: seaports -------------------------------------------
  p("ZADUR", "Durban", -29.87, 31.03),
  p("ZACPT", "Cape Town", -33.92, 18.42),
  p("ZAPLZ", "Gqeberha (Port Elizabeth)", -33.96, 25.62),
  p("ZAZBA", "Ngqura (Coega)", -33.81, 25.68),
  p("ZAELS", "East London", -33.02, 27.91),
  p("ZARCB", "Richards Bay", -28.79, 32.09),
  p("ZASDB", "Saldanha Bay", -33.02, 17.94),
  p("ZAMZY", "Mossel Bay", -34.18, 22.14),

  // --- South Africa: inland points ---------------------------------------
  p("ZAJNB", "Johannesburg", -26.2, 28.05, "INLAND"),
  p("ZAPRY", "Pretoria", -25.75, 28.19, "INLAND"),
  p("ZABFN", "Bloemfontein", -29.12, 26.21, "INLAND"),
  p("ZAKIM", "Kimberley", -28.74, 24.77, "INLAND"),
  p("ZANLP", "Mbombela (Nelspruit)", -25.47, 30.97, "INLAND"),
  p("ZAPZB", "Pietermaritzburg", -29.6, 30.38, "INLAND"),
  p("ZAPTG", "Polokwane", -23.9, 29.47, "INLAND"),
  p("ZAGRJ", "George", -34.01, 22.38, "INLAND"),
  p("ZAUTN", "Upington", -28.45, 21.26, "INLAND"),

  // --- Rest of Africa -----------------------------------------------------
  p("NAWVB", "Walvis Bay", -22.96, 14.51),
  p("MZMPM", "Maputo", -25.97, 32.57),
  p("MZBEW", "Beira", -19.84, 34.84),
  p("MZMNC", "Nacala", -14.54, 40.67),
  p("TZDAR", "Dar es Salaam", -6.82, 39.28),
  p("KEMBA", "Mombasa", -4.04, 39.67),
  p("KENBO", "Nairobi", -1.29, 36.82, "INLAND"),
  p("AOLAD", "Luanda", -8.81, 13.23),
  p("CGPNR", "Pointe-Noire", -4.79, 11.84),
  p("NGAPP", "Apapa (Lagos)", 6.44, 3.37),
  p("NGLOS", "Lagos", 6.45, 3.39),
  p("NGONN", "Onne", 4.72, 7.15),
  p("GHTEM", "Tema", 5.63, 0.02),
  p("CIABJ", "Abidjan", 5.29, -4.02),
  p("SNDKR", "Dakar", 14.67, -17.43),
  p("EGALY", "Alexandria", 31.2, 29.92),
  p("EGPSD", "Port Said", 31.26, 32.3),
  p("EGSUZ", "Suez", 29.97, 32.55),
  p("MACAS", "Casablanca", 33.6, -7.62),
  p("MAPTM", "Tanger Med", 35.88, -5.5),
  p("DJJIB", "Djibouti", 11.6, 43.15),
  p("ETADD", "Addis Ababa", 9.01, 38.75, "INLAND"),
  p("ZWHRE", "Harare", -17.83, 31.05, "INLAND"),
  p("ZMLUN", "Lusaka", -15.42, 28.28, "INLAND"),
  p("BWGBE", "Gaborone", -24.65, 25.91, "INLAND"),
  p("MWBLZ", "Blantyre", -15.79, 35.01, "INLAND"),

  // --- Asia ---------------------------------------------------------------
  p("CNSHA", "Shanghai", 31.23, 121.47),
  p("CNNGB", "Ningbo", 29.87, 121.55),
  p("CNSZX", "Shenzhen", 22.54, 114.06),
  p("CNYTN", "Yantian", 22.59, 114.27),
  p("CNTAO", "Qingdao", 36.07, 120.38),
  p("CNTXG", "Tianjin (Xingang)", 38.98, 117.71),
  p("CNCAN", "Guangzhou", 23.13, 113.26),
  p("CNXMN", "Xiamen", 24.48, 118.09),
  p("HKHKG", "Hong Kong", 22.32, 114.17),
  p("SGSIN", "Singapore", 1.29, 103.85),
  p("MYPKG", "Port Klang", 3.0, 101.39),
  p("MYTPP", "Tanjung Pelepas", 1.36, 103.55),
  p("THLCH", "Laem Chabang", 13.08, 100.88),
  p("THBKK", "Bangkok", 13.75, 100.5),
  p("VNSGN", "Ho Chi Minh City", 10.78, 106.7),
  p("VNHPH", "Haiphong", 20.86, 106.68),
  p("IDJKT", "Jakarta", -6.21, 106.85),
  p("INNSA", "Nhava Sheva", 18.95, 72.95),
  p("INMUN", "Mundra", 22.84, 69.72),
  p("INMAA", "Chennai", 13.08, 80.28),
  p("INCOK", "Kochi", 9.93, 76.27),
  p("LKCMB", "Colombo", 6.93, 79.86),
  p("BDCGP", "Chattogram", 22.33, 91.83),
  p("PKKHI", "Karachi", 24.86, 67.01),
  p("AEJEA", "Jebel Ali", 25.01, 55.06),
  p("AEDXB", "Dubai", 25.27, 55.3),
  p("OMSOH", "Sohar", 24.49, 56.63),
  p("SAJED", "Jeddah", 21.49, 39.19),
  p("KRPUS", "Busan", 35.18, 129.08),
  p("JPTYO", "Tokyo", 35.65, 139.79),
  p("JPYOK", "Yokohama", 35.45, 139.64),
  p("JPNGO", "Nagoya", 35.09, 136.88),
  p("TWKHH", "Kaohsiung", 22.62, 120.3),

  // --- Europe -------------------------------------------------------------
  p("NLRTM", "Rotterdam", 51.92, 4.48),
  p("DEHAM", "Hamburg", 53.55, 9.99),
  p("DEBRV", "Bremerhaven", 53.54, 8.58),
  p("BEANR", "Antwerp", 51.26, 4.4),
  p("GBFXT", "Felixstowe", 51.96, 1.35),
  p("GBLON", "London", 51.51, -0.13),
  p("GBSOU", "Southampton", 50.9, -1.4),
  p("FRLEH", "Le Havre", 49.49, 0.11),
  p("FRMRS", "Marseille", 43.3, 5.37),
  p("ESVLC", "Valencia", 39.45, -0.33),
  p("ESALG", "Algeciras", 36.13, -5.45),
  p("ESBCN", "Barcelona", 41.38, 2.18),
  p("ITGOA", "Genoa", 44.41, 8.93),
  p("ITSPE", "La Spezia", 44.1, 9.83),
  p("ITGIT", "Gioia Tauro", 38.43, 15.9),
  p("GRPIR", "Piraeus", 37.94, 23.65),
  p("TRIST", "Istanbul", 41.01, 28.98),
  p("TRMER", "Mersin", 36.8, 34.63),
  p("PLGDN", "Gdansk", 54.35, 18.65),
  p("SEGOT", "Gothenburg", 57.71, 11.97),
  p("PTLIS", "Lisbon", 38.72, -9.14),
  p("MTMAR", "Marsaxlokk", 35.83, 14.54),

  // --- Americas -----------------------------------------------------------
  p("USNYC", "New York", 40.71, -74.01),
  p("USLAX", "Los Angeles", 33.74, -118.27),
  p("USLGB", "Long Beach", 33.75, -118.19),
  p("USSAV", "Savannah", 32.08, -81.09),
  p("USHOU", "Houston", 29.76, -95.37),
  p("USMIA", "Miami", 25.77, -80.19),
  p("USCHS", "Charleston", 32.78, -79.93),
  p("USORF", "Norfolk", 36.85, -76.29),
  p("USOAK", "Oakland", 37.8, -122.27),
  p("USSEA", "Seattle", 47.61, -122.33),
  p("CAMTR", "Montreal", 45.5, -73.57),
  p("CAVAN", "Vancouver", 49.28, -123.12),
  p("BRSSZ", "Santos", -23.96, -46.33),
  p("BRRIO", "Rio de Janeiro", -22.91, -43.17),
  p("BRPNG", "Paranagua", -25.52, -48.51),
  p("ARBUE", "Buenos Aires", -34.6, -58.38),
  p("CLVAP", "Valparaiso", -33.05, -71.62),
  p("PECLL", "Callao", -12.05, -77.14),
  p("MXVER", "Veracruz", 19.19, -96.15),
  p("MXZLO", "Manzanillo", 19.05, -104.32),
  p("PAMIT", "Manzanillo (Panama)", 9.37, -79.9),
  p("COCTG", "Cartagena", 10.4, -75.51),

  // --- Oceania ------------------------------------------------------------
  p("AUSYD", "Sydney", -33.87, 151.21),
  p("AUMEL", "Melbourne", -37.81, 144.96),
  p("AUBNE", "Brisbane", -27.47, 153.03),
  p("AUFRE", "Fremantle", -32.06, 115.74),
  p("NZAKL", "Auckland", -36.85, 174.76),
];

const BY_CODE = new Map(LIST.map((place) => [place.code, place]));

/** Returns null for codes outside the extract — callers must handle that. */
export function lookupLocode(code: string): Place | null {
  return BY_CODE.get(code.trim().toUpperCase()) ?? null;
}

/** Human label for a code, falling back to the code itself when unmapped. */
export function placeLabel(code: string): string {
  return lookupLocode(code)?.name ?? code;
}

export const KNOWN_LOCODES: readonly Place[] = LIST;
