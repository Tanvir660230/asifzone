-- Catalog configuration (product types, templates, attribute definitions, spec groups, size guide
-- presets) and the per-product attribute values table.
--
-- Additive only: Product.productType and Product.attributes are left exactly as they were, so a
-- rollback to the previous release still finds its data. Sections:
--   1. schema
--   2. seed: the 8 hard-coded product types, rendered from the old TypeScript config so behaviour is
--      identical on day one (system types; editable and archivable, never deletable)
--   3. backfill: point every product at its type and copy its attribute values out of the JSON blob

-- 1. Schema
-- CreateEnum
CREATE TYPE "AttributeDataType" AS ENUM ('TEXT', 'TEXTAREA', 'NUMBER', 'MEASUREMENT', 'BOOLEAN', 'SELECT', 'MULTI_SELECT', 'DATE', 'URL', 'RICH_TEXT');

-- CreateEnum
CREATE TYPE "SizeGuideMode" AS ENUM ('NOT_APPLICABLE', 'OFF_BY_DEFAULT', 'ON_BY_DEFAULT');


-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "typeId" TEXT;

-- CreateTable
CREATE TABLE "ProductTypeDef" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "templateId" TEXT NOT NULL,
    "legacyType" "ProductType" NOT NULL DEFAULT 'CUSTOM',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductTypeDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "variantDimensions" JSONB NOT NULL DEFAULT '[]',
    "sizeGuideMode" "SizeGuideMode" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "sizeGuidePresetId" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttributeDefinition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "dataType" "AttributeDataType" NOT NULL,
    "unit" TEXT,
    "placeholder" TEXT,
    "helpText" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttributeDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttributeDefinitionOption" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AttributeDefinitionOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpecGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateAttribute" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "specGroupId" TEXT,
    "placeholder" TEXT,
    "showOnStorefront" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TemplateAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAttributeValue" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "valueText" TEXT,
    "valueNumber" DECIMAL(14,4),
    "valueBoolean" BOOLEAN,
    "valueDate" TIMESTAMP(3),
    "valueJson" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductAttributeValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SizeGuidePreset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT,
    "columns" JSONB NOT NULL,
    "rows" JSONB NOT NULL,
    "notes" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SizeGuidePreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductTypeDef_key_key" ON "ProductTypeDef"("key");

-- CreateIndex
CREATE INDEX "ProductTypeDef_templateId_idx" ON "ProductTypeDef"("templateId");

-- CreateIndex
CREATE INDEX "ProductTypeDef_parentId_idx" ON "ProductTypeDef"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductTemplate_name_key" ON "ProductTemplate"("name");

-- CreateIndex
CREATE INDEX "ProductTemplate_sizeGuidePresetId_idx" ON "ProductTemplate"("sizeGuidePresetId");

-- CreateIndex
CREATE UNIQUE INDEX "AttributeDefinition_key_key" ON "AttributeDefinition"("key");

-- CreateIndex
CREATE UNIQUE INDEX "AttributeDefinitionOption_definitionId_value_key" ON "AttributeDefinitionOption"("definitionId", "value");

-- CreateIndex
CREATE UNIQUE INDEX "SpecGroup_name_key" ON "SpecGroup"("name");

-- CreateIndex
CREATE INDEX "TemplateAttribute_definitionId_idx" ON "TemplateAttribute"("definitionId");

