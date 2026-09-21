import type {
  AttributeDataType,
  CreateAttributeDefinitionInput,
  ProductTypeInput,
  ResolvedTypeConfig,
  SizeGuideMode,
  SizeGuidePresetInput,
  SpecGroupInput,
  TemplateInput,
  UpdateAttributeDefinitionInput,
  UpdateProductTypeInput,
  VariantDimension,
} from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export interface ManagedType {
  id: string;
  key: string;
  name: string;
  description: string | null;
  parentId: string | null;
  templateId: string;
  template: { id: string; name: string };
  legacyType: string;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
  productCount: number;
}

export interface AttributeDefinitionRow {
  id: string;
  key: string;
  label: string;
  dataType: AttributeDataType;
  unit: string | null;
  placeholder: string | null;
  helpText: string | null;
  isArchived: boolean;
  options: { id: string; value: string; sortOrder: number }[];
  templateCount: number;
  valueCount: number;
}

export interface SpecGroupRow {
  id: string;
  name: string;
  sortOrder: number;
  usageCount: number;
}

export interface SizeGuideRow {
  id: string;
  name: string;
  description: string | null;
  unit: string | null;
  notes: string | null;
  columns: string[];
  rows: string[][];
  isArchived: boolean;
  templateCount: number;
}

export interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  variantDimensions: VariantDimension[];
  sizeGuideMode: SizeGuideMode;
  sizeGuidePresetId: string | null;
  sizeGuidePreset: { id: string; name: string } | null;
  isArchived: boolean;
  typeCount: number;
  attributes: {
    id: string;
    definitionId: string;
    required: boolean;
    sortOrder: number;
    specGroupId: string | null;
    placeholder: string | null;
    showOnStorefront: boolean;
    definition: { id: string; key: string; label: string; dataType: AttributeDataType; isArchived: boolean };
    specGroup: { id: string; name: string } | null;
  }[];
}

const json = (method: "POST" | "PATCH" | "PUT", body?: unknown) => ({ method, body });

/* product types */
export const listTypes = (includeInactive = false) =>
  apiFetch<{ types: ResolvedTypeConfig[] }>(`/api/catalog/types${includeInactive ? "?includeInactive=true" : ""}`);
export const listManagedTypes = () => apiFetch<{ types: ManagedType[] }>("/api/catalog/types/manage");
export const createType = (input: ProductTypeInput) => apiFetch<{ type: ManagedType }>("/api/catalog/types", json("POST", input));
export const updateType = (id: string, input: UpdateProductTypeInput) => apiFetch<{ type: ManagedType }>(`/api/catalog/types/${id}`, json("PATCH", input));
export const deleteType = (id: string) => apiFetch<void>(`/api/catalog/types/${id}`, { method: "DELETE" });

/* templates */
export const listTemplates = () => apiFetch<{ templates: TemplateRow[] }>("/api/catalog/templates");
export const createTemplate = (input: TemplateInput) => apiFetch<{ template: TemplateRow }>("/api/catalog/templates", json("POST", input));
export const updateTemplate = (id: string, input: Partial<TemplateInput>) => apiFetch<{ template: TemplateRow }>(`/api/catalog/templates/${id}`, json("PATCH", input));
export const deleteTemplate = (id: string) => apiFetch<void>(`/api/catalog/templates/${id}`, { method: "DELETE" });

/* attribute definitions */
export const listAttributeDefinitions = () => apiFetch<{ attributes: AttributeDefinitionRow[] }>("/api/catalog/attributes");
export const createAttributeDefinition = (input: CreateAttributeDefinitionInput) =>
  apiFetch<{ attribute: AttributeDefinitionRow }>("/api/catalog/attributes", json("POST", input));
export const updateAttributeDefinition = (id: string, input: UpdateAttributeDefinitionInput) =>
  apiFetch<{ attribute: AttributeDefinitionRow }>(`/api/catalog/attributes/${id}`, json("PATCH", input));
export const deleteAttributeDefinition = (id: string) => apiFetch<void>(`/api/catalog/attributes/${id}`, { method: "DELETE" });

/* spec groups */
export const listSpecGroups = () => apiFetch<{ specGroups: SpecGroupRow[] }>("/api/catalog/spec-groups");
export const createSpecGroup = (input: SpecGroupInput) => apiFetch<{ specGroup: SpecGroupRow }>("/api/catalog/spec-groups", json("POST", input));
export const updateSpecGroup = (id: string, input: Partial<SpecGroupInput>) => apiFetch<{ specGroup: SpecGroupRow }>(`/api/catalog/spec-groups/${id}`, json("PATCH", input));
export const deleteSpecGroup = (id: string) => apiFetch<void>(`/api/catalog/spec-groups/${id}`, { method: "DELETE" });

/* size guide presets */
export const listSizeGuides = () => apiFetch<{ sizeGuides: SizeGuideRow[] }>("/api/catalog/size-guides");
export const createSizeGuide = (input: SizeGuidePresetInput) => apiFetch<{ sizeGuide: SizeGuideRow }>("/api/catalog/size-guides", json("POST", input));
export const updateSizeGuide = (id: string, input: SizeGuidePresetInput) => apiFetch<{ sizeGuide: SizeGuideRow }>(`/api/catalog/size-guides/${id}`, json("PUT", input));
export const duplicateSizeGuide = (id: string) => apiFetch<{ sizeGuide: SizeGuideRow }>(`/api/catalog/size-guides/${id}/duplicate`, json("POST"));
export const archiveSizeGuide = (id: string, isArchived: boolean) =>
  apiFetch<{ sizeGuide: SizeGuideRow }>(`/api/catalog/size-guides/${id}/archive`, json("PATCH", { isArchived }));
export const deleteSizeGuide = (id: string) => apiFetch<void>(`/api/catalog/size-guides/${id}`, { method: "DELETE" });
