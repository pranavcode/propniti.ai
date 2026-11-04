// Fixed reference data for the seed: addresses (real ZIPs, invented street numbers), people names,
// vendors, staff, owners and the chart of accounts. All people and companies are fictional.

export const ORG_ID = "org-summit";
export const ORG_NAME = "Summit Residential Partners";

export const METRO_STATE: Record<string, { state: string; region: string; city: string }> = {
  Austin: { state: "TX", region: "r-tx", city: "Austin" },
  Dallas: { state: "TX", region: "r-tx", city: "Dallas" },
  Atlanta: { state: "GA", region: "r-se", city: "Atlanta" },
  Phoenix: { state: "AZ", region: "r-sw", city: "Phoenix" },
};

// id → [street, city, zip, lat, lng, stories, owner entity]
export const PROPERTY_SITE: Record<string, [string, string, string, number, number, number, string]> = {
  p01: ["2201 E Riverside Dr", "Austin", "78741", 30.2401, -97.7281, 5, "oe01"],
  p02: ["2815 Barton Hills Dr", "Austin", "78704", 30.2524, -97.7836, 3, "oe01"],
  p03: ["1900 Aldrich St", "Austin", "78723", 30.2988, -97.7052, 4, "oe01"],
  p04: ["1450 Cedar Hollow Ln", "Round Rock", "78664", 30.5089, -97.6512, 2, "oe01"],
  p05: ["1712 S Congress Ave", "Austin", "78704", 30.2479, -97.7503, 1, "oe02"],
  p06: ["11501 Domain Point Blvd", "Austin", "78758", 30.4021, -97.7253, 6, "oe02"],
  p07: ["4305 Elm St", "Austin", "78751", 30.3062, -97.7279, 2, "oe03"],
  p08: ["2600 McKinney Ave", "Dallas", "75204", 32.7973, -96.8035, 24, "oe03"],
  p09: ["6820 Gaston Ave", "Dallas", "75214", 32.8126, -96.7547, 3, "oe03"],
  p10: ["412 W Davis St", "Dallas", "75208", 32.7489, -96.8274, 4, "oe03"],
  p11: ["9150 Frisco Station Blvd", "Frisco", "75034", 33.1132, -96.8287, 2, "oe03"],
  p12: ["2350 Stemmons Trl", "Dallas", "75220", 32.8152, -96.8698, 1, "oe02"],
  p13: ["8211 Preston Rd", "Dallas", "75225", 32.8648, -96.8044, 1, "oe02"],
  p14: ["5221 N O'Connor Blvd", "Irving", "75039", 32.8790, -96.9412, 5, "oe02"],
  p15: ["1050 Peachtree St NE", "Atlanta", "30309", 33.7843, -84.3836, 32, "oe04"],
  p16: ["640 Cherokee Ave SE", "Atlanta", "30312", 33.7351, -84.3714, 3, "oe04"],
  p17: ["725 Ponce de Leon Ave NE", "Atlanta", "30306", 33.7726, -84.3651, 5, "oe04"],
  p18: ["210 Church St", "Decatur", "30030", 33.7778, -84.2963, 2, "oe04"],
  p19: ["1100 Howell Mill Rd NW", "Atlanta", "30318", 33.7851, -84.4113, 4, "oe05"],
  p20: ["3340 Peachtree Rd NE", "Atlanta", "30326", 33.8462, -84.3683, 12, "oe05"],
  p21: ["118 Kirkwood Rd NE", "Atlanta", "30317", 33.7546, -84.3263, 1, "oe05"],
  p22: ["4115 E Camelback Rd", "Phoenix", "85018", 33.5091, -111.9932, 3, "oe06"],
  p23: ["801 N 3rd St", "Phoenix", "85004", 33.4581, -112.0702, 5, "oe06"],
  p24: ["1250 E Rio Salado Pkwy", "Tempe", "85281", 33.4307, -111.9214, 4, "oe06"],
  p25: ["7400 E McDowell Rd", "Scottsdale", "85257", 33.4664, -111.9216, 2, "oe06"],
  p26: ["2200 W Chandler Blvd", "Chandler", "85224", 33.3064, -111.8796, 1, "oe07"],
  p27: ["21001 N Tatum Blvd", "Phoenix", "85050", 33.6766, -111.9741, 1, "oe07"],
  p28: ["1820 W Main St", "Mesa", "85201", 33.4148, -111.8665, 2, "oe08"],
  p29: ["2398 E Camelback Rd", "Phoenix", "85016", 33.5094, -112.0296, 8, "oe07"],
  p30: ["5925 W Glendale Ave", "Glendale", "85301", 33.5386, -112.1855, 3, "oe08"],
};