-- CreateIndex
CREATE INDEX "TemplateAttribute_specGroupId_idx" ON "TemplateAttribute"("specGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateAttribute_templateId_definitionId_key" ON "TemplateAttribute"("templateId", "definitionId");

-- CreateIndex
CREATE INDEX "ProductAttributeValue_definitionId_valueText_idx" ON "ProductAttributeValue"("definitionId", "valueText");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAttributeValue_productId_definitionId_key" ON "ProductAttributeValue"("productId", "definitionId");

-- CreateIndex
CREATE UNIQUE INDEX "SizeGuidePreset_name_key" ON "SizeGuidePreset"("name");

-- CreateIndex
CREATE INDEX "Product_typeId_idx" ON "Product"("typeId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ProductTypeDef"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTypeDef" ADD CONSTRAINT "ProductTypeDef_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ProductTypeDef"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTypeDef" ADD CONSTRAINT "ProductTypeDef_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProductTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTemplate" ADD CONSTRAINT "ProductTemplate_sizeGuidePresetId_fkey" FOREIGN KEY ("sizeGuidePresetId") REFERENCES "SizeGuidePreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributeDefinitionOption" ADD CONSTRAINT "AttributeDefinitionOption_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "AttributeDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateAttribute" ADD CONSTRAINT "TemplateAttribute_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProductTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateAttribute" ADD CONSTRAINT "TemplateAttribute_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "AttributeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateAttribute" ADD CONSTRAINT "TemplateAttribute_specGroupId_fkey" FOREIGN KEY ("specGroupId") REFERENCES "SpecGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAttributeValue" ADD CONSTRAINT "ProductAttributeValue_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAttributeValue" ADD CONSTRAINT "ProductAttributeValue_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "AttributeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- 2. Seed
-- Size guide presets (the two charts that used to live in code)
INSERT INTO "SizeGuidePreset" ("id","name","unit","columns","rows","updatedAt") VALUES ('sgp_apparel', 'Apparel size guide', 'inch', '["Size","Chest","Waist","Length"]'::jsonb, '[["S","36–38","30–32","27"],["M","39–41","33–35","28"],["L","42–44","36–38","29"],["XL","45–47","39–41","30"],["XXL","48–50","42–44","31"]]'::jsonb, CURRENT_TIMESTAMP);
INSERT INTO "SizeGuidePreset" ("id","name","unit","columns","rows","updatedAt") VALUES ('sgp_shoe', 'Shoe size guide', 'cm (foot length)', '["EU","UK","US","Foot length"]'::jsonb, '[["39","6","7","24.5"],["40","7","8","25.4"],["41","7.5","8.5","26"],["42","8","9","26.7"],["43","9","10","27.3"],["44","10","11","28"]]'::jsonb, CURRENT_TIMESTAMP);

-- Spec groups (the accordion sections that used to be hard-coded per type)
INSERT INTO "SpecGroup" ("id","name","sortOrder","updatedAt") VALUES ('sg_specifications_care', 'Specifications & Care', 0, CURRENT_TIMESTAMP);
INSERT INTO "SpecGroup" ("id","name","sortOrder","updatedAt") VALUES ('sg_fragrance_details', 'Fragrance Details', 1, CURRENT_TIMESTAMP);
INSERT INTO "SpecGroup" ("id","name","sortOrder","updatedAt") VALUES ('sg_olfactory_notes', 'Olfactory Notes', 2, CURRENT_TIMESTAMP);
INSERT INTO "SpecGroup" ("id","name","sortOrder","updatedAt") VALUES ('sg_specifications', 'Specifications', 3, CURRENT_TIMESTAMP);
INSERT INTO "SpecGroup" ("id","name","sortOrder","updatedAt") VALUES ('sg_watch_details', 'Watch Details', 4, CURRENT_TIMESTAMP);
INSERT INTO "SpecGroup" ("id","name","sortOrder","updatedAt") VALUES ('sg_warranty_support', 'Warranty & Support', 5, CURRENT_TIMESTAMP);
INSERT INTO "SpecGroup" ("id","name","sortOrder","updatedAt") VALUES ('sg_cosmetic_details', 'Cosmetic Details', 6, CURRENT_TIMESTAMP);

-- Attribute definitions (the fields that used to be hard-coded per type)
INSERT INTO "AttributeDefinition" ("id","key","label","dataType","placeholder","updatedAt") VALUES ('attr_material', 'material', 'Material', 'TEXT'::"AttributeDataType", '100% Cotton', CURRENT_TIMESTAMP);
INSERT INTO "AttributeDefinition" ("id","key","label","dataType","placeholder","updatedAt") VALUES ('attr_fit', 'fit', 'Fit', 'SELECT'::"AttributeDataType", NULL, CURRENT_TIMESTAMP);
INSERT INTO "AttributeDefinitionOption" ("id","definitionId","value","sortOrder") VALUES ('attropt_fit_0', 'attr_fit', 'Regular', 0);
INSERT INTO "AttributeDefinitionOption" ("id","definitionId","value","sortOrder") VALUES ('attropt_fit_1', 'attr_fit', 'Slim', 1);
INSERT INTO "AttributeDefinitionOption" ("id","definitionId","value","sortOrder") VALUES ('attropt_fit_2', 'attr_fit', 'Relaxed', 2);
INSERT INTO "AttributeDefinition" ("id","key","label","dataType","placeholder","updatedAt") VALUES ('attr_fabric', 'fabric', 'Fabric', 'TEXT'::"AttributeDataType", 'Premium Cotton Lawn', CURRENT_TIMESTAMP);
INSERT INTO "AttributeDefinition" ("id","key","label","dataType","placeholder","updatedAt") VALUES ('attr_careInstructions', 'careInstructions', 'Care Instructions', 'TEXT'::"AttributeDataType", 'Machine wash cold with like colors', CURRENT_TIMESTAMP);
INSERT INTO "AttributeDefinition" ("id","key","label","dataType","placeholder","updatedAt") VALUES ('attr_fragranceType', 'fragranceType', 'Fragrance Type', 'SELECT'::"AttributeDataType", NULL, CURRENT_TIMESTAMP);
INSERT INTO "AttributeDefinitionOption" ("id","definitionId","value","sortOrder") VALUES ('attropt_fragranceType_0', 'attr_fragranceType', 'Attar', 0);
INSERT INTO "AttributeDefinitionOption" ("id","definitionId","value","sortOrder") VALUES ('attropt_fragranceType_1', 'attr_fragranceType', 'Extrait de Parfum', 1);
INSERT INTO "AttributeDefinitionOption" ("id","definitionId","value","sortOrder") VALUES ('attropt_fragranceType_2', 'attr_fragranceType', 'EDP', 2);
INSERT INTO "AttributeDefinitionOption" ("id","definitionId","value","sortOrder") VALUES ('attropt_fragranceType_3', 'attr_fragranceType', 'EDT', 3);
INSERT INTO "AttributeDefinitionOption" ("id","definitionId","value","sortOrder") VALUES ('attropt_fragranceType_4', 'attr_fragranceType', 'Body Mist', 4);
INSERT INTO "AttributeDefinition" ("id","key","label","dataType","placeholder","updatedAt") VALUES ('attr_concentration', 'concentration', 'Concentration', 'TEXT'::"AttributeDataType", 'High concentration oil', CURRENT_TIMESTAMP);
INSERT INTO "AttributeDefinition" ("id","key","label","dataType","placeholder","updatedAt") VALUES ('attr_scentFamily', 'scentFamily', 'Scent Family', 'SELECT'::"AttributeDataType", NULL, CURRENT_TIMESTAMP);
INSERT INTO "AttributeDefinitionOption" ("id","definitionId","value","sortOrder") VALUES ('attropt_scentFamily_0', 'attr_scentFamily', 'Woody', 0);
INSERT INTO "AttributeDefinitionOption" ("id","definitionId","value","sortOrder") VALUES ('attropt_scentFamily_1', 'attr_scentFamily', 'Floral', 1);
INSERT INTO "AttributeDefinitionOption" ("id","definitionId","value","sortOrder") VALUES ('attropt_scentFamily_2', 'attr_scentFamily', 'Oriental', 2);
INSERT INTO "AttributeDefinitionOption" ("id","definitionId","value","sortOrder") VALUES ('attropt_scentFamily_3', 'attr_scentFamily', 'Fresh', 3);
INSERT INTO "AttributeDefinitionOption" ("id","definitionId","value","sortOrder") VALUES ('attropt_scentFamily_4', 'attr_scentFamily', 'Musky', 4);
INSERT INTO "AttributeDefinitionOption" ("id","definitionId","value","sortOrder") VALUES ('attropt_scentFamily_5', 'attr_scentFamily', 'Citrus', 5);
INSERT INTO "AttributeDefinition" ("id","key","label","dataType","placeholder","updatedAt") VALUES ('attr_topNotes', 'topNotes', 'Top Notes', 'TEXT'::"AttributeDataType", 'Bergamot, Saffron, Lavender', CURRENT_TIMESTAMP);
INSERT INTO "AttributeDefinition" ("id","key","label","dataType","placeholder","updatedAt") VALUES ('attr_heartNotes', 'heartNotes', 'Heart Notes', 'TEXT'::"AttributeDataType", 'Rose, Jasmine, Spices', CURRENT_TIMESTAMP);
INSERT INTO "AttributeDefinition" ("id","key","label","dataType","placeholder","updatedAt") VALUES ('attr_baseNotes', 'baseNotes', 'Base Notes', 'TEXT'::"AttributeDataType", 'Amber, Musk, Agarwood (Oud)', CURRENT_TIMESTAMP);
INSERT INTO "AttributeDefinition" ("id","key","label","dataType","placeholder","updatedAt") VALUES ('attr_longevity', 'longevity', 'Longevity', 'TEXT'::"AttributeDataType", '8–10 hours', CURRENT_TIMESTAMP);
INSERT INTO "AttributeDefinition" ("id","key","label","dataType","placeholder","updatedAt") VALUES ('attr_gender', 'gender', 'Gender / Target', 'SELECT'::"AttributeDataType", NULL, CURRENT_TIMESTAMP);
INSERT INTO "AttributeDefinitionOption" ("id","definitionId","value","sortOrder") VALUES ('attropt_gender_0', 'attr_gender', 'Unisex', 0);
INSERT INTO "AttributeDefinitionOption" ("id","definitionId","value","sortOrder") VALUES ('attropt_gender_1', 'attr_gender', 'Men', 1);
INSERT INTO "AttributeDefinitionOption" ("id","definitionId","value","sortOrder") VALUES ('attropt_gender_2', 'attr_gender', 'Women', 2);
INSERT INTO "AttributeDefinition" ("id","key","label","dataType","placeholder","updatedAt") VALUES ('attr_alcohol', 'alcohol', 'Alcohol Content', 'TEXT'::"AttributeDataType", 'Alcohol-free / 80% Vol', CURRENT_TIMESTAMP);
INSERT INTO "AttributeDefinition" ("id","key","label","dataType","placeholder","updatedAt") VALUES ('attr_ingredients', 'ingredients', 'Ingredients', 'TEXTAREA'::"AttributeDataType", 'Parfum, Aqua, Essential Oils...', CURRENT_TIMESTAMP);
INSERT INTO "AttributeDefinition" ("id","key","label","dataType","placeholder","updatedAt") VALUES ('attr_howToUse', 'howToUse', 'How to Use', 'TEXTAREA'::"AttributeDataType", 'Apply on pulse points...', CURRENT_TIMESTAMP);
INSERT INTO "AttributeDefinition" ("id","key","label","dataType","placeholder","updatedAt") VALUES ('attr_dimensions', 'dimensions', 'Dimensions', 'TEXT'::"AttributeDataType", '11cm x 9cm', CURRENT_TIMESTAMP);
INSERT INTO "AttributeDefinition" ("id","key","label","dataType","placeholder","updatedAt") VALUES ('attr_movement', 'movement', 'Movement', 'SELECT'::"AttributeDataType", NULL, CURRENT_TIMESTAMP);
INSERT INTO "AttributeDefinitionOption" ("id","definitionId","value","sortOrder") VALUES ('attropt_movement_0', 'attr_movement', 'Quartz', 0);
INSERT INTO "AttributeDefinitionOption" ("id","definitionId","value","sortOrder") VALUES ('attropt_movement_1', 'attr_movement', 'Automatic', 1);
INSERT INTO "AttributeDefinitionOption" ("id","definitionId","value","sortOrder") VALUES ('attropt_movement_2', 'attr_movement', 'Mechanical', 2);
INSERT INTO "AttributeDefinition" ("id","key","label","dataType","placeholder","updatedAt") VALUES ('attr_warranty', 'warranty', 'Warranty', 'TEXT'::"AttributeDataType", '1 Year International Warranty', CURRENT_TIMESTAMP);
INSERT INTO "AttributeDefinition" ("id","key","label","dataType","placeholder","updatedAt") VALUES ('attr_dialColor', 'dialColor', 'Dial Color', 'TEXT'::"AttributeDataType", 'Sunburst Blue', CURRENT_TIMESTAMP);
INSERT INTO "AttributeDefinition" ("id","key","label","dataType","placeholder","updatedAt") VALUES ('attr_waterResistance', 'waterResistance', 'Water Resistance', 'TEXT'::"AttributeDataType", '3 ATM / 30 Meters', CURRENT_TIMESTAMP);
INSERT INTO "AttributeDefinition" ("id","key","label","dataType","placeholder","updatedAt") VALUES ('attr_soleType', 'soleType', 'Sole Type', 'TEXT'::"AttributeDataType", 'Anti-slip Rubber', CURRENT_TIMESTAMP);
INSERT INTO "AttributeDefinition" ("id","key","label","dataType","placeholder","updatedAt") VALUES ('attr_skinType', 'skinType', 'Skin Type', 'SELECT'::"AttributeDataType", NULL, CURRENT_TIMESTAMP);
INSERT INTO "AttributeDefinitionOption" ("id","definitionId","value","sortOrder") VALUES ('attropt_skinType_0', 'attr_skinType', 'All Skin Types', 0);
INSERT INTO "AttributeDefinitionOption" ("id","definitionId","value","sortOrder") VALUES ('attropt_skinType_1', 'attr_skinType', 'Oily', 1);
INSERT INTO "AttributeDefinitionOption" ("id","definitionId","value","sortOrder") VALUES ('attropt_skinType_2', 'attr_skinType', 'Dry', 2);
INSERT INTO "AttributeDefinitionOption" ("id","definitionId","value","sortOrder") VALUES ('attropt_skinType_3', 'attr_skinType', 'Combination', 3);
INSERT INTO "AttributeDefinitionOption" ("id","definitionId","value","sortOrder") VALUES ('attropt_skinType_4', 'attr_skinType', 'Sensitive', 4);
INSERT INTO "AttributeDefinition" ("id","key","label","dataType","placeholder","updatedAt") VALUES ('attr_publisher', 'publisher', 'Publisher / Origin', 'TEXT'::"AttributeDataType", 'Madinah / Local Artisan', CURRENT_TIMESTAMP);

-- One template per legacy type (same fields, dimensions and size-guide behaviour as before)
INSERT INTO "ProductTemplate" ("id","name","description","variantDimensions","sizeGuideMode","sizeGuidePresetId","updatedAt") VALUES ('tpl_clothing', 'Clothing template', 'Apparel items with size & color.', '[{"targetField":"size","label":"Size","options":["S","M","L","XL","XXL"]},{"targetField":"color","label":"Color","options":["Black","White","Navy","Maroon"]}]'::jsonb, 'ON_BY_DEFAULT'::"SizeGuideMode", 'sgp_apparel', CURRENT_TIMESTAMP);
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_clothing_material', 'tpl_clothing', 'attr_material', false, 0, 'sg_specifications_care', '100% Cotton');
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_clothing_fit', 'tpl_clothing', 'attr_fit', false, 1, 'sg_specifications_care', NULL);
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_clothing_fabric', 'tpl_clothing', 'attr_fabric', false, 2, 'sg_specifications_care', 'Premium Cotton Lawn');
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_clothing_careInstructions', 'tpl_clothing', 'attr_careInstructions', false, 3, 'sg_specifications_care', 'Machine wash cold with like colors');
INSERT INTO "ProductTypeDef" ("id","key","name","description","templateId","legacyType","isSystem","sortOrder","updatedAt") VALUES ('ptype_clothing', 'CLOTHING', 'Clothing', 'Apparel items with size & color.', 'tpl_clothing', 'CLOTHING'::"ProductType", true, 0, CURRENT_TIMESTAMP);
INSERT INTO "ProductTemplate" ("id","name","description","variantDimensions","sizeGuideMode","sizeGuidePresetId","updatedAt") VALUES ('tpl_fragrance', 'Fragrance template', 'Perfumes, attars, and body sprays.', '[{"targetField":"size","label":"Volume","options":["3ml","6ml","12ml","50ml","100ml"]}]'::jsonb, 'NOT_APPLICABLE'::"SizeGuideMode", NULL, CURRENT_TIMESTAMP);
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_fragrance_fragranceType', 'tpl_fragrance', 'attr_fragranceType', false, 0, 'sg_fragrance_details', NULL);
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_fragrance_concentration', 'tpl_fragrance', 'attr_concentration', false, 1, 'sg_fragrance_details', 'High concentration oil');
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_fragrance_scentFamily', 'tpl_fragrance', 'attr_scentFamily', false, 2, 'sg_fragrance_details', NULL);
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_fragrance_topNotes', 'tpl_fragrance', 'attr_topNotes', false, 3, 'sg_olfactory_notes', 'Bergamot, Saffron, Lavender');
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_fragrance_heartNotes', 'tpl_fragrance', 'attr_heartNotes', false, 4, 'sg_olfactory_notes', 'Rose, Jasmine, Spices');
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_fragrance_baseNotes', 'tpl_fragrance', 'attr_baseNotes', false, 5, 'sg_olfactory_notes', 'Amber, Musk, Agarwood (Oud)');
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_fragrance_longevity', 'tpl_fragrance', 'attr_longevity', false, 6, 'sg_fragrance_details', '8–10 hours');
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_fragrance_gender', 'tpl_fragrance', 'attr_gender', false, 7, 'sg_fragrance_details', NULL);
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_fragrance_alcohol', 'tpl_fragrance', 'attr_alcohol', false, 8, 'sg_fragrance_details', 'Alcohol-free / 80% Vol');
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_fragrance_ingredients', 'tpl_fragrance', 'attr_ingredients', false, 9, 'sg_fragrance_details', 'Parfum, Aqua, Essential Oils...');
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_fragrance_howToUse', 'tpl_fragrance', 'attr_howToUse', false, 10, 'sg_fragrance_details', 'Apply on pulse points...');
INSERT INTO "ProductTypeDef" ("id","key","name","description","templateId","legacyType","isSystem","sortOrder","updatedAt") VALUES ('ptype_fragrance', 'FRAGRANCE', 'Fragrance', 'Perfumes, attars, and body sprays.', 'tpl_fragrance', 'FRAGRANCE'::"ProductType", true, 1, CURRENT_TIMESTAMP);
INSERT INTO "ProductTemplate" ("id","name","description","variantDimensions","sizeGuideMode","sizeGuidePresetId","updatedAt") VALUES ('tpl_accessory', 'Accessory template', 'Wallets, belts, caps, and bags.', '[{"targetField":"color","label":"Color","options":["Black","Brown","Tan"]}]'::jsonb, 'OFF_BY_DEFAULT'::"SizeGuideMode", 'sgp_apparel', CURRENT_TIMESTAMP);
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_accessory_material', 'tpl_accessory', 'attr_material', false, 0, 'sg_specifications', 'Genuine Leather');
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_accessory_dimensions', 'tpl_accessory', 'attr_dimensions', false, 1, 'sg_specifications', '11cm x 9cm');
INSERT INTO "ProductTypeDef" ("id","key","name","description","templateId","legacyType","isSystem","sortOrder","updatedAt") VALUES ('ptype_accessory', 'ACCESSORY', 'Accessory', 'Wallets, belts, caps, and bags.', 'tpl_accessory', 'ACCESSORY'::"ProductType", true, 2, CURRENT_TIMESTAMP);
INSERT INTO "ProductTemplate" ("id","name","description","variantDimensions","sizeGuideMode","sizeGuidePresetId","updatedAt") VALUES ('tpl_watch', 'Watch template', 'Wristwatches and timepieces.', '[{"targetField":"size","label":"Case Size","options":["38mm","40mm","42mm","44mm"]},{"targetField":"color","label":"Strap Color","options":["Black","Brown","Steel","Rose Gold"]}]'::jsonb, 'NOT_APPLICABLE'::"SizeGuideMode", NULL, CURRENT_TIMESTAMP);
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_watch_movement', 'tpl_watch', 'attr_movement', false, 0, 'sg_watch_details', NULL);
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_watch_warranty', 'tpl_watch', 'attr_warranty', false, 1, 'sg_warranty_support', '1 Year International Warranty');
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_watch_dialColor', 'tpl_watch', 'attr_dialColor', false, 2, 'sg_watch_details', 'Sunburst Blue');
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_watch_waterResistance', 'tpl_watch', 'attr_waterResistance', false, 3, 'sg_watch_details', '3 ATM / 30 Meters');
INSERT INTO "ProductTypeDef" ("id","key","name","description","templateId","legacyType","isSystem","sortOrder","updatedAt") VALUES ('ptype_watch', 'WATCH', 'Watch', 'Wristwatches and timepieces.', 'tpl_watch', 'WATCH'::"ProductType", true, 3, CURRENT_TIMESTAMP);
INSERT INTO "ProductTemplate" ("id","name","description","variantDimensions","sizeGuideMode","sizeGuidePresetId","updatedAt") VALUES ('tpl_shoes', 'Shoes template', 'Footwear and sandals.', '[{"targetField":"size","label":"Size","options":["39","40","41","42","43","44"]},{"targetField":"color","label":"Color","options":["Black","Brown","Tan"]}]'::jsonb, 'ON_BY_DEFAULT'::"SizeGuideMode", 'sgp_shoe', CURRENT_TIMESTAMP);
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_shoes_material', 'tpl_shoes', 'attr_material', false, 0, 'sg_specifications', 'Full-grain Leather');
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_shoes_soleType', 'tpl_shoes', 'attr_soleType', false, 1, 'sg_specifications', 'Anti-slip Rubber');
INSERT INTO "ProductTypeDef" ("id","key","name","description","templateId","legacyType","isSystem","sortOrder","updatedAt") VALUES ('ptype_shoes', 'SHOES', 'Shoes', 'Footwear and sandals.', 'tpl_shoes', 'SHOES'::"ProductType", true, 4, CURRENT_TIMESTAMP);
INSERT INTO "ProductTemplate" ("id","name","description","variantDimensions","sizeGuideMode","sizeGuidePresetId","updatedAt") VALUES ('tpl_cosmetics', 'Cosmetics template', 'Skincare and makeup items.', '[{"targetField":"size","label":"Volume","options":["30ml","50ml","100ml"]},{"targetField":"color","label":"Shade","options":["Fair","Light","Medium","Deep"]}]'::jsonb, 'NOT_APPLICABLE'::"SizeGuideMode", NULL, CURRENT_TIMESTAMP);
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_cosmetics_skinType', 'tpl_cosmetics', 'attr_skinType', false, 0, 'sg_cosmetic_details', NULL);
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_cosmetics_ingredients', 'tpl_cosmetics', 'attr_ingredients', false, 1, 'sg_cosmetic_details', 'Aqua, Niacinamide, Hyaluronic Acid...');
INSERT INTO "ProductTypeDef" ("id","key","name","description","templateId","legacyType","isSystem","sortOrder","updatedAt") VALUES ('ptype_cosmetics', 'COSMETICS', 'Cosmetics', 'Skincare and makeup items.', 'tpl_cosmetics', 'COSMETICS'::"ProductType", true, 5, CURRENT_TIMESTAMP);
INSERT INTO "ProductTemplate" ("id","name","description","variantDimensions","sizeGuideMode","sizeGuidePresetId","updatedAt") VALUES ('tpl_islamic_product', 'Islamic Product template', 'Prayer mats and books.', '[{"targetField":"size","label":"Edition / Type","options":["Standard","Deluxe","Gift Box"]}]'::jsonb, 'NOT_APPLICABLE'::"SizeGuideMode", NULL, CURRENT_TIMESTAMP);
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_islamic_product_material', 'tpl_islamic_product', 'attr_material', false, 0, 'sg_specifications', 'Plush Velvet');
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_islamic_product_publisher', 'tpl_islamic_product', 'attr_publisher', false, 1, 'sg_specifications', 'Madinah / Local Artisan');
INSERT INTO "ProductTypeDef" ("id","key","name","description","templateId","legacyType","isSystem","sortOrder","updatedAt") VALUES ('ptype_islamic_product', 'ISLAMIC_PRODUCT', 'Islamic Product', 'Prayer mats and books.', 'tpl_islamic_product', 'ISLAMIC_PRODUCT'::"ProductType", true, 6, CURRENT_TIMESTAMP);
INSERT INTO "ProductTemplate" ("id","name","description","variantDimensions","sizeGuideMode","sizeGuidePresetId","updatedAt") VALUES ('tpl_home', 'Home template', 'Home decor and diffusers.', '[{"targetField":"size","label":"Size","options":["Small","Medium","Large"]},{"targetField":"color","label":"Color","options":["White","Wood","Matte Black"]}]'::jsonb, 'NOT_APPLICABLE'::"SizeGuideMode", NULL, CURRENT_TIMESTAMP);
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_home_material', 'tpl_home', 'attr_material', false, 0, 'sg_specifications', 'Ceramic / Glass');
INSERT INTO "TemplateAttribute" ("id","templateId","definitionId","required","sortOrder","specGroupId","placeholder") VALUES ('ta_home_dimensions', 'tpl_home', 'attr_dimensions', false, 1, 'sg_specifications', '15cm x 15cm');
INSERT INTO "ProductTypeDef" ("id","key","name","description","templateId","legacyType","isSystem","sortOrder","updatedAt") VALUES ('ptype_home', 'HOME', 'Home', 'Home decor and diffusers.', 'tpl_home', 'HOME'::"ProductType", true, 7, CURRENT_TIMESTAMP);

-- 3. Backfill
-- Every product gets the type matching its legacy enum value (all 8 exist above).
UPDATE "Product" SET "typeId" = 'ptype_' || lower("productType"::text) WHERE "typeId" IS NULL;

-- Copy attribute values out of the JSON blob, but only for keys the product's own template defines and
-- only when non-empty. Everything else (sizeGuide, keys left over from a previous type) stays in the JSON.
INSERT INTO "ProductAttributeValue" ("id", "productId", "definitionId", "valueText", "updatedAt")
SELECT 'pav_' || md5(p."id" || ta."definitionId"), p."id", ta."definitionId", btrim(p."attributes" ->> ad."key"), CURRENT_TIMESTAMP
FROM "Product" p
JOIN "ProductTypeDef" t ON t."id" = p."typeId"
JOIN "TemplateAttribute" ta ON ta."templateId" = t."templateId"
JOIN "AttributeDefinition" ad ON ad."id" = ta."definitionId"
WHERE jsonb_typeof(p."attributes") = 'object'
  AND jsonb_typeof(p."attributes" -> ad."key") IN ('string', 'number', 'boolean')
  AND btrim(p."attributes" ->> ad."key") <> ''
ON CONFLICT ("productId", "definitionId") DO NOTHING;
