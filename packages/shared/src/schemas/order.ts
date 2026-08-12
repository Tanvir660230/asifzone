import { z } from "zod";
import { bdPhoneSchema, nullableEmail, nullableString, paginationQuerySchema } from "./common";

export const orderStatusEnum = z.enum([
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "RETURNED",
  "REFUNDED",
]);

export const paymentMethodEnum = z.enum(["COD", "SSLCOMMERZ"]);
export const paymentStatusEnum = z.enum(["UNPAID", "PAID", "FAILED", "REFUNDED"]);

/** Every raw `delivery_status` value Steadfast's API can return (courier.service.ts's
 * mapSteadfastStatusToOrderStatus only understands a subset of these) — shared so the admin
 * courier-status filter offers exactly the values Order.courierStatus can actually hold. */
export const COURIER_DELIVERY_STATUSES = [
  "in_review",
  "pending",
  "hold",
  "delivered_approval_pending",
  "partial_delivered_approval_pending",
  "cancelled_approval_pending",
  "unknown_approval_pending",
  "delivered",
  "partial_delivered",
  "cancelled",
  "unknown",
] as const;

/** Client-side fallback shown only before real settings have loaded — the authoritative fee is
 * always looked up from StoreSetting (Dhaka vs. outside-Dhaka) at order-creation time. */
export const SHIPPING_FEE_DHAKA_FALLBACK = 60;
export const SHIPPING_FEE_OUTSIDE_DHAKA_FALLBACK = 120;

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

/** Upazilas/thanas for every district (plus Dhaka Metropolitan Police thanas for Dhaka district,
 * since that's how the vast majority of Dhaka-city addresses are actually written — "Gulshan",
 * "Dhanmondi", "Mirpur" etc. are DMP thana names, not upazilas). Lets the Area/Thana field cascade
 * the same way District cascades off Division, instead of taking free text that couriers then have
 * to re-key against their own zone list.
 *
 * Cross-checked against Bangladesh's official upazila list (all 64 districts) and the current DMP
 * thana roster; excludes a handful of upazilas gazetted in 2026 that are too new to have propagated
 * to courier zone lists yet. */
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
  Gazipur: ["Gazipur Sadar", "Kaliakair", "Kaliganj", "Kapasia", "Sreepur"],
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
  Narayanganj: ["Narayanganj Sadar", "Araihazar", "Bandar", "Rupganj", "Sonargaon"],
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
  Lakshmipur: ["Lakshmipur Sadar", "Kamalnagar", "Raipur", "Ramganj", "Ramgati"],
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
  Rajshahi: ["Rajshahi Sadar", "Bagha", "Bagmara", "Charghat", "Durgapur", "Godagari", "Mohanpur", "Paba", "Puthia", "Tanore"],
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
  Khulna: ["Khulna Sadar", "Batiaghata", "Dacope", "Dighalia", "Dumuria", "Koyra", "Paikgachha", "Phultala", "Rupsa", "Terokhada"],
  Kushtia: ["Kushtia Sadar", "Bheramara", "Daulatpur", "Khoksa", "Kumarkhali", "Mirpur"],
  Magura: ["Magura Sadar", "Mohammadpur", "Shalikha", "Sreepur"],
  Meherpur: ["Meherpur Sadar", "Gangni", "Mujibnagar"],
  Narail: ["Narail Sadar", "Kalia", "Lohagara"],
  Satkhira: ["Satkhira Sadar", "Assasuni", "Debhata", "Kalaroa", "Kaliganj", "Shyamnagar", "Tala"],
  // Barishal division
  Barguna: ["Barguna Sadar", "Amtali", "Bamna", "Betagi", "Patharghata", "Taltali"],
  Barishal: [
    "Barishal Sadar",
    "Agailjhara",
    "Babuganj",
    "Bakerganj",
    "Banaripara",
    "Gaurnadi",
    "Hizla",
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
  Sylhet: [
    "Sylhet Sadar",
    "Balaganj",
    "Beanibazar",
    "Bishwanath",
    "Companiganj",
    "Dakshin Surma",
    "Fenchuganj",
    "Golapganj",
    "Gowainghat",
    "Jaintiapur",
    "Kanaighat",
    "Osmani Nagar",
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
  Rangpur: ["Rangpur Sadar", "Badarganj", "Gangachara", "Kaunia", "Mithapukur", "Pirgachha", "Pirganj", "Taraganj"],
  Thakurgaon: ["Thakurgaon Sadar", "Baliadangi", "Haripur", "Pirganj", "Ranisankail"],
  // Mymensingh division
  Jamalpur: ["Jamalpur Sadar", "Bakshiganj", "Dewanganj", "Islampur", "Madarganj", "Melandaha", "Sarishabari"],
  Mymensingh: [
    "Mymensingh Sadar",
    "Bhaluka",
    "Dhobaura",
    "Fulbaria",
    "Gafargaon",
    "Gauripur",
    "Haluaghat",
    "Ishwarganj",
    "Muktagachha",
    "Nandail",
    "Phulpur",
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

export const checkoutItemSchema = z.object({
  variantId: z.string().cuid(),
  quantity: z.number().int().min(1).max(20),
});

export const checkoutSchema = z.object({
  items: z.array(checkoutItemSchema).min(1, "Cart is empty"),
  customerName: z.string().min(1).max(200),
  customerEmail: nullableEmail(),
  customerPhone: bdPhoneSchema(),
  shippingDivision: z.enum(BD_DIVISIONS),
  shippingDistrict: z.string().min(1).max(120),
  shippingArea: z.string().min(1).max(120),
  shippingAddressLine: z.string().min(1).max(500),
  paymentMethod: paymentMethodEnum,
  couponCode: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).max(64).optional()),
  notes: nullableString(500),
  /// The storefront analytics session id (see PageView) — lets revenue be attributed back to a
  /// traffic source/campaign. Optional: omitted for old clients or if tracking failed to init.
  sessionId: z.string().max(64).optional(),
});

/** Powers the admin "Create order" page (phone/Facebook orders entered by staff) — reuses the same
 * item/customer/shipping shape as checkoutSchema (so it goes through the exact same createOrder
 * pipeline: atomic stock decrement, flash-sale/coupon pricing, product/price snapshotting) but
 * swaps the online-gateway payment path for one that doesn't make sense with no admin at a
 * keyboard on the other end: paymentMethod is COD-only, and `markPaid` lets staff record a sale
 * already settled outside the system (cash in hand, bKash/Nagad) without faking a gateway
 * transaction. `customerId` lets staff attach the order to an existing customer they looked up
 * instead of falling back to checkoutSchema's guest phone/email matching. */
export const adminCreateOrderSchema = z.object({
  items: z.array(checkoutItemSchema).min(1, "Add at least one item"),
  customerId: z.string().cuid().optional(),
  customerName: z.string().min(1).max(200),
  customerEmail: nullableEmail(),
  customerPhone: bdPhoneSchema(),
  shippingDivision: z.enum(BD_DIVISIONS),
  shippingDistrict: z.string().min(1).max(120),
  shippingArea: z.string().min(1).max(120),
  shippingAddressLine: z.string().min(1).max(500),
  paymentMethod: z.literal("COD"),
  markPaid: z.boolean().optional(),
  couponCode: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).max(64).optional()),
  notes: nullableString(500),
});