export const OWNERS: [id: string, name: string, kind: string, email: string][] = [
  ["ow01", "Helen Carter", "Individual", "helen.carter@bluebonnet-capital.example"],
  ["ow02", "Lone Star Capital Partners", "Fund", "ir@lonestarcap.example"],
  ["ow03", "The Whitfield Family Office", "Family office", "office@whitfield-family.example"],
  ["ow04", "Peachtree Pension Trust", "Institution", "realestate@ptpt.example"],
  ["ow05", "Marcus & Odessa Grant", "Individual", "grants@grant-holdings.example"],
  ["ow06", "Sonoran Ridge Investors", "Fund", "ops@sonoranridge.example"],
  ["ow07", "Desert Sun Holdings Group", "Institution", "am@desertsun.example"],
  ["ow08", "Valley Housing Collective", "Fund", "finance@valleyhousing.example"],
];

// [id, owner, name, state, reserve dollars]
export const ENTITIES: [string, string, string, string, number][] = [
  ["oe01", "ow01", "Bluebonnet Residential Fund II, LLC", "TX", 60_000],
  ["oe02", "ow02", "Lone Star Commercial Holdings, LLC", "TX", 75_000],
  ["oe03", "ow03", "Trinity Urban Living, LLC", "TX", 80_000],
  ["oe04", "ow04", "Peachtree Residential Partners, LLC", "GA", 70_000],
  ["oe05", "ow05", "Southern Crescent Mixed-Use Fund, LLC", "GA", 40_000],
  ["oe06", "ow06", "Sonoran Multifamily Fund I, LLC", "AZ", 70_000],
  ["oe07", "ow07", "Camelback Commercial Partners, LLC", "AZ", 50_000],
  ["oe08", "ow08", "Valley Workforce Housing, LLC", "AZ", 45_000],
];

export const BANKS = ["First Horizon Bank", "Frost Bank", "Truist", "Western Alliance Bank", "JPMorgan Chase"];

// [number, name, type, parent number]
export const GL: [string, string, "Asset" | "Liability" | "Equity" | "Income" | "Expense", string | null][] = [
  ["1000", "Cash", "Asset", null],
  ["1010", "Cash — operating trust", "Asset", "1000"],
  ["1020", "Cash — security deposits", "Asset", "1000"],
  ["1200", "Accounts receivable — residents", "Asset", null],
  ["1500", "Building improvements", "Asset", null],
  ["2000", "Accounts payable", "Liability", null],
  ["2100", "Security deposits held", "Liability", null],
  ["3000", "Owner equity", "Equity", null],
  ["3100", "Owner distributions", "Equity", "3000"],
  ["4000", "Rental income", "Income", null],
  ["4010", "Commercial base rent", "Income", "4000"],
  ["4100", "Late fees", "Income", null],
  ["4110", "NSF fees", "Income", "4100"],
  ["4200", "Utility reimbursement (RUBS)", "Income", null],
  ["4300", "Parking and storage", "Income", null],
  ["4310", "Pet rent", "Income", null],
  ["4400", "CAM recoveries", "Income", null],
  ["4410", "Tax recoveries", "Income", "4400"],
  ["4420", "Insurance recoveries", "Income", "4400"],
  ["4500", "Application and admin fees", "Income", null],
  ["4900", "Concessions", "Income", null],
  ["6000", "Repairs and maintenance", "Expense", null],
  ["6050", "Make-ready and turnover", "Expense", "6000"],
  ["6100", "Landscaping", "Expense", null],
  ["6150", "Contract services", "Expense", null],
  ["6200", "Utilities — water and sewer", "Expense", null],
  ["6210", "Utilities — electric", "Expense", "6200"],
  ["6220", "Utilities — gas", "Expense", "6200"],
  ["6230", "Trash removal", "Expense", "6200"],
  ["6300", "Management fees", "Expense", null],
  ["6400", "Insurance", "Expense", null],
  ["6500", "Property taxes", "Expense", null],
  ["6600", "Marketing and advertising", "Expense", null],
  ["6700", "Payroll and benefits", "Expense", null],
  ["6900", "Bad debt", "Expense", null],
];
export const gl = (n: string) => `gl-${n}`;

