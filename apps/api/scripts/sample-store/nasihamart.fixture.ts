/**
 * Nasihamart SAMPLE store content — development/local only (see load.ts, which refuses any non-local database).
 * Every name, price, description and image here is placeholder content for building and reviewing the storefront before
 * the real catalog exists. The real store's content is entered through the admin, never from this file.
 */
import type { SampleStore } from "./types";

const PANJABI_SIZES = ["S", "M", "L", "XL", "XXL"];

export const nasihamart: SampleStore = {
  settings: {
    storeName: "Nasihamart",
    tagline: "Thoughtful essentials for everyday life",
    contactEmail: "hello@example.com",
    currency: "BDT",
    returnWindowDays: 7,
    returnConditions: "Unused items in their original packaging",
    handlingDaysMin: 1,
    handlingDaysMax: 2,
    codEnabled: true,
  },
  logo: { wordmark: "nasihamart" },
  categories: [
    { key: "panjabi", name: "Panjabi", art: "panjabi", tone: "#d9d2c5" },
    { key: "kufi", name: "Kufi & Caps", art: "kufi", tone: "#ddd6cb" },
    { key: "books", name: "Islamic Books", art: "book", tone: "#d6d0c6" },
    { key: "prayer", name: "Prayer Essentials", art: "mat", tone: "#dcd4c8" },
    { key: "attar", name: "Attar", art: "bottle", tone: "#e0d6c6" },
    { key: "tasbih", name: "Tasbih", art: "tasbih", tone: "#d8d1c7" },
    { key: "lifestyle", name: "Lifestyle", art: "vessel", tone: "#dbd5cc" },
    { key: "gifts", name: "Gifts", art: "gift", tone: "#ded5c9" },
  ],
  products: [
    // Panjabi
    {
      category: "panjabi", art: "panjabi", tone: "#e4ddd0", name: "Classic Cotton Panjabi", slug: "classic-cotton-panjabi", productType: "CLOTHING",
      price: 2450, compareAt: 2950, brand: "Nasihamart Atelier",
      short: "Breathable long-staple cotton with a soft, structured collar.",
      description: "A clean, everyday panjabi cut from breathable long-staple cotton. Concealed placket, soft structured collar and side pockets.",
      variants: { sizes: PANJABI_SIZES, colors: [["Ivory", "#efe9dc"], ["Sand", "#cdbfa5"]], stock: 12 },
    },
    {
      category: "panjabi", art: "panjabi", tone: "#d3d6d8", name: "Linen Blend Panjabi", slug: "linen-blend-panjabi", productType: "CLOTHING",
      price: 3200, brand: "Nasihamart Atelier",
      short: "Linen and cotton for warm days, with a relaxed drape.",
      description: "A relaxed linen–cotton blend that keeps its shape through long days. Mandarin collar, tonal buttons.",
      variants: { sizes: PANJABI_SIZES, colors: [["Stone", "#b9b7b1"], ["Slate", "#6f7479"]], stock: 8 },
    },
    {
      category: "panjabi", art: "panjabi", tone: "#e8e2d6", name: "Eid Embroidered Panjabi", slug: "eid-embroidered-panjabi", productType: "CLOTHING",
      price: 4850, compareAt: 5500, brand: "Nasihamart Atelier",
      short: "Tone-on-tone embroidery at the collar and placket.",
      description: "Fine tone-on-tone embroidery on a soft cotton-silk base — understated enough for every Eid gathering.",
      variants: { sizes: PANJABI_SIZES, colors: [["Pearl", "#f1ece2"]], stock: 4 },
    },
    // Kufi
    {
      category: "kufi", art: "kufi", tone: "#e6e1d8", name: "Knitted Cotton Kufi", slug: "knitted-cotton-kufi", productType: "ACCESSORY",
      price: 450, featured: true, brand: "Nasihamart",
      short: "Soft, stretch-knit cotton that holds its shape.",
      description: "A soft stretch-knit kufi in breathable cotton. One size fits most.",
      variants: { sizes: ["Standard"], colors: [["White", "#f6f4ef"], ["Charcoal", "#3b3a38"]], stock: 40 },
    },
    {
      category: "kufi", art: "kufi", tone: "#ddd5c7", name: "Structured Kufi Cap", slug: "structured-kufi-cap", productType: "ACCESSORY",
      price: 850, brand: "Nasihamart",
      short: "A firm crown with a subtle textured weave.",
      description: "A structured cap with a firm crown and a subtle textured weave. Lined for comfort.",
      variants: { sizes: ["56 cm", "58 cm", "60 cm"], colors: [["Cream", "#ece4d3"]], stock: 15 },
    },
    {
      category: "kufi", art: "kufi", tone: "#d9d9d6", name: "Everyday Prayer Cap Set", slug: "everyday-prayer-cap-set", productType: "ACCESSORY",
      price: 990, compareAt: 1200, brand: "Nasihamart",
      short: "Three breathable caps in neutral tones.",
      description: "A set of three breathable caps in white, grey and stone — one for every day of the week, almost.",
      variants: { sizes: ["Standard"], colors: [["Neutral set", "#d6d3cc"]], stock: 25 },
    },
    // Books
    {
      category: "books", art: "book", tone: "#d8d2c8", name: "The Garden of the Righteous (Hardcover)", slug: "garden-of-the-righteous", productType: "ISLAMIC_PRODUCT",
      price: 1650, featured: true, brand: "Sample Publisher",
      short: "A beautifully bound edition of a classic collection.",
      description: "A sample listing for a classic hadith collection in a clothbound hardcover with a ribbon marker.",
      variants: { sizes: ["Standard"], colors: [], stock: 20 },
    },
    {
      category: "books", art: "book", tone: "#cfd3d4", name: "Daily Duas Pocket Book", slug: "daily-duas-pocket-book", productType: "ISLAMIC_PRODUCT",
      price: 320, brand: "Sample Publisher",
      short: "Everyday supplications in a pocket-sized edition.",
      description: "A sample listing for a compact book of daily supplications with transliteration and translation.",
      variants: { sizes: ["Standard"], colors: [], stock: 60 },
    },
    {
      category: "books", art: "book", tone: "#ddd6ca", name: "Stories of the Prophets", slug: "stories-of-the-prophets", productType: "ISLAMIC_PRODUCT",
      price: 1200, compareAt: 1400, brand: "Sample Publisher",
      short: "Illustrated retellings for the whole family.",
      description: "A sample listing for an illustrated family edition with large print and clear chapter summaries.",
      variants: { sizes: ["Standard"], colors: [], stock: 3 },
    },
    // Prayer essentials
    {
      category: "prayer", art: "mat", tone: "#e1d9cb", name: "Cushioned Prayer Mat", slug: "cushioned-prayer-mat", productType: "ISLAMIC_PRODUCT",
      price: 1850, featured: true, brand: "Nasihamart",
      short: "A dense, cushioned mat with a non-slip base.",
      description: "A dense cushioned prayer mat with a soft woven face and a non-slip base. Rolls up for storage.",
      variants: { sizes: ["Standard"], colors: [["Oat", "#d8ccb6"], ["Graphite", "#4a4a48"]], stock: 18 },
    },
    {
      category: "prayer", art: "mat", tone: "#d7d4cd", name: "Travel Prayer Mat", slug: "travel-prayer-mat", productType: "ISLAMIC_PRODUCT",
      price: 950, brand: "Nasihamart",
      short: "Light, foldable and packed in its own pouch.",
      description: "A lightweight travel mat that folds into its own pouch, with a built-in compass card.",
      variants: { sizes: ["Standard"], colors: [["Stone", "#bdb8ae"]], stock: 30 },
    },
    {
      category: "prayer", art: "vessel", tone: "#e3ddd3", name: "Wudu Bottle", slug: "wudu-bottle", productType: "HOME",
      price: 650, brand: "Nasihamart",
      short: "A compact bottle with a precise, angled spout.",
      description: "A compact ablution bottle with an angled spout and a leak-proof cap.",
      variants: { sizes: ["Standard"], colors: [["White", "#f3f1ec"]], stock: 22 },
    },
    // Attar
    {
      category: "attar", art: "bottle", tone: "#e6dccb", name: "Oud Reserve Attar", slug: "oud-reserve-attar", productType: "FRAGRANCE",
      price: 1450, compareAt: 1750, brand: "Nasihamart Fragrance",
      short: "Warm oud with amber and a soft woody dry-down.",
      description: "An alcohol-free oil fragrance: warm oud, amber and a soft woody dry-down that lasts through the day.",
      variants: { sizes: ["3 ml", "6 ml", "12 ml"], colors: [], stock: 14 },
    },
    {
      category: "attar", art: "bottle", tone: "#e4e1d9", name: "White Musk Attar", slug: "white-musk-attar", productType: "FRAGRANCE",
      price: 890, brand: "Nasihamart Fragrance",
      short: "Clean, soft musk for everyday wear.",
      description: "An alcohol-free oil fragrance: clean white musk with a hint of powder. Gentle and close to the skin.",
      variants: { sizes: ["3 ml", "6 ml", "12 ml"], colors: [], stock: 26 },
    },
    {
      category: "attar", art: "bottle", tone: "#e2d8d0", name: "Rose Taifi Attar", slug: "rose-taifi-attar", productType: "FRAGRANCE",
      price: 1250, brand: "Nasihamart Fragrance",
      short: "A bright rose with a honeyed heart.",
      description: "An alcohol-free oil fragrance built around a bright rose accord with a honeyed heart.",
      variants: { sizes: ["3 ml", "6 ml"], colors: [], stock: 9 },
    },
    // Tasbih
    {
      category: "tasbih", art: "tasbih", tone: "#ddd5c9", name: "Olive Wood Tasbih", slug: "olive-wood-tasbih", productType: "ISLAMIC_PRODUCT",
      price: 750, featured: true, brand: "Nasihamart",
      short: "Thirty-three hand-finished olive wood beads.",
      description: "Thirty-three hand-finished olive wood beads on a durable cord, with a simple tassel.",
      variants: { sizes: ["33 beads"], colors: [["Natural", "#a98a63"]], stock: 35 },
    },
    {
      category: "tasbih", art: "tasbih", tone: "#d9d8d4", name: "Stone Bead Tasbih", slug: "stone-bead-tasbih", productType: "ISLAMIC_PRODUCT",
      price: 1100, brand: "Nasihamart",
      short: "Smooth, cool stone beads with a weighted feel.",
      description: "Smooth natural stone beads with a pleasantly weighted feel in the hand.",
      variants: { sizes: ["33 beads", "99 beads"], colors: [["Grey", "#8d8c88"]], stock: 11 },
    },
    {
      category: "tasbih", art: "tasbih", tone: "#e3ded5", name: "Digital Tasbih Counter", slug: "digital-tasbih-counter", productType: "ACCESSORY",
      price: 390, compareAt: 450, brand: "Nasihamart",
      short: "A quiet ring counter with a reset button.",
      description: "A compact ring counter with a silent click and a reset button.",
      variants: { sizes: ["Standard"], colors: [["White", "#f2f1ee"]], stock: 50 },
    },
    // Lifestyle
    {
      category: "lifestyle", art: "vessel", tone: "#e0dbd2", name: "Ceramic Incense Holder", slug: "ceramic-incense-holder", productType: "HOME",
      price: 980, brand: "Nasihamart Home",
      short: "A matte ceramic holder for bakhoor and incense.",
      description: "A matte stoneware holder for bakhoor and incense, finished by hand.",
      variants: { sizes: ["Standard"], colors: [["Chalk", "#ebe8e1"]], stock: 16 },
    },
    {
      category: "lifestyle", art: "vessel", tone: "#d8d3ca", name: "Dates Serving Bowl", slug: "dates-serving-bowl", productType: "HOME",
      price: 1350, brand: "Nasihamart Home",
      short: "A shallow bowl for dates and sweets.",
      description: "A shallow stoneware bowl sized for dates and sweets when guests arrive.",
      variants: { sizes: ["Standard"], colors: [["Sand", "#cfc3ad"]], stock: 10 },
    },
    {
      category: "lifestyle", art: "book", tone: "#e2dcd2", name: "Ramadan Journal", slug: "ramadan-journal", productType: "ISLAMIC_PRODUCT",
      price: 550, brand: "Nasihamart",
      short: "Thirty guided pages for reflection and goals.",
      description: "A guided journal with thirty daily pages for reflection, goals and gratitude.",
      variants: { sizes: ["Standard"], colors: [], stock: 40 },
    },
    // Gifts
    {
      category: "gifts", art: "gift", tone: "#e4dcd0", name: "Eid Gift Box", slug: "eid-gift-box", productType: "ISLAMIC_PRODUCT",
      price: 2900, compareAt: 3400, featured: true, brand: "Nasihamart",
      short: "Attar, tasbih and a prayer cap in a keepsake box.",
      description: "A keepsake box with a 6 ml attar, an olive wood tasbih and a knitted cap — ready to give.",
      variants: { sizes: ["Standard"], colors: [], stock: 12 },
    },
    {
      category: "gifts", art: "gift", tone: "#dcd8d1", name: "New Muslim Welcome Set", slug: "new-muslim-welcome-set", productType: "ISLAMIC_PRODUCT",
      price: 2200, brand: "Nasihamart",
      short: "A thoughtful starter set for someone new to the faith.",
      description: "A prayer mat, a pocket book of duas and a tasbih, gathered in one considered set.",
      variants: { sizes: ["Standard"], colors: [], stock: 6 },
    },
    {
      category: "gifts", art: "gift", tone: "#e6e0d6", name: "Gift Card", slug: "nasihamart-gift-card", productType: "ISLAMIC_PRODUCT",
      price: 1000, brand: "Nasihamart",
      short: "Let them choose — delivered as a printed card.",
      description: "A printed gift card in an envelope.",
      variants: { sizes: ["৳1,000", "৳2,500", "৳5,000"], colors: [], stock: 100 },
    },
  ],
  hero: {
    art: "panjabi",
    tone: "#ddd5c8",
    config: {
      subtext: "Eid collection",
      headline: "Made for the moments that matter",
      ctaLabel: "Shop the collection",
      ctaHref: "/category/panjabi",
      secondaryCtaLabel: "Explore gifts",
      secondaryCtaHref: "/category/gifts",
      imageAltText: "Sample image — panjabi on a warm neutral background",
    },
  },
  brandStory: {
    art: "tasbih",
    tone: "#d9d1c4",
    config: {
      eyebrow: "Our story",
      heading: "Chosen with care, made to be used every day",
      bodyText: "Every piece is selected for quality, comfort and honest materials — essentials that fit naturally into daily life.",
      ctaLabel: "About us",
      ctaHref: "/contact",
    },
  },
  promoBanner: {
    art: "gift",
    tone: "#d6cdbf",
    config: { heading: "Gifts they will keep", bodyText: "Curated sets, ready to give.", ctaLabel: "Shop gifts", linkUrl: "/category/gifts" },
  },
  // One trust & service section rather than a values grid and a separate trust strip saying the same things.
  valuesGrid: {
    eyebrow: "Why Nasihamart",
    heading: "Small things, done properly",
    items: [
      { icon: "ShieldCheck", title: "Authentic", description: "Genuine products from makers we know and trust." },
      { icon: "Gem", title: "Quality checked", description: "Every order is inspected before it leaves us." },
      { icon: "Truck", title: "Fast delivery", description: "Nationwide, with Cash on Delivery and secure online payment." },
      { icon: "Headphones", title: "Real support", description: "Friendly help before and after you order." },
    ],
  },
};
