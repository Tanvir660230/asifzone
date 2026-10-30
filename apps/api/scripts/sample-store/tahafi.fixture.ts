/**
 * Tahafi SAMPLE store content — development/local only (see load.ts, which refuses any non-local database).
 * Names, prices and copy follow the owner's first design board; the photographs are cut from that board
 * (docs/brand/tahafi/sample) and must be replaced by a real shoot before launch. The real store's content is entered
 * through the admin, never from this file.
 */
import type { SampleStore } from "./types";

const SIZES = ["S", "M", "L", "XL", "XXL"];
const photo = (name: string) => `docs/brand/tahafi/sample/${name}.jpg`;

export const tahafi: SampleStore = {
  settings: {
    storeName: "Tahafi",
    tagline: "Modern modest menswear",
    contactEmail: "hello@example.com",
    currency: "BDT",
    returnWindowDays: 7,
    returnConditions: "Unworn, with the hang-tag still on",
    handlingDaysMin: 1,
    handlingDaysMax: 2,
    codEnabled: true,
    seoTitle: "Tahafi — modern modest menswear",
    seoDescription: "Jackets, overshirts, panjabi and caps for campus, work and Jummah. Cash on delivery across Bangladesh.",
    newsletterHeading: "Hear about new drops first",
    newsletterText: "One short note when a new collection lands. Nothing else.",
  },
  brand: {
    logo: "docs/brand/tahafi/png/tahafi-logo.png",
    logoOnDark: "docs/brand/tahafi/png/tahafi-logo-on-dark.png",
    favicon: "docs/brand/tahafi/png/tahafi-favicon-512.png",
    socialImage: "docs/brand/tahafi/png/tahafi-og-image-1200x630.png",
  },
  categories: [
    { key: "jackets", name: "Jackets", art: "panjabi", tone: "#d9d3c6", photo: photo("cat-jackets") },
    { key: "overshirts", name: "Overshirts & Layers", art: "panjabi", tone: "#d9d3c6", photo: photo("cat-overshirts") },
    { key: "panjabi", name: "Panjabi", art: "panjabi", tone: "#e4ddd0", photo: photo("cat-panjabi") },
    { key: "caps", name: "Caps", art: "kufi", tone: "#ddd6cb", photo: photo("cat-caps") },
  ],
  products: [
    {
      category: "jackets", art: "panjabi", tone: "#d9d3c6", name: "Olive Utility Jacket", slug: "olive-utility-jacket", productType: "CLOTHING",
      price: 2950, featured: true, brand: "Tahafi",
      short: "Heavy cotton twill, relaxed through the shoulder.",
      description: "Four pockets and a button placket over a hidden zip. Cut roomy enough for a backpack strap and for sitting comfortably in prayer.",
      variants: { sizes: SIZES, colors: [["Olive", "#3e4a33"], ["Black", "#1e211b"]], stock: 10 },
      photos: [photo("olive-utility-jacket"), photo("look-campus")],
    },
    {
      category: "jackets", art: "panjabi", tone: "#d9d3c6", name: "Black Coach Jacket", slug: "black-coach-jacket", productType: "CLOTHING",
      price: 3150, featured: true, brand: "Tahafi",
      short: "A clean coach jacket with a snap front.",
      description: "Water-resistant shell, soft lining and a snap front. Sits at the hip so it layers over a panjabi.",
      variants: { sizes: SIZES, colors: [["Black", "#1e211b"]], stock: 8 },
      photos: [photo("black-coach-jacket"), photo("look-city")],
    },
    {
      category: "overshirts", art: "panjabi", tone: "#d9d3c6", name: "Khaki Overshirt", slug: "khaki-overshirt", productType: "CLOTHING",
      price: 2650, brand: "Tahafi",
      short: "Brushed cotton, two chest pockets.",
      description: "A shirt-weight jacket in brushed cotton. Wear it open over a tee or buttoned up on cooler evenings.",
      variants: { sizes: SIZES, colors: [["Khaki", "#a89474"], ["Olive", "#3e4a33"]], stock: 12 },
      photos: [photo("khaki-overshirt")],
    },
    {
      category: "overshirts", art: "panjabi", tone: "#d9d3c6", name: "Stone Light Layer", slug: "stone-light-layer", productType: "CLOTHING",
      price: 2450, featured: true, brand: "Tahafi",
      short: "An unlined layer for warm days.",
      description: "Light cotton canvas with a relaxed collar — enough for an air-conditioned office, not too much for the walk home.",
      variants: { sizes: SIZES, colors: [["Stone", "#cfc6b4"]], stock: 9 },
      photos: [photo("stone-light-layer"), photo("look-jummah")],
    },
    {
      category: "panjabi", art: "panjabi", tone: "#e4ddd0", name: "Classic Panjabi Set", slug: "classic-panjabi-set", productType: "CLOTHING",
      price: 2550, compareAt: 2850, featured: true, brand: "Tahafi",
      short: "Soft cotton panjabi with matching trousers.",
      description: "A clean mandarin collar, hidden placket and side pockets, with matching straight trousers.",
      variants: { sizes: SIZES, colors: [["Off-white", "#f1ece2"]], stock: 14 },
      photos: [photo("classic-panjabi-set")],
    },
    {
      category: "caps", art: "kufi", tone: "#ddd6cb", name: "Knit Kufi", slug: "knit-kufi", productType: "ACCESSORY",
      price: 650, brand: "Tahafi",
      short: "Textured knit that holds its shape.",
      description: "A soft, textured knit kufi. One size fits most.",
      variants: { sizes: ["Standard"], colors: [["Black", "#1e211b"], ["Cream", "#e9e2d2"]], stock: 30 },
      photos: [photo("knit-kufi")],
    },
  ],
  // The homepage, in order. Copy is sample copy — editable in Admin → Homepage. The hero's small line becomes the
  // hang-tag in the tahafi preset ("name | detail | price").
  homepage: [
    {
      type: "HERO",
      config: {
        subtext: "Utility Jacket | Olive cotton twill | ৳2,950",
        headline: "The jacket you wear to class, and to Jummah.",
        bodyText: "Relaxed cut, heavy cotton twill. Sizes S to XXL.",
        ctaLabel: "Shop jackets",
        ctaHref: "/product/olive-utility-jacket",
        secondaryCtaLabel: "See the lookbook",
        secondaryCtaHref: "/search?category=jackets",
        imageAltText: "Olive utility jacket, worn on campus steps",
      },
      images: { imageUrl: { photo: photo("hero") } },
    },
    {
      type: "TRUST_STRIP",
      config: {
        items: [
          { icon: "Truck", label: "Delivery across Bangladesh" },
          { icon: "RotateCcw", label: "Size swap within 7 days" },
          { icon: "Banknote", label: "Cash on delivery" },
        ],
      },
    },
    { type: "PRODUCT_CAROUSEL", config: { heading: "New this week", subtitle: null, source: "new", category: null, itemCount: 8 } },
    { type: "CATEGORY_GRID", config: { heading: "Shop by piece", subtitle: null } },
    {
      type: "IMAGE_GALLERY",
      config: {
        eyebrow: null,
        heading: "Worn this week",
        layout: "mosaic",
        items: [
          { imageUrl: "pending", altText: "Campus look in olive", caption: "Olive Utility Jacket", linkUrl: "/product/olive-utility-jacket" },
          { imageUrl: "pending", altText: "City look in black", caption: "Black Coach Jacket", linkUrl: "/product/black-coach-jacket" },
          { imageUrl: "pending", altText: "Jummah look in stone", caption: "Stone Light Layer", linkUrl: "/product/stone-light-layer" },
          { imageUrl: "pending", altText: "Black coach jacket over a white hoodie", caption: "Black Coach Jacket", linkUrl: "/product/black-coach-jacket" },
        ],
      },
      images: {
        "items.0.imageUrl": { photo: photo("look-campus") },
        "items.1.imageUrl": { photo: photo("look-city") },
        "items.2.imageUrl": { photo: photo("look-jummah") },
        "items.3.imageUrl": { photo: photo("hero-side") },
      },
    },
    { type: "PRODUCT_CAROUSEL", config: { heading: "Most ordered", subtitle: null, source: "featured", category: null, itemCount: 8 } },
    {
      type: "BRAND_STORY",
      config: {
        eyebrow: "Our story",
        heading: "Fewer pieces. Every one checked by hand.",
        bodyText: "We make a short list of designs and check the fabric, the stitching and the fit of each one ourselves — so every piece is worth wearing for years.",
        ctaLabel: "Get in touch",
        ctaHref: "/contact",
        imageAltText: "The Tahafi mark on olive",
      },
      images: { imageUrl: { photo: "docs/brand/tahafi/png/tahafi-brand-card-1200x1500.png" } },
    },
  ],
};