export const FIRST = [
  "Jordan", "Avery", "Maya", "Ethan", "Sofia", "Liam", "Olivia", "Noah", "Isabella", "Mateo", "Amara", "Caleb", "Hannah", "Diego", "Grace",
  "Elijah", "Chloe", "Lucas", "Zoe", "Isaiah", "Priya", "Aiden", "Leah", "Marcus", "Camila", "Owen", "Nadia", "Julian", "Aaliyah", "Gabriel",
  "Ruby", "Samuel", "Imani", "Henry", "Valentina", "Wyatt", "Mila", "Xavier", "Naomi", "Miles", "Layla", "Dominic", "Keisha", "Rohan", "Elena",
  "Tyler", "Fatima", "Brandon", "Mei", "Carlos", "Ashley", "Kenji", "Brianna", "Andre", "Lucia", "Jamal", "Sarah", "Hiroshi", "Tiana", "Victor",
  "Emily", "Omar", "Rachel", "Daniel", "Jasmine", "Ravi", "Megan", "Hector", "Ingrid", "Trevor", "Ana", "Malik", "Claire", "Arjun", "Destiny",
];
export const LAST = [
  "Nguyen", "Garcia", "Johnson", "Patel", "Williams", "Martinez", "Brown", "Lopez", "Davis", "Rodriguez", "Miller", "Hernandez", "Wilson",
  "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis",
  "Robinson", "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Hill", "Flores", "Green", "Adams", "Nelson", "Baker", "Hall",
  "Rivera", "Campbell", "Mitchell", "Carter", "Roberts", "Okafor", "Kim", "Chen", "Singh", "Shah", "Washington", "Brooks", "Reyes", "Morales",
  "Ortiz", "Gutierrez", "Jenkins", "Bell", "Coleman", "Price", "Bennett", "Wood", "Barnes", "Ross", "Henderson", "Cole", "Ellis", "Tran",
];
// Edge cases the UI must render: diacritics, long names, other scripts' romanisations.
export const UNICODE_NAMES: [string, string][] = [
  ["José", "Núñez"], ["Zoë", "Ødegaard"], ["Nguyễn Thị", "Hoa"], ["François", "Lefèvre-Dubois"], ["Siobhán", "Ó Briain"],
  ["Björn", "Åkesson"], ["Chloé", "Brontë"], ["Maximilian Alexander", "Wolfeschlegelsteinhausen-Bergdorff"], ["Łukasz", "Wiśniewski"], ["Ñoño", "Peña"],
];
export const COMMERCIAL_TENANTS: Record<string, string[]> = {
  "Retail strip": ["Juniper & Pine Boutique", "Barrel House Coffee Roasters", "Lone Oak Barbershop", "Paper Lantern Ramen", "Fit Republic Studio", "Copper Kettle Bakery", "Wild Sage Florist", "Sunbelt Mobile Repair", "Trailhead Outfitters", "Little Sprouts Learning Center", "Saguaro Smiles Family Dental", "Indigo Nail Lounge", "Hearth & Hound Pet Supply", "Riverstone Wine Bar", "Blue Agave Cantina", "Northside Cleaners"],
  Office: ["Halvorsen Wealth Advisors", "Brightline Health Partners", "Kestrel Analytics, Inc.", "Meridian Title Co.", "Cobalt Engineering Group", "Greenway Legal, PLLC", "Arbor Insurance Agency", "Summit Physical Therapy", "Northwind Software", "Pioneer Staffing Solutions", "Delta Architects LLP", "Clearwater Family Medicine", "Atlas Logistics Consulting", "Redbud Marketing Collective", "Harbor Point Capital Management, a Delaware Limited Partnership Registered Investment Adviser"],
  "Industrial flex": ["Ridgeline Fabrication", "Southwest Cold Storage", "Precision Parts Supply", "Canyon Craft Brewing Co.", "Velocity Auto Detailing", "Apex Solar Installers", "Prime Cabinetry Works", "Tri-State Medical Distribution", "Ironwood Fitness Equipment", "Copperline Electrical Supply"],
};

