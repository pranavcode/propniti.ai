// Static, client-safe catalog for the public site: metros, amenity filters, the pet rule and
// neighborhood copy. Neighborhood copy describes places and getting around, never the people who
// live there (Fair Housing Act advertising rules).

export const METROS = ["Austin", "Dallas", "Atlanta", "Phoenix"] as const;
export type Metro = (typeof METROS)[number];

export const METRO_INFO: Record<Metro, { state: string; lon: number; lat: number }> = {
  Austin: { state: "TX", lon: -97.74, lat: 30.27 },
  Dallas: { state: "TX", lon: -96.8, lat: 32.78 },
  Atlanta: { state: "GA", lon: -84.39, lat: 33.75 },
  Phoenix: { state: "AZ", lon: -112.07, lat: 33.45 },
};

// Equirectangular projection of the lower 48 into a 465 × 260 box (lon scaled by cos 38°).
export const project = (lon: number, lat: number) => ({ x: Math.round((lon + 125) * 7.88 * 10) / 10, y: Math.round((50 - lat) * 10 * 10) / 10 });

// Coarse outline of the contiguous US, clockwise from the Pacific Northwest. Decorative only.
const OUTLINE: [number, number][] = [
  [-124.7, 48.4], [-124.1, 46.3], [-124.4, 42.8], [-123.8, 39.8], [-122.4, 37.2], [-120.6, 34.6], [-117.1, 32.5], [-114.7, 32.7], [-111.1, 31.3], [-108.2, 31.3],
  [-106.5, 31.8], [-104.5, 29.6], [-103, 29], [-101.4, 29.8], [-99.5, 27.5], [-97.4, 25.9], [-97.4, 27.8], [-95, 29.3], [-93.8, 29.7], [-91, 29.2], [-89.4, 29],
  [-89.6, 30.2], [-88, 30.4], [-85.3, 29.7], [-84, 30], [-82.8, 28], [-81.8, 26.1], [-80.4, 25.2], [-80, 26.8], [-81.2, 29.6], [-81.4, 30.7], [-80.9, 32.1],
  [-78.9, 33.6], [-76.5, 34.7], [-75.5, 35.3], [-76, 36.9], [-75.9, 38], [-74.9, 38.9], [-74, 40.5], [-72, 41.1], [-70, 41.7], [-70.6, 42.6], [-70.7, 43.1],
  [-69, 44], [-67, 44.8], [-67.8, 47.1], [-69.2, 47.4], [-71.5, 45], [-74.7, 45], [-76.4, 44.2], [-79, 43.3], [-79.1, 42.8], [-82.7, 41.6], [-83, 42.3],
  [-82.5, 45.3], [-84.6, 46.5], [-88.4, 48.3], [-89.6, 48], [-95.2, 49], [-123, 49], [-123.3, 48.3],
];
export const US_PATH = OUTLINE.map(([lon, lat], i) => {
  const { x, y } = project(lon, lat);
  return `${i ? "L" : "M"}${x} ${y}`;
}).join(" ") + " Z";

// Renter-facing amenity filters, each matched against the property's amenity list.
export const AMENITY_FILTERS = {
  laundry: { label: "In-unit laundry", match: ["In-unit laundry"] },
  parking: { label: "Parking", match: ["Attached garages", "Off-street parking", "Ample parking"] },
  pool: { label: "Pool", match: ["Pool", "Resort-style pool"] },
  gym: { label: "Fitness center", match: ["Fitness center"] },
  packages: { label: "Package lockers", match: ["Package lockers"] },
  access: { label: "Controlled access", match: ["Controlled access"] },
  cowork: { label: "Co-working lounge", match: ["Co-working lounge"] },
  rooftop: { label: "Rooftop deck", match: ["Rooftop deck"] },
  yard: { label: "Private yard", match: ["Private yards"] },
} as const;
export type AmenityKey = keyof typeof AMENITY_FILTERS;

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
const has = (alias: string, names: readonly string[]) => `EXISTS (SELECT 1 FROM json_each(${alias}.amenities) AS a WHERE a.value IN (${names.map(quote).join(", ")}))`;

