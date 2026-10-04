/**
 * Bangladesh — the ONE home of every Bangladesh-specific rule and reference dataset (Phase 12 W1,
 * docs/PHASE_12_IMPLEMENTATION_CONTRACT.md §10). Moved here verbatim; behaviour is unchanged.
 *
 * This is not a country framework: there is no runtime country switch and nothing selects "a country".
 * It only gives the existing Bangladesh behaviour a single owner, enforced by
 * apps/api/src/domain/config/country-module.guard.test.ts.
 */

/** ISO 3166-1 alpha-2 code (structured data, gateway payloads). */
export const BD_COUNTRY_CODE = "BD";
/** Country name exactly as the payment gateways receive it today. */
export const BD_COUNTRY_NAME = "Bangladesh";
/** International dialling code, digits only. */
export const BD_DIALLING_CODE = "880";
/** The capital: the "inside Dhaka" fee/ETA district, and the gateway city/state fallback used today. */
export const BD_DHAKA = "Dhaka";
/** Gateway customer-city fallback when an order carries none (unchanged value). */
export const BD_DEFAULT_GATEWAY_CITY = BD_DHAKA;

// ── Phones ─────────────────────────────────────────────────────────────────────────────────────

export const PHONE_REGEX = /^01[3-9]\d{8}$/;

/** Folds the ways a customer actually types a BD mobile number — spaces/dashes, a "+880"/"880"/
 * "00880" country code, or a missing leading 0 — down to the one canonical "01XXXXXXXXX" form
 * everything else (SMS sending, order-tracking lookup, courier booking) compares against. Without
 * this, e.g. "+8801999454749" gets stored verbatim and BulkSMSBD silently rejects it later. */
export function normalizeBdPhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("880")) digits = digits.slice(3);
  if (!digits.startsWith("0")) digits = `0${digits}`;
  return digits;
}

export const BD_PHONE_INVALID_MESSAGE = "Enter a valid Bangladeshi phone number";

/** "01XXXXXXXXX" (in any accepted input form) → "8801XXXXXXXXX": international digits, no "+", no trunk 0 — the
 * form BulkSMSBD, Meta CAPI and wa.me links take. Does not validate; callers that must reject non-mobiles check
 * PHONE_REGEX / isBdMobileLocal first. */
export function toBdInternationalDigits(phone: string): string {
  return `88${normalizeBdPhone(phone)}`;
}

/** The loose "01 + 9 digits" shape Meta CAPI accepted before Phase 12 (kept as is: stricter PHONE_REGEX would drop
 * numbers Meta matched before). */
export function isBdMobileLocal(local: string): boolean {
  return /^01\d{9}$/.test(local);
}

// ── Delivery: the Dhaka / outside-Dhaka split ──────────────────────────────────────────────────

/** "Inside Dhaka" means Dhaka district only — not the whole Dhaka division, which also covers
 * Gazipur, Tangail, Faridpur, Kishoreganj etc. that couriers charge (and deliver) at the
 * outside-Dhaka rate. The one place this rule lives: shipping fee, courier return fee and the
 * delivery estimate all go through it. */
export function isInsideDhaka(district: string | null | undefined): boolean {
  return district === "Dhaka";
}

/** Same Dhaka-vs-outside-Dhaka split used for shipping fees — 1–2 business days inside Dhaka,
 * 3–5 outside. Display-only estimate, never stored: the real delivery date depends on real-world
 * logistics, not something we can promise from a formula. */
export const DHAKA_DELIVERY_DAYS: [number, number] = [1, 2];
export const OUTSIDE_DHAKA_DELIVERY_DAYS: [number, number] = [3, 5];