// [id, company, trade, contact, metros, 1099]
export const VENDORS: [string, string, string, string, string[], boolean][] = [
  ["v01", "Lone Star Plumbing", "Plumbing", "Luis Ramirez", ["Austin", "Dallas"], true],
  ["v02", "Hill Country HVAC", "HVAC", "Dana Whitaker", ["Austin"], true],
  ["v03", "Capital City Electric", "Electrical", "Ray Okonkwo", ["Austin"], true],
  ["v04", "Green Acres Landscaping", "Landscaping", "Marisol Pena", ["Austin"], true],
  ["v05", "Bright Turn Services", "Turn", "Kelly Ng", ["Austin", "Dallas"], true],
  ["v06", "Metroplex Air & Heat", "HVAC", "Bobby Tran", ["Dallas"], true],
  ["v07", "Trinity Electric Co.", "Electrical", "Angela Price", ["Dallas"], true],
  ["v08", "Big D Lawn & Tree", "Landscaping", "Hector Salas", ["Dallas"], true],
  ["v09", "DFW Appliance Repair", "Appliance", "Sam Patel", ["Dallas", "Austin"], true],
  ["v10", "Peachtree Plumbing & Drain", "Plumbing", "Terrence Hill", ["Atlanta"], true],
  ["v11", "Southern Comfort Heating & Air", "HVAC", "Wade Collins", ["Atlanta"], true],
  ["v12", "Georgia Power Electric Contractors", "Electrical", "Monique Dawson", ["Atlanta"], true],
  ["v13", "Magnolia Grounds Care", "Landscaping", "Earl Jennings", ["Atlanta"], true],
  ["v14", "ATL Make-Ready Pros", "Turn", "Brianna Cole", ["Atlanta"], true],
  ["v15", "Saguaro Plumbing", "Plumbing", "Arturo Mendez", ["Phoenix"], true],
  ["v16", "Desert Cool Air", "HVAC", "Gina Morales", ["Phoenix"], true],
  ["v17", "Sun Valley Electric", "Electrical", "Cody Brandt", ["Phoenix"], true],
  ["v18", "Xeriscape Solutions AZ", "Landscaping", "Rosa Delgado", ["Phoenix"], true],
  ["v19", "Valley Turn & Paint", "Turn", "Jared Fox", ["Phoenix"], true],
  ["v20", "Copper State Pool Service", "Pool", "Nina Alvarez", ["Phoenix", "Austin"], true],
  ["v21", "Guardian Pest Control", "Pest control", "Phil Barker", ["Austin", "Dallas", "Atlanta", "Phoenix"], true],
  ["v22", "Otis-Kone Elevator Services", "Elevator", "Lauren Fisk", ["Austin", "Dallas", "Atlanta", "Phoenix"], true],
  ["v23", "Allied Roofing & Restoration", "Roofing", "Grant Holloway", ["Austin", "Dallas"], true],
  ["v24", "Southeastern Roofing Co.", "Roofing", "Dwayne Marsh", ["Atlanta"], true],
  ["v25", "Rio Flooring Supply & Install", "Flooring", "Elena Ruiz", ["Phoenix", "Austin"], true],
  ["v26", "KeyRight Locksmiths", "Locksmith", "Omar Haddad", ["Dallas", "Austin"], true],
  ["v27", "Buckhead Building Services", "General contractor", "Kendra Wallace", ["Atlanta"], true],
  ["v28", "Cactus General Contracting", "General contractor", "Tony Russo", ["Phoenix"], true],
  ["v29", "Waste Connections of Texas", "Trash", "Account services", ["Austin", "Dallas"], false],
  ["v30", "Republic Services Atlanta", "Trash", "Account services", ["Atlanta"], false],
  ["v31", "Republic Services Phoenix", "Trash", "Account services", ["Phoenix"], false],
  ["v32", "City of Austin Utilities", "Utilities", "Customer care", ["Austin"], false],
  ["v33", "Dallas Water Utilities", "Utilities", "Customer care", ["Dallas"], false],
  ["v34", "Atlanta Dept. of Watershed Management", "Utilities", "Customer care", ["Atlanta"], false],
  ["v35", "City of Phoenix Water Services", "Utilities", "Customer care", ["Phoenix"], false],
  ["v36", "Texas Electric Supply Co-op", "Utilities", "Customer care", ["Austin", "Dallas"], false],
  ["v37", "Southern Peach Energy", "Utilities", "Customer care", ["Atlanta"], false],
  ["v38", "Arizona Desert Power", "Utilities", "Customer care", ["Phoenix"], false],
  ["v39", "Sentinel Property Insurance Co.", "Insurance", "Policy services", ["Austin", "Dallas", "Atlanta", "Phoenix"], false],
  ["v40", "Apartment Listings Network", "Marketing", "Account team", ["Austin", "Dallas", "Atlanta", "Phoenix"], true],
  ["v41", "County Tax Collector (escrow)", "Property tax", "Tax office", ["Austin", "Dallas", "Atlanta", "Phoenix"], false],
  ["v42", "Fixit Fast Handyman", "General", "Marco Diaz", ["Austin", "Dallas"], true],
  ["v43", "Summit Residential Partners (payroll)", "Payroll", "Payroll team", ["Austin", "Dallas", "Atlanta", "Phoenix"], false],
  ["v44", "Facilities Supply Direct", "Supplies", "Order desk", ["Austin", "Dallas", "Atlanta", "Phoenix"], false],
];