export const amenityMatch = (key: AmenityKey, alias: string) => has(alias, AMENITY_FILTERS[key].match);

// Pet-friendly: communities with pet amenities, plus homes with their own yard or door.
const PET_AMENITIES = ["Dog park", "Pet spa", "Private yards"];
const PET_TYPES = ["Townhomes", "Small residential", "Garden multifamily"];
export const petsSql = (alias: string) => `(${has(alias, PET_AMENITIES)} OR ${alias}.type IN (${PET_TYPES.map(quote).join(", ")}))`;

export const homeKind = (type: string) => (type === "Townhomes" ? "Townhome" : type === "Small residential" ? "House" : "Apartment");
export const bedLabel = (beds: number) => (beds === 0 ? "Studio" : `${beds} bed`);
export const bathLabel = (baths: number) => `${Number.isInteger(baths) ? baths : baths.toFixed(1)} bath`;

const NEIGHBORHOODS: Record<string, string> = {
  "East Riverside": "Minutes from Lady Bird Lake's hike-and-bike trail and the Oltorf and Riverside bus lines, with a quick drive downtown or to the airport.",
  "Barton Hills": "Next to the Barton Creek Greenbelt and Zilker Park, with Barton Springs Pool and South Lamar's restaurants a short drive away.",
  Mueller: "A walkable planned neighborhood around Mueller Lake Park, with a weekly farmers market, a grocery store and the Dell Children's medical campus.",
  "Round Rock": "Near Dell Diamond, Old Settlers Park and the La Frontera shops, with I-35 and Toll 45 for the drive into Austin.",
  "Hyde Park": "Tree-lined streets north of the University of Texas campus, close to Shipe Park, Duval Street cafes and the 1 and 7 bus routes.",
  Uptown: "On the McKinney Avenue trolley line, steps from the Katy Trail and Klyde Warren Park, with downtown Dallas a short ride away.",
  Lakewood: "Close to White Rock Lake's 9-mile loop trail, the Lakewood Shopping Center and the Dallas Arboretum.",
  "Bishop Arts": "In a district of independent shops, galleries and restaurants in Oak Cliff, with the streetcar to downtown nearby.",
  Frisco: "Near The Star, Toyota Stadium and the Stonebriar Centre, with the Dallas North Tollway for commuting south.",
  Midtown: "On Peachtree Street near Piedmont Park, the High Museum and the Midtown and Arts Center MARTA stations.",
  "Grant Park": "Beside Grant Park and Zoo Atlanta, with the Beltline's Eastside Trail and Glenwood Park's restaurants nearby.",
  "Old Fourth Ward": "On the Beltline's Eastside Trail by Ponce City Market and Historic Fourth Ward Park.",
  Decatur: "A few blocks from Decatur Square's restaurants and the Decatur MARTA station, with Agnes Scott College nearby.",
  "West Midtown": "In a former industrial district of restaurants and design shops along Howell Mill Road, near Georgia Tech.",
  Kirkwood: "Bungalow streets near Bessie Branham Park and the Kirkwood shops, with Edgewood's retail and the East Lake MARTA station close by.",
  Arcadia: "At the foot of Camelback Mountain, close to the Arizona Canal path and Indian School Road's restaurants.",
  Downtown: "On Roosevelt Row's arts district, near the light rail, Chase Field and the ASU Downtown campus.",
  Tempe: "Across from Tempe Town Lake, near Mill Avenue, the ASU campus and light rail to Phoenix and Mesa.",
  Scottsdale: "Close to Old Town Scottsdale, the Indian Bend Wash greenbelt and Loop 101.",
  Mesa: "Near the Mesa Riverview shops and the light rail on Main Street, with Loop 202 and US 60 nearby.",
  Glendale: "Near Westgate Entertainment District and State Farm Stadium, with Loop 101 for getting around the West Valley.",
};

export const neighborhoodBlurb = (neighborhood: string, metro: string) =>
  NEIGHBORHOODS[neighborhood] ?? `In ${neighborhood}, ${metro}. Ask the leasing team about transit and nearby services.`;
