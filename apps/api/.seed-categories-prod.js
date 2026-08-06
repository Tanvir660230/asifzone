const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function slugify(input) {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const tree = [
  { name: "Men", children: [
    { name: "Panjabi" }, { name: "Shirts" }, { name: "T-Shirts & Polos" }, { name: "Jeans" },
    { name: "Trousers & Chinos" }, { name: "Jackets & Outerwear" }, { name: "Waistcoats" },
    { name: "Sherwani" }, { name: "Thobe" }, { name: "Kabli" }, { name: "Essentials (Innerwear)" },
  ]},
  { name: "Women", children: [
    { name: "Abaya" }, { name: "Tops & Shirts" }, { name: "Dresses & Dress Sets" },
    { name: "Scarf & Hijab" }, { name: "Trousers" }, { name: "Co-ords" },
  ]},
  { name: "Kids", children: [
    { name: "Boys" }, { name: "Girls" }, { name: "Father & Son Collection" }, { name: "Mother & Daughter Collection" },
  ]},
  { name: "Footwear", children: [
    { name: "Men's Footwear" }, { name: "Women's Footwear" }, { name: "Kids' Footwear" },
  ]},
  { name: "Accessories", children: [
    { name: "Bags" }, { name: "Wallets" }, { name: "Belts" }, { name: "Watches" },
    { name: "Prayer Caps" }, { name: "Prayer Mats" }, { name: "Scarves & Shemagh" },
  ]},
  { name: "Fragrance", children: [{ name: "Men's Fragrance" }, { name: "Women's Fragrance" }] },
];

async function seed() {
  let created = 0;
  for (let i = 0; i < tree.length; i++) {
    const main = tree[i];
    const parent = await prisma.category.create({
      data: { name: main.name, slug: slugify(main.name), parentId: null, sortOrder: i, isActive: false, isFeatured: false },
    });
    created++;
    console.log("+ " + main.name);
    for (let j = 0; j < (main.children || []).length; j++) {
      const child = main.children[j];
      await prisma.category.create({
        data: { name: child.name, slug: slugify(child.name), parentId: parent.id, sortOrder: j, isActive: false, isFeatured: false },
      });
      created++;
      console.log("  - " + child.name);
    }
  }
  console.log("\nCreated " + created + " categories (all inactive).");
}

seed()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