// Internal staff beyond the 9 personas. [id, name, title, role, scope_kind, scope_ids]
export const STAFF: [string, string, string, string, string, string[]][] = [
  ["daniel", "Daniel Reyes", "Principal", "principal", "org", []],
  ["priya", "Priya Shah", "Regional manager, Texas", "regional_manager", "region", ["r-tx"]],
  ["marcus", "Marcus Bell", "Property manager", "property_manager", "property", ["p01", "p02", "p03"]],
  ["lena", "Lena Ortiz", "Leasing agent", "leasing_agent", "property", ["p01", "p02", "p03"]],
  ["rachel", "Rachel Moore", "Managing broker", "broker", "org", []],
  ["grace", "Grace Kim", "Senior accountant", "accountant", "org", []],
  ["tom", "Tom Alvarez", "Maintenance supervisor, Texas", "maintenance_supervisor", "region", ["r-tx"]],
  ["sam", "Sam Okafor", "Administrator", "admin", "org", []],
  ["nadia", "Nadia Brooks", "Platform admin", "platform_admin", "platform", []],
  ["s-wanjiru", "Wanjiru Kamau", "Regional manager, Southeast", "regional_manager", "region", ["r-se"]],
  ["s-colton", "Colton Hayes", "Regional manager, Southwest", "regional_manager", "region", ["r-sw"]],
  ["s-ivy", "Ivy Chen", "Property manager", "property_manager", "property", ["p04", "p05", "p06", "p07"]],
  ["s-derek", "Derek Johnson", "Property manager", "property_manager", "property", ["p08", "p09", "p10"]],
  ["s-alma", "Alma Gutierrez", "Property manager", "property_manager", "property", ["p11", "p12", "p13", "p14"]],
  ["s-kofi", "Kofi Mensah", "Property manager", "property_manager", "property", ["p15", "p16", "p17"]],
  ["s-beth", "Bethany Rowe", "Property manager", "property_manager", "property", ["p18", "p19", "p20", "p21"]],
  ["s-ramon", "Ramon Estrada", "Property manager", "property_manager", "property", ["p22", "p23", "p24", "p25"]],
  ["s-tess", "Tess Lindqvist", "Property manager", "property_manager", "property", ["p26", "p27", "p29"]],
  ["s-jalen", "Jalen Wright", "Property manager", "property_manager", "property", ["p28", "p30"]],
  ["s-maria", "Maria Santos", "Leasing agent", "leasing_agent", "property", ["p08", "p09", "p10", "p11"]],
  ["s-tyrone", "Tyrone Banks", "Leasing agent", "leasing_agent", "property", ["p15", "p16", "p17", "p18"]],
  ["s-hailey", "Hailey Brooks", "Leasing agent", "leasing_agent", "property", ["p22", "p23", "p24", "p25"]],
  ["s-yusuf", "Yusuf Ali", "Leasing agent", "leasing_agent", "property", ["p28", "p30", "p04"]],
  ["s-kevin", "Kevin O'Neil", "Staff accountant", "accountant", "org", []],
  ["s-lucy", "Lucy Park", "AP specialist", "accountant", "org", []],
  ["s-rosa", "Rosa Jimenez", "Maintenance supervisor, Southeast", "maintenance_supervisor", "region", ["r-se"]],
  ["s-hank", "Hank Peterson", "Maintenance supervisor, Southwest", "maintenance_supervisor", "region", ["r-sw"]],
];
// Technicians: [id, name, properties]
export const TECHS: [string, string, string[]][] = [
  ["t-andre", "Andre Washington", ["p01", "p02", "p03", "p04"]],
  ["t-billy", "Billy Huang", ["p05", "p06", "p07", "p01"]],
  ["t-curtis", "Curtis Lane", ["p08", "p09", "p10"]],
  ["t-dmitri", "Dmitri Volkov", ["p11", "p12", "p13", "p14"]],
  ["t-emeka", "Emeka Obi", ["p15", "p16", "p17"]],
  ["t-frank", "Frank DeLuca", ["p18", "p19", "p20", "p21"]],
  ["t-gus", "Gustavo Reyes", ["p22", "p23", "p24", "p25"]],
  ["t-harlan", "Harlan Cobb", ["p26", "p27", "p28", "p29", "p30"]],
  ["t-ines", "Ines Duarte", ["p28", "p30", "p24"]],
];

export const INSURERS = ["Sentinel Property Insurance Co.", "Great Plains Mutual", "Harborline Casualty", "Keystone Specialty"];
export const RENTERS_CARRIERS = ["Lemonade", "State Farm", "Assurant", "Allstate", "Toggle", "USAA"];