function csvToStatusArray(value: unknown) {
  if (typeof value === "string" && value.length > 0) return value.split(",");
  return undefined;
}

export const orderListQuerySchema = paginationQuerySchema.extend({
  status: orderStatusEnum.optional(),
  // Comma-separated alternative to `status` for quick filters that mean "one of several statuses"
  // (e.g. Cancelled/Returned) — kept as a separate param so every existing single-status caller is unaffected.
  statusIn: z.preprocess(csvToStatusArray, z.array(orderStatusEnum).optional()),
  paymentStatus: paymentStatusEnum.optional(),
  paymentMethod: paymentMethodEnum.optional(),
  search: z.string().min(1).max(200).optional(),
  // "true" = only soft-deleted orders (the admin restore view); omitted/"false" = normal listing.
  deleted: z.enum(["true", "false"]).optional(),
  // "true"/"false" filters on whether courierConsignmentId is set — lets an admin isolate orders
  // that still need to be handed to a courier (the bulk-booking workflow's main use case).
  courierBooked: z.enum(["true", "false"]).optional(),
  // Raw Steadfast delivery_status string (e.g. "in_review", "delivered", "cancelled") — stored as-is
  // on Order.courierStatus, so filtered as-is rather than through our own OrderStatus enum.
  courierStatus: z.string().min(1).max(50).optional(),
  shippingDivision: z.enum(BD_DIVISIONS).optional(),
  shippingDistrict: z.string().min(1).max(120).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  // Powers the sortable column headers on the admin orders table — restricted to plain scalar
  // columns Prisma can order by directly (no relations/joins).
  sortBy: z.enum(["orderNumber", "customerName", "paymentStatus", "total", "status", "createdAt"]).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});

export const bulkOrderIdsSchema = z.object({ ids: z.array(z.string().cuid()).min(1).max(500) });
export const bulkOrderStatusSchema = bulkOrderIdsSchema.extend({ status: orderStatusEnum });
export const bulkCourierBookSchema = bulkOrderIdsSchema;

export const updateOrderStatusSchema = z.object({
  status: orderStatusEnum,
  note: nullableString(500),
});

export const updateOrderDetailsSchema = z.object({
  trackingNumber: nullableString(120),
  carrier: nullableString(80),
  adminNotes: nullableString(2000),
});

export const validateCouponSchema = z.object({
  code: z.string().min(1).max(64),
  subtotal: z.number().positive(),
});

export const trackOrderSchema = z.object({
  orderNumber: z.string().min(1).max(64),
  phone: bdPhoneSchema(),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type AdminCreateOrderInput = z.infer<typeof adminCreateOrderSchema>;
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
export type UpdateOrderDetailsInput = z.infer<typeof updateOrderDetailsSchema>;
export type BulkOrderIdsInput = z.infer<typeof bulkOrderIdsSchema>;
export type BulkOrderStatusInput = z.infer<typeof bulkOrderStatusSchema>;
export type BulkCourierBookInput = z.infer<typeof bulkCourierBookSchema>;
export type ValidateCouponInput = z.infer<typeof validateCouponSchema>;
export type TrackOrderInput = z.infer<typeof trackOrderSchema>;
export type OrderStatus = z.infer<typeof orderStatusEnum>;
export type PaymentMethod = z.infer<typeof paymentMethodEnum>;
export type PaymentStatus = z.infer<typeof paymentStatusEnum>;
export type BdDivision = (typeof BD_DIVISIONS)[number];