export interface DeliveryEstimate {
  minDays: number;
  maxDays: number;
  minDate: Date;
  maxDate: Date;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function estimateDelivery(district: string, from: Date = new Date()): DeliveryEstimate {
  const [minDays, maxDays] = isInsideDhaka(district) ? DHAKA_DELIVERY_DAYS : OUTSIDE_DHAKA_DELIVERY_DAYS;
  return { minDays, maxDays, minDate: addDays(from, minDays), maxDate: addDays(from, maxDays) };
}

// ── Administrative geography (divisions, districts, areas/thanas) ──────────────────────────────

export const BD_DIVISIONS = [
  "Dhaka",
  "Chattogram",
  "Rajshahi",
  "Khulna",
  "Barishal",
  "Sylhet",
  "Rangpur",
  "Mymensingh",
] as const;

/** All 64 official districts grouped by division — lets the checkout/address forms offer a
 * courier-style cascading picker (division narrows district) instead of free-text district entry,
 * which was a common source of typos and failed deliveries. */
export const BD_DISTRICTS_BY_DIVISION = {
  Dhaka: [
    "Dhaka",
    "Faridpur",
    "Gazipur",
    "Gopalganj",
    "Kishoreganj",
    "Madaripur",
    "Manikganj",
    "Munshiganj",
    "Narayanganj",
    "Narsingdi",
    "Rajbari",
    "Shariatpur",
    "Tangail",
  ],
  Chattogram: [
    "Bandarban",
    "Brahmanbaria",
    "Chandpur",
    "Chattogram",
    "Cumilla",
    "Cox's Bazar",
    "Feni",
    "Khagrachhari",
    "Lakshmipur",
    "Noakhali",
    "Rangamati",
  ],
  Rajshahi: ["Bogura", "Joypurhat", "Naogaon", "Natore", "Chapainawabganj", "Pabna", "Rajshahi", "Sirajganj"],
  Khulna: ["Bagerhat", "Chuadanga", "Jashore", "Jhenaidah", "Khulna", "Kushtia", "Magura", "Meherpur", "Narail", "Satkhira"],
  Barishal: ["Barguna", "Barishal", "Bhola", "Jhalokati", "Patuakhali", "Pirojpur"],
  Sylhet: ["Habiganj", "Moulvibazar", "Sunamganj", "Sylhet"],
  Rangpur: ["Dinajpur", "Gaibandha", "Kurigram", "Lalmonirhat", "Nilphamari", "Panchagarh", "Rangpur", "Thakurgaon"],
  Mymensingh: ["Jamalpur", "Mymensingh", "Netrokona", "Sherpur"],
} as const satisfies Record<(typeof BD_DIVISIONS)[number], readonly string[]>;

/** Every district, alphabetically, regardless of division — lets an address form ask for District
 * directly (skipping the Division step entirely) since Division only matters internally for the
 * Dhaka/outside-Dhaka shipping-fee split, not as something a shopper needs to pick. */
export const BD_ALL_DISTRICTS: readonly string[] = Object.values(BD_DISTRICTS_BY_DIVISION)
  .flat()
  .sort((a, b) => a.localeCompare(b));

/** Reverse lookup of BD_DISTRICTS_BY_DIVISION — given a district, which division it's in. Powers
 * the Dhaka/outside-Dhaka shipping-fee and delivery-estimate logic once Division is no longer a
 * field the shopper fills in directly. */
export const BD_DIVISION_BY_DISTRICT: Record<string, (typeof BD_DIVISIONS)[number]> = Object.fromEntries(
  Object.entries(BD_DISTRICTS_BY_DIVISION).flatMap(([division, districts]) =>
    districts.map((district) => [district, division as (typeof BD_DIVISIONS)[number]]),
  ),
);

/** Upazilas/thanas for every district, plus the metropolitan-police thanas for every district that
 * has a City Corporation (Dhaka, Chattogram, Gazipur, Narayanganj, Rajshahi, Khulna, Barishal,
 * Sylhet, Mymensingh, Rangpur) — since a metro city's own police thanas ("Gulshan", "Boalia",
 * "Kotwali" etc.) are how the vast majority of its addresses are actually written, not the single
 * "X Sadar" upazila name that nominally contains the city. Lets the Area/Thana field cascade the
 * same way District cascades off Division, instead of taking free text that couriers then have to
 * re-key against their own zone list.
 *
 * Cross-checked against Bangladesh's official upazila list (all 64 districts) and each metropolitan
 * police force's current thana roster, including upazilas gazetted as late as July 2026 (Bangra,
 * Fatikchhari North, South Gafargaon, Mokamtola, Ruhia, Bhully, Chandraganj). Matamuhuri (Cox's
 * Bazar) is left out — as of this writing it's still a proposed split of Chakaria, not yet gazetted. */
export const BD_AREAS_BY_DISTRICT: Record<string, readonly string[]> = {
  // Dhaka division
  Dhaka: [
    "Adabor",
    "Ashulia",
    "Badda",
    "Bangshal",
    "Banani",
    "Bhashantek",
    "Bimanbandar",
    "Cantonment",
    "Chackbazar",
    "Dakshinkhan",
    "Darus Salam",
    "Demra",
    "Dhamrai",
    "Dhanmondi",
    "Dohar",
    "Gendaria",
    "Gulshan",
    "Hatirjheel",
    "Hazaribagh",
    "Jatrabari",
    "Kadamtali",
    "Kafrul",
    "Kalabagan",
    "Kamrangirchar",
    "Keraniganj",
    "Khilgaon",
    "Khilkhet",
    "Kotwali",
    "Lalbagh",
    "Mirpur",
    "Mohammadpur",
    "Motijheel",
    "Mugda",
    "Nawabganj",
    "New Market",
    "Pallabi",
    "Paltan",
    "Ramna",
    "Rampura",
    "Rupnagar",
    "Sabujbagh",
    "Savar",
    "Shah Ali",
    "Shahbagh",
    "Shahjahanpur",
    "Sher-e-Bangla Nagar",
    "Shyampur",
    "Sutrapur",
    "Tejgaon",
    "Tejgaon Industrial Area",
    "Turag",
    "Uttara East",
    "Uttara West",
    "Uttarkhan",
    "Vatara",
    "Wari",
  ],
  Faridpur: [
    "Faridpur Sadar",
    "Alfadanga",
    "Bhanga",
    "Boalmari",
    "Charbhadrasan",
    "Madhukhali",
    "Nagarkanda",
    "Sadarpur",
    "Saltha",
  ],
  // Gazipur Sadar upazila itself is split into 8 Gazipur Metropolitan Police thanas (Gazipur City
  // Corporation is large enough to need its own metro police force) plus the 4 outlying upazilas.
  Gazipur: [
    "Bason",
    "Gacha",
    "Gazipur Sadar",
    "Kaliakair",
    "Kaliganj",
    "Kapasia",
    "Kashimpur",
    "Konabari",
    "Pubail",
    "Sreepur",
    "Tongi East",
    "Tongi West",
  ],
  Gopalganj: ["Gopalganj Sadar", "Kashiani", "Kotalipara", "Muksudpur", "Tungipara"],
  Kishoreganj: [
    "Kishoreganj Sadar",
    "Austagram",
    "Bajitpur",
    "Bhairab",
    "Hossainpur",
    "Itna",
    "Karimganj",
    "Katiadi",
    "Kuliarchar",
    "Mithamain",
    "Nikli",
    "Pakundia",
    "Tarail",
  ],
  Madaripur: ["Madaripur Sadar", "Dasar", "Kalkini", "Rajoir", "Shibchar"],
  Manikganj: ["Manikganj Sadar", "Daulatpur", "Ghior", "Harirampur", "Saturia", "Shibalaya", "Singair"],
  Munshiganj: ["Munshiganj Sadar", "Gazaria", "Lohajang", "Sirajdikhan", "Sreenagar", "Tongibari"],
  // Fatullah and Siddhirganj are separate police-station-level thanas within Narayanganj Sadar
  // upazila/City Corporation, not just a sub-area of "Narayanganj Sadar".
  Narayanganj: ["Araihazar", "Bandar", "Fatullah", "Narayanganj Sadar", "Rupganj", "Siddhirganj", "Sonargaon"],
  Narsingdi: ["Narsingdi Sadar", "Belabo", "Monohardi", "Palash", "Raipura", "Shibpur"],
  Rajbari: ["Rajbari Sadar", "Baliakandi", "Goalandaghat", "Kalukhali", "Pangsha"],
  Shariatpur: ["Shariatpur Sadar", "Bhedarganj", "Damudya", "Gosairhat", "Naria", "Zajira"],
  Tangail: [
    "Tangail Sadar",
    "Basail",
    "Bhuapur",
    "Delduar",
    "Dhanbari",
    "Ghatail",
    "Gopalpur",
    "Kalihati",
    "Madhupur",
    "Mirzapur",
    "Nagarpur",
    "Sakhipur",
  ],
  // Chattogram division
  Bandarban: ["Bandarban Sadar", "Alikadam", "Lama", "Naikhongchhari", "Rowangchhari", "Ruma", "Thanchi"],
  Brahmanbaria: [
    "Brahmanbaria Sadar",
    "Akhaura",
    "Ashuganj",
    "Bancharampur",
    "Bijoynagar",
    "Kasba",
    "Nabinagar",
    "Nasirnagar",
    "Sarail",
  ],
  Chandpur: [
    "Chandpur Sadar",
    "Faridganj",
    "Haimchar",
    "Haziganj",
    "Kachua",
    "Matlab Dakshin",
    "Matlab Uttar",
    "Shahrasti",
  ],
  Chattogram: [
    "Akbar Shah",
    "Anwara",
    "Bakalia",
    "Bandar",
    "Banshkhali",
    "Bayazid",
    "Boalkhali",
    "Chandanaish",
    "Chandgaon",
    "Chawkbazar",
    "Double Mooring",
    "EPZ",
    "Fatikchhari",
    "Fatikchhari North",
    "Halishahar",
    "Hathazari",
    "Karnaphuli",
    "Khulshi",
    "Kotwali",
    "Lohagara",
    "Mirsharai",
    "Pahartali",
    "Panchlaish",
    "Patenga",
    "Patiya",
    "Rangunia",
    "Raozan",
    "Sadarghat",
    "Sandwip",
    "Satkania",
    "Sitakunda",
  ],
  Cumilla: [
    "Bangra",
    "Cumilla Adarsha Sadar",
    "Barura",
    "Brahmanpara",
    "Burichang",
    "Chandina",
    "Chauddagram",
    "Cumilla Sadar Dakshin",
    "Daudkandi",
    "Debidwar",
    "Homna",
    "Laksam",
    "Lalmai",
    "Meghna",
    "Monohorgonj",
    "Muradnagar",
    "Nangalkot",
    "Titas",
  ],
  "Cox's Bazar": ["Cox's Bazar Sadar", "Chakaria", "Eidgaon", "Kutubdia", "Maheshkhali", "Pekua", "Ramu", "Teknaf", "Ukhia"],
  Feni: ["Feni Sadar", "Chhagalnaiya", "Daganbhuiyan", "Fulgazi", "Parshuram", "Sonagazi"],
  Khagrachhari: [
    "Khagrachhari Sadar",
    "Dighinala",
    "Guimara",
    "Lakshmichhari",
    "Mahalchhari",
    "Manikchhari",
    "Matiranga",
    "Panchhari",
    "Ramgarh",
  ],
  Lakshmipur: ["Lakshmipur Sadar", "Chandraganj", "Kamalnagar", "Raipur", "Ramganj", "Ramgati"],
  Noakhali: [
    "Noakhali Sadar",
    "Begumganj",
    "Chatkhil",
    "Companiganj",
    "Hatiya",
    "Kabirhat",
    "Senbagh",
    "Sonaimuri",
    "Subarnachar",
  ],
  Rangamati: [
    "Rangamati Sadar",
    "Bagaichhari",
    "Barkal",
    "Belaichhari",
    "Juraichhari",
    "Kaptai",
    "Kawkhali",
    "Langadu",
    "Naniarchar",
    "Rajasthali",
  ],
  // Rajshahi division
  Bogura: [
    "Bogura Sadar",
    "Adamdighi",
    "Dhunat",
    "Dhupchanchia",
    "Gabtali",
    "Kahaloo",
    "Mokamtola",
    "Nandigram",
    "Sariakandi",
    "Shajahanpur",
    "Sherpur",
    "Shibganj",
    "Sonatola",
  ],
  Joypurhat: ["Joypurhat Sadar", "Akkelpur", "Kalai", "Khetlal", "Panchbibi"],
  Naogaon: [
    "Naogaon Sadar",
    "Atrai",
    "Badalgachhi",
    "Dhamoirhat",
    "Mahadebpur",
    "Manda",
    "Niamatpur",
    "Patnitala",
    "Porsha",
    "Raninagar",
    "Sapahar",
  ],
  Natore: ["Natore Sadar", "Bagatipara", "Baraigram", "Gurudaspur", "Lalpur", "Naldanga", "Singra"],
  Chapainawabganj: ["Chapainawabganj Sadar", "Bholahat", "Gomastapur", "Nachole", "Shibganj"],
  Pabna: ["Pabna Sadar", "Atgharia", "Bera", "Bhangura", "Chatmohar", "Faridpur", "Ishwardi", "Santhia", "Sujanagar"],
  // "Rajshahi Sadar" isn't itself an upazila — Rajshahi city is covered by 12 Rajshahi Metropolitan
  // Police thanas (expanded from the original 4 in 2018), listed here alongside the 9 outlying upazilas.
  Rajshahi: [
    "Airport",
    "Bagha",
    "Bagmara",
    "Belpukur",
    "Boalia",
    "Chandrima",
    "Charghat",
    "Damkura",
    "Durgapur",
    "Godagari",
    "Karnahar",
    "Kashiadanga",
    "Katakhali",
    "Mohanpur",
    "Motihar",
    "Paba",
    "Puthia",
    "Rajpara",
    "Shah Makhdum",
    "Tanore",
  ],
  Sirajganj: [
    "Sirajganj Sadar",
    "Belkuchi",
    "Chauhali",
    "Kamarkhanda",
    "Kazipur",
    "Raiganj",
    "Shahjadpur",
    "Tarash",
    "Ullapara",
  ],
  // Khulna division
  Bagerhat: ["Bagerhat Sadar", "Chitalmari", "Fakirhat", "Kachua", "Mollahat", "Mongla", "Morrelganj", "Rampal", "Sarankhola"],
  Chuadanga: ["Chuadanga Sadar", "Alamdanga", "Damurhuda", "Jibannagar"],
  Jashore: ["Jashore Sadar", "Abhaynagar", "Bagherpara", "Chaugachha", "Jhikargachha", "Keshabpur", "Manirampur", "Sharsha"],
  Jhenaidah: ["Jhenaidah Sadar", "Harinakunda", "Kaliganj", "Kotchandpur", "Maheshpur", "Shailkupa"],
  // Khulna Metropolitan Police's 8 thanas cover Khulna city; Khulna Sadar itself isn't an upazila.
  Khulna: [
    "Aranghata",
    "Batiaghata",
    "Dacope",
    "Daulatpur",
    "Dighalia",
    "Dumuria",
    "Harintana",
    "Khalishpur",
    "Khan Jahan Ali",
    "Koyra",
    "Kotwali",
    "Labanchora",
    "Paikgachha",
    "Phultala",
    "Rupsa",
    "Sonadanga",
    "Terokhada",
  ],
  Kushtia: ["Kushtia Sadar", "Bheramara", "Daulatpur", "Khoksa", "Kumarkhali", "Mirpur"],
  Magura: ["Magura Sadar", "Mohammadpur", "Shalikha", "Sreepur"],
  Meherpur: ["Meherpur Sadar", "Gangni", "Mujibnagar"],
  Narail: ["Narail Sadar", "Kalia", "Lohagara"],
  Satkhira: ["Satkhira Sadar", "Assasuni", "Debhata", "Kalaroa", "Kaliganj", "Shyamnagar", "Tala"],
  // Barishal division
  Barguna: ["Barguna Sadar", "Amtali", "Bamna", "Betagi", "Patharghata", "Taltali"],
  // Barishal Metropolitan Police's 4 thanas cover Barishal city; Barishal Sadar itself isn't an upazila.
  Barishal: [
    "Agailjhara",
    "Airport",
    "Babuganj",
    "Bakerganj",
    "Banaripara",
    "Bandar",
    "Gaurnadi",
    "Hizla",
    "Kawnia",
    "Kotwali",
    "Mehendiganj",
    "Muladi",
    "Wazirpur",
  ],
  Bhola: ["Bhola Sadar", "Borhanuddin", "Char Fasson", "Daulatkhan", "Lalmohan", "Manpura", "Tazumuddin"],
  Jhalokati: ["Jhalokati Sadar", "Kathalia", "Nalchity", "Rajapur"],
  Patuakhali: ["Patuakhali Sadar", "Bauphal", "Dashmina", "Dumki", "Galachipa", "Kalapara", "Mirzaganj", "Rangabali"],
  Pirojpur: ["Pirojpur Sadar", "Bhandaria", "Kawkhali", "Mathbaria", "Nazirpur", "Nesarabad", "Zianagar"],
  // Sylhet division
  Habiganj: [
    "Habiganj Sadar",
    "Ajmiriganj",
    "Bahubal",
    "Baniyachong",
    "Chunarughat",
    "Lakhai",
    "Madhabpur",
    "Nabiganj",
    "Shayestaganj",
  ],
  Moulvibazar: ["Moulvibazar Sadar", "Barlekha", "Juri", "Kamalganj", "Kulaura", "Rajnagar", "Sreemangal"],
  Sunamganj: [
    "Sunamganj Sadar",
    "Bishwamvarpur",
    "Chhatak",
    "Derai",
    "Dharampasha",
    "Dowarabazar",
    "Jagannathpur",
    "Jamalganj",
    "Madhyanagar",
    "Shantiganj",
    "Sulla",
    "Tahirpur",
  ],
  // Sylhet Metropolitan Police's 6 thanas cover Sylhet city; Sylhet Sadar itself isn't an upazila.
  Sylhet: [
    "Airport",
    "Balaganj",
    "Beanibazar",
    "Bishwanath",
    "Companiganj",
    "Dakshin Surma",
    "Fenchuganj",
    "Golapganj",
    "Gowainghat",
    "Jaintiapur",
    "Jalalabad",
    "Kanaighat",
    "Kotwali",
    "Moglabazar",
    "Osmani Nagar",
    "Shahparan",
    "South Surma",
    "Zakiganj",
  ],
  // Rangpur division
  Dinajpur: [
    "Dinajpur Sadar",
    "Birampur",
    "Biral",
    "Birganj",
    "Bochaganj",
    "Chirirbandar",
    "Fulbari",
    "Ghoraghat",
    "Hakimpur",
    "Kaharole",
    "Khansama",
    "Nawabganj",
    "Parbatipur",
  ],
  Gaibandha: ["Gaibandha Sadar", "Fulchhari", "Gobindaganj", "Palashbari", "Sadullapur", "Saghata", "Sundarganj"],
  Kurigram: [
    "Kurigram Sadar",
    "Bhurungamari",
    "Char Rajibpur",
    "Chilmari",
    "Nageshwari",
    "Phulbari",
    "Rajarhat",
    "Raomari",
    "Ulipur",
  ],
  Lalmonirhat: ["Lalmonirhat Sadar", "Aditmari", "Hatibandha", "Kaliganj", "Patgram"],
  Nilphamari: ["Nilphamari Sadar", "Dimla", "Domar", "Jaldhaka", "Kishoreganj", "Saidpur"],
  Panchagarh: ["Panchagarh Sadar", "Atwari", "Boda", "Debiganj", "Tetulia"],
  // Rangpur Metropolitan Police's 6 thanas cover Rangpur city; Rangpur Sadar itself isn't an upazila.
  Rangpur: [
    "Badarganj",
    "Gangachara",
    "Hajirhat",
    "Haragach",
    "Kaunia",
    "Kotwali",
    "Mahiganj",
    "Mithapukur",
    "Parshuram",
    "Pirgachha",
    "Pirganj",
    "Tajhat",
    "Taraganj",
  ],
  Thakurgaon: ["Thakurgaon Sadar", "Baliadangi", "Bhully", "Haripur", "Pirganj", "Ranisankail", "Ruhia"],
  // Mymensingh division
  Jamalpur: ["Jamalpur Sadar", "Bakshiganj", "Dewanganj", "Islampur", "Madarganj", "Melandaha", "Sarishabari"],
  // Kotwali and Pagla are the 2 metro thanas covering Mymensingh city; Mymensingh Sadar itself isn't an upazila.
  Mymensingh: [
    "Bhaluka",
    "Dhobaura",
    "Fulbaria",
    "Gafargaon",
    "Gauripur",
    "Haluaghat",
    "Ishwarganj",
    "Kotwali",
    "Muktagachha",
    "Nandail",
    "Pagla",
    "Phulpur",
    "South Gafargaon",
    "Tarakanda",
    "Trishal",
  ],
  Netrokona: [
    "Netrokona Sadar",
    "Atpara",
    "Barhatta",
    "Durgapur",
    "Kalmakanda",
    "Kendua",
    "Khaliajuri",
    "Madan",
    "Mohanganj",
    "Purbadhala",
  ],
  Sherpur: ["Sherpur Sadar", "Jhenaigati", "Nakla", "Nalitabari", "Sreebardi"],
} as const;

const AREA_DISTRICT_SEPARATOR = " — ";

/** Every area/thana across the whole country, paired with its district. */
export const BD_AREA_DISTRICT_PAIRS: readonly { area: string; district: string }[] = Object.entries(
  BD_AREAS_BY_DISTRICT,
)
  .flatMap(([district, areas]) => areas.map((area) => ({ area, district })))
  .sort((a, b) => a.area.localeCompare(b.area) || a.district.localeCompare(b.district));

/** Same data as BD_AREA_DISTRICT_PAIRS, formatted as "Area — District" combo strings. Lets the
 * Area/Thana field offer a single country-wide search before District has been picked — most
 * shoppers know their thana by name but not which of the 64 districts it falls under, so requiring
 * District first was pure friction. Area names are already district-prefixed where they'd otherwise
 * collide (e.g. "Bagerhat Sadar"), so the combined string is effectively unique. */
export const BD_ALL_AREA_OPTIONS: readonly string[] = BD_AREA_DISTRICT_PAIRS.map(
  ({ area, district }) => `${area}${AREA_DISTRICT_SEPARATOR}${district}`,
);

/** Splits a "Area — District" combo string (as produced by BD_ALL_AREA_OPTIONS) back into its
 * parts. Returns null for a plain area name, e.g. one picked after District was already narrowed —
 * callers use that to tell the two cases apart. */
export function parseAreaDistrictOption(value: string): { area: string; district: string } | null {
  const idx = value.lastIndexOf(AREA_DISTRICT_SEPARATOR);
  if (idx === -1) return null;
  return { area: value.slice(0, idx), district: value.slice(idx + AREA_DISTRICT_SEPARATOR.length) };
}
