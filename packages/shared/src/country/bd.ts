/**
 * Bangladesh — the ONE home of every Bangladesh-specific rule and reference dataset (Phase 12 W1,
 * docs/history/PHASE_12_IMPLEMENTATION_CONTRACT.md §10). Moved here verbatim; behaviour is unchanged.
 *
 * This is not a country framework: there is no runtime country switch and nothing selects "a country".
 * It only gives the existing Bangladesh behaviour a single owner, enforced by
 * apps/api/src/domain/config/country-module.guard.test.ts.
 */

import { BD_AREA_NAMES_BN } from "./bd-area-names-bn";

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

/** An international number as WhatsApp gives it (digits, no "+", e.g. "8801812345678") → "01812345678" for a
 * Bangladeshi number, "+<digits>" for any other country (kept intact, never folded into a local form). */
export function phoneFromInternationalDigits(digits: string): string {
  return digits.startsWith("880") ? normalizeBdPhone(digits) : `+${digits}`;
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
 * 2–5 outside. Display-only estimate, never stored: the real delivery date depends on real-world
 * logistics, not something we can promise from a formula. */
export const DHAKA_DELIVERY_DAYS: [number, number] = [1, 2];
export const OUTSIDE_DHAKA_DELIVERY_DAYS: [number, number] = [2, 5];

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

/** The customer-facing delivery-time sentence, built from the same day ranges as estimateDelivery (one owner). */
export const BD_DELIVERY_TIME_TEXT = `Inside Dhaka: ${DHAKA_DELIVERY_DAYS[0]}–${DHAKA_DELIVERY_DAYS[1]} business days. Outside Dhaka: ${OUTSIDE_DHAKA_DELIVERY_DAYS[0]}–${OUTSIDE_DHAKA_DELIVERY_DAYS[1]} business days.`;

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

// ── District from a written address (checkout, 2026-11-24) ──────────────────────────────────────────────────

/*
 * District and thana are optional on the storefront: a shopper who only writes "House 12, Mirpur 10, ঢাকা" can still
 * order. This reads the district out of that free text (English or Bangla) so the delivery charge and the order's
 * district are right without asking. When it finds nothing — or two districts and can't tell — it returns null and
 * the order takes the default (rest of the country) zone; staff complete the address on the confirmation call.
 */

type District = keyof typeof BD_DIVISION_BY_DISTRICT;

/** Other English spellings people write (old names, short forms). Official names match on their own. */
const EN_ALIASES: Record<string, string[]> = {
  Chattogram: ["chittagong", "ctg", "chattagram"],
  Cumilla: ["comilla"],
  Jashore: ["jessore"],
  Barishal: ["barisal"],
  Bogura: ["bogra"],
  Chapainawabganj: ["chapai nawabganj", "chapai"],
  "Cox's Bazar": ["coxs bazar", "cox bazar", "coxsbazar", "coxbazar"],
  Moulvibazar: ["moulvi bazar", "maulvibazar", "maulvi bazar"],
  Netrokona: ["netrakona"],
  Jhalokati: ["jhalakathi", "jhalakati"],
  Khagrachhari: ["khagrachari"],
  Lakshmipur: ["laxmipur", "lakshipur"],
  Narsingdi: ["narshingdi", "narsindi"],
  Kishoreganj: ["kishorganj"],
  Brahmanbaria: ["b baria", "bbaria"],
  Narayanganj: ["narayangonj", "narayanganj"],
  Gazipur: ["gajipur"],
  Munshiganj: ["munsiganj"],
};

/** Bangla names (and the common other spellings). */
const BN_NAMES: Record<string, string[]> = {
  Dhaka: ["ঢাকা"],
  Faridpur: ["ফরিদপুর"],
  Gazipur: ["গাজীপুর", "গাজিপুর"],
  Gopalganj: ["গোপালগঞ্জ"],
  Kishoreganj: ["কিশোরগঞ্জ"],
  Madaripur: ["মাদারীপুর"],
  Manikganj: ["মানিকগঞ্জ"],
  Munshiganj: ["মুন্সীগঞ্জ"],
  Narayanganj: ["নারায়ণগঞ্জ", "নারায়নগঞ্জ"],
  Narsingdi: ["নরসিংদী"],
  Rajbari: ["রাজবাড়ী"],
  Shariatpur: ["শরীয়তপুর"],
  Tangail: ["টাঙ্গাইল", "টাংগাইল"],
  Bandarban: ["বান্দরবান"],
  Brahmanbaria: ["ব্রাহ্মণবাড়িয়া", "ব্রাক্ষণবাড়িয়া", "বি বাড়িয়া"],
  Chandpur: ["চাঁদপুর"],
  Chattogram: ["চট্টগ্রাম", "চিটাগাং"],
  Cumilla: ["কুমিল্লা"],
  "Cox's Bazar": ["কক্সবাজার"],
  Feni: ["ফেনী"],
  Khagrachhari: ["খাগড়াছড়ি"],
  Lakshmipur: ["লক্ষ্মীপুর", "লক্ষীপুর"],
  Noakhali: ["নোয়াখালী"],
  Rangamati: ["রাঙ্গামাটি", "রাঙামাটি"],
  Bogura: ["বগুড়া"],
  Joypurhat: ["জয়পুরহাট"],
  Naogaon: ["নওগাঁ"],
  Natore: ["নাটোর"],
  Chapainawabganj: ["চাঁপাইনবাবগঞ্জ", "চাঁপাই"],
  Pabna: ["পাবনা"],
  Rajshahi: ["রাজশাহী"],
  Sirajganj: ["সিরাজগঞ্জ"],
  Bagerhat: ["বাগেরহাট"],
  Chuadanga: ["চুয়াডাঙ্গা"],
  Jashore: ["যশোর", "যশোহর"],
  Jhenaidah: ["ঝিনাইদহ"],
  Khulna: ["খুলনা"],
  Kushtia: ["কুষ্টিয়া"],
  Magura: ["মাগুরা"],
  Meherpur: ["মেহেরপুর"],
  Narail: ["নড়াইল"],
  Satkhira: ["সাতক্ষীরা"],
  Barguna: ["বরগুনা"],
  Barishal: ["বরিশাল"],
  Bhola: ["ভোলা"],
  Jhalokati: ["ঝালকাঠি"],
  Patuakhali: ["পটুয়াখালী"],
  Pirojpur: ["পিরোজপুর"],
  Habiganj: ["হবিগঞ্জ"],
  Moulvibazar: ["মৌলভীবাজার"],
  Sunamganj: ["সুনামগঞ্জ"],
  Sylhet: ["সিলেট"],
  Dinajpur: ["দিনাজপুর"],
  Gaibandha: ["গাইবান্ধা"],
  Kurigram: ["কুড়িগ্রাম"],
  Lalmonirhat: ["লালমনিরহাট"],
  Nilphamari: ["নীলফামারী"],
  Panchagarh: ["পঞ্চগড়"],
  Rangpur: ["রংপুর"],
  Thakurgaon: ["ঠাকুরগাঁও"],
  Jamalpur: ["জামালপুর"],
  Mymensingh: ["ময়মনসিংহ", "ময়মনসিং"],
  Netrokona: ["নেত্রকোণা", "নেত্রকোনা"],
  Sherpur: ["শেরপুর"],
};

/** Dhaka city areas people write instead of the district (Bangla). English areas come from BD_AREAS_BY_DISTRICT. */
const BN_DHAKA_AREAS = [
  "মিরপুর", "উত্তরা", "মোহাম্মদপুর", "ধানমন্ডি", "গুলশান", "বনানী", "বাড্ডা", "রামপুরা", "খিলগাঁও", "যাত্রাবাড়ী",
  "মতিঝিল", "পল্টন", "শাহবাগ", "তেজগাঁও", "মগবাজার", "মালিবাগ", "বসুন্ধরা", "খিলক্ষেত", "দক্ষিণখান", "উত্তরখান",
  "কেরানীগঞ্জ", "সাভার", "আশুলিয়া", "ধামরাই", "দোহার", "লালবাগ", "হাজারীবাগ", "কামরাঙ্গীরচর", "ডেমরা", "শ্যামপুর",
  "কদমতলী", "সবুজবাগ", "মুগদা", "কাফরুল", "পল্লবী", "আদাবর", "ওয়ারী", "সূত্রাপুর", "রমনা", "বংশাল", "গেন্ডারিয়া",
  "ফার্মগেট", "কলাবাগান", "আজিমপুর", "মহাখালী", "কুড়িল", "বারিধারা", "শ্যামলী", "আগারগাঁও", "ভাটারা", "বাসাবো",
];

/** Bangla: drop the marks people write either way (chandrabindu, long/short i and u, ণ/ন, য়/য), and zero-width joiners. */
function normBn(s: string): string {
  return s
    .replace(/[‌‍ঁ]/g, "")
    .replace(/ী/g, "ি")
    .replace(/ূ/g, "ু")
    .replace(/ণ/g, "ন")
    .replace(/য়/g, "য")
    .replace(/য়/g, "য");
}

/** English: lower case, apostrophes gone, everything else that is not a letter or digit becomes one space, padded. */
function normEn(s: string): string {
  return ` ${s.toLowerCase().replace(/['’`]/g, "").replace(/[^a-z0-9ঀ-৿]+/g, " ").trim()} `;
}

const DISTRICTS = Object.values(BD_DISTRICTS_BY_DIVISION).flat() as string[];

const EN_PATTERNS: [string, string][] = DISTRICTS.flatMap((d) => [d, ...(EN_ALIASES[d] ?? [])].map((n) => [normEn(n), d] as [string, string]));
const BN_PATTERNS: [string, string][] = Object.entries(BN_NAMES).flatMap(([d, names]) => names.map((n) => [normBn(n), d] as [string, string]));

/** English area → district, only for area names that belong to one district and are long enough not to clash. */
const EN_AREA_PATTERNS: [string, string][] = (() => {
  const owners = new Map<string, Set<string>>();
  for (const [district, areas] of Object.entries(BD_AREAS_BY_DISTRICT)) {
    for (const area of areas) {
      const key = normEn(area);
      if (key.trim().length < 5 || /sadar|kotwali|kotowali/.test(key)) continue;
      owners.set(key, (owners.get(key) ?? new Set()).add(district));
    }
  }
  return [...owners].filter(([, ds]) => ds.size === 1).map(([key, ds]) => [key, [...ds][0]!] as [string, string]);
})();
const BN_AREA_PATTERNS: [string, string][] = BN_DHAKA_AREAS.map((a) => [normBn(a), "Dhaka"]);

/** Dhaka city areas in English that may also name a place elsewhere (Mirpur is in Kushtia too): a shopper writing
 * them means Dhaka far more often; a written district name ("Mirpur, Kushtia") still wins. */
const EN_DHAKA_AREAS: [string, string][] = [
  "mirpur", "uttara", "dhanmondi", "gulshan", "banani", "badda", "rampura", "mohammadpur", "jatrabari", "motijheel",
  "savar", "ashulia", "keraniganj", "khilgaon", "tejgaon", "bashundhara", "farmgate", "mohakhali", "shyamoli", "basabo",
  "malibagh", "moghbazar", "mogbazar", "wari", "lalbagh", "azimpur", "kuril", "baridhara", "khilkhet", "dakshinkhan",
  "demra", "pallabi", "kafrul", "adabor", "dhamrai", "dohar", "hazaribagh", "kamrangirchar", "shahbag", "paltan",
].map((a) => [normEn(a), "Dhaka"] as [string, string]);

function found(patterns: [string, string][], text: string): Set<string> {
  const hits = new Set<string>();
  for (const [p, d] of patterns) if (text.includes(p)) hits.add(d);
  return hits;
}

/** One district from a set of matches: Dhaka is often written after the real district ("Gazipur, Dhaka"), so
 * another district wins over it; two others means we can't tell. */
function pick(hits: Set<string>): string | null {
  if (hits.size === 1) return [...hits][0]!;
  const others = [...hits].filter((d) => d !== "Dhaka");
  return others.length === 1 ? others[0]! : null;
}

export interface GuessedDistrict {
  district: string;
  division: (typeof BD_DIVISION_BY_DISTRICT)[District];
}

/** The district written in a free-text address, or null when there is none or it is unclear. */
export function guessDistrictFromAddress(text: string | null | undefined): GuessedDistrict | null {
  if (!text || !text.trim()) return null;
  const en = normEn(text);
  const bn = normBn(en);
  const byName = new Set([...found(EN_PATTERNS, en), ...found(BN_PATTERNS, bn)]);
  const district = byName.size ? pick(byName) : pick(new Set([...found(EN_DHAKA_AREAS, en), ...found(EN_AREA_PATTERNS, en), ...found(BN_AREA_PATTERNS, bn)]));
  if (!district) return null;
  const division = BD_DIVISION_BY_DISTRICT[district];
  return division ? { district, division } : null;
}

/** The district a checkout uses: the one picked, else the one written in the address, else none (the order takes the
 * default zone). Division always follows the district. */
export function checkoutDistrict(input: { shippingDistrict?: string | null; shippingDivision?: string | null; shippingAddressLine?: string | null }): {
  district: string;
  division: string;
  /** true when neither a pick nor the address named a district. */
  unknown: boolean;
} {
  const picked = input.shippingDistrict?.trim();
  if (picked) return { district: picked, division: BD_DIVISION_BY_DISTRICT[picked] ?? input.shippingDivision?.trim() ?? "", unknown: false };
  const guess = guessDistrictFromAddress(input.shippingAddressLine);
  if (guess) return { ...guess, unknown: false };
  // No district named: a thana that belongs to one district names it ("Gobindaganj" → Gaibandha).
  const read = readBdAddress({ addressLine: input.shippingAddressLine });
  return read.district && read.division ? { district: read.district, division: read.division, unknown: false } : { district: "", division: "", unknown: true };
}

// ── Thana (and district) from a written address, with checks (2026-11-25) ──────────────────────────────────────

/*
 * District and thana stay optional at checkout, so the address the shopper writes is what the parcel goes on. This reads
 * the thana out of it (English or Bangla), the way people in Bangladesh write an address: smallest place first, then the
 * thana, then the district ("Rail gate, Station road, Demra, Dhaka" · "বাসস্ট্যান্ডের পাশে, গাজীপুর").
 *
 * Seventeen thana names exist in more than one district (Kotwali in seven, Kaliganj in four, Mirpur in Dhaka and
 * Kushtia…). Such a name is never decided alone: the written or picked district settles it; Mirpur and Mohammadpur
 * mean Dhaka unless another of their districts is written (as guessDistrictFromAddress already does); any other shared
 * name without a district comes back as `areaChoices` for the shopper (or staff) to pick from. Words that are only
 * thanas inside a city (Kotwali, Bandar, Airport, EPZ…) also need the district — "বিমানবন্দর রোড" is not a thana.
 */

/** Thana names that mean nothing without their district (city police thanas named after a common word). */
const NEEDS_DISTRICT = new Set(["kotwali", "bandar", "airport", "epz", "cantonment", "new market", "sadarghat", "chawkbazar", "chackbazar", "pagla"]);
/** Shared names that mean Dhaka unless another of their districts is written (same rule as EN_DHAKA_AREAS). */
const DHAKA_FIRST = new Set(["mirpur", "mohammadpur"]);
/** "Uttara" → Uttara East / West: the part people drop. */
const AREA_SUFFIX_EN = /\s+(east|west|north|south|industrial area)$/i;
const AREA_SUFFIX_BN = /\s+(পূর্ব|পশ্চিম|শিল্পাঞ্চল)$/;

interface AreaPattern {
  /** Normalised, space-padded name as it would appear in normalised text. */
  key: string;
  district: string;
  area: string;
  /** false: a shortened form ("uttara" for Uttara East) — loses to an exact name at the same place. */
  exact: boolean;
  /** The name (lower case English) the shared-name rules look at. */
  plain: string;
}

const AREA_PATTERNS: AreaPattern[] = (() => {
  const out: AreaPattern[] = [];
  const add = (raw: string, district: string, area: string, exact: boolean, bn: boolean) => {
    const key = bn ? ` ${normBn(normEn(raw).trim())} ` : normEn(raw);
    if (key.trim().length < (bn ? 2 : 3)) return;
    out.push({ key, district, area, exact, plain: area.toLowerCase().replace(AREA_SUFFIX_EN, "") });
  };
  for (const [district, areas] of Object.entries(BD_AREAS_BY_DISTRICT)) {
    for (const area of areas) {
      add(area, district, area, true, false);
      if (AREA_SUFFIX_EN.test(area)) add(area.replace(AREA_SUFFIX_EN, ""), district, area, false, false);
      for (const bn of BD_AREA_NAMES_BN[district]?.[area] ?? []) {
        add(bn, district, area, true, true);
        if (AREA_SUFFIX_BN.test(bn)) add(bn.replace(AREA_SUFFIX_BN, ""), district, area, false, true);
      }
    }
  }
  return out;
})();

/** How many districts share each thana name (lower case English, suffix dropped). */
const AREA_NAME_DISTRICTS: Map<string, Set<string>> = (() => {
  const m = new Map<string, Set<string>>();
  for (const p of AREA_PATTERNS) m.set(p.plain, (m.get(p.plain) ?? new Set()).add(p.district));
  return m;
})();

export interface BdPlace {
  area: string;
  district: string;
}

export type AddressIssue =
  /** No thana picked and none could be read from the address. */
  | { code: "AREA_MISSING" }
  /** The address names a thana that several districts have, and no district says which. */
  | { code: "AREA_UNCLEAR"; choices: BdPlace[] }
  /** The picked thana is not the one written in the address. */
  | { code: "AREA_MISMATCH"; picked: BdPlace; written: BdPlace }
  /** The picked district is not the one written in the address. */
  | { code: "DISTRICT_MISMATCH"; picked: string; written: string }
  /** Too little to find the door: under two words / twelve letters once the thana and district are taken out. */
  | { code: "ADDRESS_SHORT" };

export interface AddressReading {
  district: string | null;
  division: string | null;
  area: string | null;
  districtFrom: "picked" | "address" | null;
  areaFrom: "picked" | "address" | null;
  /** A written thana name shared by several districts, when nothing settles it. */
  areaChoices: BdPlace[];
  issues: AddressIssue[];
}

interface Hit extends AreaPattern {
  at: number;
}

function areaHits(en: string, bn: string): Hit[] {
  const hits: Hit[] = [];
  for (const p of AREA_PATTERNS) {
    const text = /[ঀ-৿]/.test(p.key) ? bn : en;
    const at = text.lastIndexOf(p.key);
    if (at >= 0) hits.push({ ...p, at: at + p.key.length });
  }
  // A shortened form loses to an exact name ending at the same place ("Tejgaon" vs "Tejgaon Industrial Area" → Tejgaon).
  return hits.filter((h) => h.exact || !hits.some((o) => o.exact && o.at === h.at && o.plain === h.plain));
}

/** Districts written by name ("Dhaka", "গাজীপুর"), in the order they were last written. */
function writtenDistricts(en: string, bn: string): string[] {
  const at = new Map<string, number>();
  for (const [p, d] of EN_PATTERNS) {
    const i = en.lastIndexOf(p);
    if (i >= 0) at.set(d, Math.max(at.get(d) ?? -1, i));
  }
  for (const [p, d] of BN_PATTERNS) {
    const i = bn.lastIndexOf(p);
    if (i >= 0) at.set(d, Math.max(at.get(d) ?? -1, i));
  }
  return [...at].sort((a, b) => a[1] - b[1]).map(([d]) => d);
}

function samePlace(a: BdPlace, b: BdPlace) {
  return a.area === b.area && a.district === b.district;
}

/**
 * Reads an address the way staff would: the district and thana it names, checked against what the shopper picked.
 * Never throws and never blocks an order — the result fills an empty thana when it is sure, and lists what staff should
 * check on the confirmation call when it is not.
 */
export function readBdAddress(input: { addressLine?: string | null; district?: string | null; area?: string | null }): AddressReading {
  const text = input.addressLine?.trim() ?? "";
  const en = normEn(text);
  const bn = normBn(en);
  const pickedDistrict = input.district?.trim() || null;
  const pickedArea = input.area?.trim() || null;

  // District: picked, else written by name (the last real one; a trailing "Dhaka" loses to another), else from the thana.
  const named = writtenDistricts(en, bn);
  let hits = areaHits(en, bn);
  let writtenDistrict: string | null = null;
  if (named.length === 1) writtenDistrict = named[0]!;
  else if (named.length > 1) {
    const others = named.filter((d) => d !== "Dhaka");
    // "বগুড়া শেরপুর": Sherpur is a district and also Bogura's thana — the thana explains it.
    const explained = others.filter((d) => hits.some((h) => h.district !== d && others.includes(h.district) && h.plain === d.toLowerCase()));
    const left = others.filter((d) => !explained.includes(d));
    writtenDistrict = left.length === 1 ? left[0]! : others.length === 1 ? others[0]! : null;
  }
  const context = pickedDistrict ?? writtenDistrict;

  // Thana: names that need their district only count with it; a name several districts share is settled by the district.
  hits = hits.filter((h) => {
    if (NEEDS_DISTRICT.has(h.plain)) return context === h.district;
    return true;
  });
  const inContext = context ? hits.filter((h) => h.district === context) : [];
  let written: BdPlace | null = null;
  let choices: BdPlace[] = [];
  const latest = (list: Hit[]) => list.reduce((a, b) => (b.at > a.at || (b.at === a.at && b.key.length > a.key.length) ? b : a));
  if (inContext.length) {
    const h = latest(inContext);
    // "Uttara" alone: both Uttara East and West match at the same place — ask, don't guess.
    const tied = inContext.filter((o) => o.at === h.at && o.plain === h.plain && o.area !== h.area);
    if (tied.length) choices = [h, ...tied].map(({ area, district }) => ({ area, district }));
    else written = { area: h.area, district: h.district };
  } else if (!context && hits.length) {
    const h = latest(hits);
    const sameName = hits.filter((o) => o.plain === h.plain && o.at === h.at);
    const districts = new Set(sameName.map((o) => o.district));
    if (districts.size === 1 && (AREA_NAME_DISTRICTS.get(h.plain)?.size ?? 1) === 1) {
      const areas = [...new Set(sameName.map((o) => o.area))];
      if (areas.length === 1) written = { area: h.area, district: h.district };
      else choices = areas.map((area) => ({ area, district: h.district }));
    } else if (DHAKA_FIRST.has(h.plain)) written = { area: sameName.find((o) => o.district === "Dhaka")?.area ?? h.area, district: "Dhaka" };
    else choices = [...new Map(sameName.map((o) => [`${o.area}|${o.district}`, { area: o.area, district: o.district }])).values()];
  }
  // "<District> Sadar" written as "sadar"/"সদর" next to the district.
  if (!written && !choices.length && context && (en.includes(" sadar ") || bn.includes(` ${normBn("সদর")} `))) {
    const sadar = (BD_AREAS_BY_DISTRICT[context] ?? []).filter((a) => /\bSadar\b/.test(a));
    if (sadar.length === 1) written = { area: sadar[0]!, district: context };
    else if (sadar.length > 1) choices = sadar.map((a) => ({ area: a, district: context }));
  }

  const district = pickedDistrict ?? writtenDistrict ?? written?.district ?? null;
  const area = pickedArea ?? (written && written.district === district ? written.area : null);
  const issues: AddressIssue[] = [];
  if (!area) issues.push(choices.length ? { code: "AREA_UNCLEAR", choices } : { code: "AREA_MISSING" });
  if (pickedArea && written && pickedDistrict && !samePlace(written, { area: pickedArea, district: pickedDistrict })) {
    issues.push({ code: "AREA_MISMATCH", picked: { area: pickedArea, district: pickedDistrict }, written });
  }
  if (pickedDistrict && writtenDistrict && writtenDistrict !== pickedDistrict) {
    issues.push({ code: "DISTRICT_MISMATCH", picked: pickedDistrict, written: writtenDistrict });
  }
  // What is left once place names are taken out: a door needs a house, road or landmark — two words and a dozen letters.
  let rest = ` ${bn} `;
  for (const h of areaHits(en, bn)) rest = rest.split(/[ঀ-৿]/.test(h.key) ? h.key : normBn(h.key)).join(" ");
  for (const [p] of [...EN_PATTERNS, ...BN_PATTERNS]) rest = rest.split(normBn(p)).join(" ");
  const words = rest.trim().split(/\s+/).filter((w) => w.length > 1);
  if (words.length < 2 || words.join("").length < 12) issues.push({ code: "ADDRESS_SHORT" });

  return {
    district,
    division: district ? (BD_DIVISION_BY_DISTRICT[district] ?? null) : null,
    area,
    districtFrom: pickedDistrict ? "picked" : district ? "address" : null,
    areaFrom: pickedArea ? "picked" : area ? "address" : null,
    areaChoices: area ? [] : choices,
    issues,
  };
}

/** The Bangla name of a district / thana for Bangla pages (landing pages); falls back to the English name. */
export function bdDistrictNameBn(district: string): string {
  return BN_NAMES[district]?.[0] ?? district;
}
export function bdAreaNameBn(district: string, area: string): string {
  return BD_AREA_NAMES_BN[district]?.[area]?.[0] ?? area;
}

/** Search the country's thanas by what someone types, in English or Bangla ("demra", "ডেমরা", "kali"): best first. */
export function searchBdAreas(query: string, opts: { district?: string | null; limit?: number } = {}): BdPlace[] {
  const q = query.trim();
  if (!q) return [];
  const bnQ = /[ঀ-৿]/.test(q);
  const key = bnQ ? normBn(q) : q.toLowerCase().replace(/['’`]/g, "");
  const scored: Array<BdPlace & { score: number }> = [];
  for (const [district, areas] of Object.entries(BD_AREAS_BY_DISTRICT)) {
    if (opts.district && district !== opts.district) continue;
    for (const area of areas) {
      const names = bnQ ? (BD_AREA_NAMES_BN[district]?.[area] ?? []).map(normBn) : [area.toLowerCase()];
      const districtNames = bnQ ? (BN_NAMES[district] ?? []).map(normBn) : [district.toLowerCase()];
      let score = 0;
      for (const n of names) {
        if (n === key) score = Math.max(score, 4);
        else if (n.startsWith(key)) score = Math.max(score, 3);
        else if (n.split(/\s+/).some((w) => w.startsWith(key))) score = Math.max(score, 2);
        else if (key.length >= 3 && n.includes(key)) score = Math.max(score, 1);
      }
      // "Kotwali Rangpur" / "রংপুর কোতোয়ালী": the district in the query narrows it.
      if (!score && key.includes(" ")) {
        const words = key.split(/\s+/);
        if (words.some((w) => districtNames.some((d) => d.startsWith(w))) && words.some((w) => names.some((n) => n.startsWith(w)))) score = 2;
      }
      if (score) scored.push({ area, district, score });
    }
  }
  return scored
    .sort((a, b) => b.score - a.score || a.area.length - b.area.length || a.area.localeCompare(b.area))
    .slice(0, opts.limit ?? 8)
    .map(({ area, district }) => ({ area, district }));
}
