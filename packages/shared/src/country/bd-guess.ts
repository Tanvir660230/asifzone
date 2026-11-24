import { BD_AREAS_BY_DISTRICT, BD_DIVISION_BY_DISTRICT, BD_DISTRICTS_BY_DIVISION } from "./bd";

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
  return guess ? { ...guess, unknown: false } : { district: "", division: "", unknown: true };
}
