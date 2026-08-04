import type { Category } from "@clothing-brand/shared";

export interface CategoryTreeNode extends Category {
  depth: number;
}

/** Flattens the category list into parent-first, depth-annotated order for indented table rendering. */
export function flattenCategoryTree(categories: Category[]): CategoryTreeNode[] {
  const byParent = new Map<string | null, Category[]>();
  for (const c of categories) {
    const key = c.parentId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(c);
  }
  for (const group of byParent.values()) {
    group.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  const result: CategoryTreeNode[] = [];
  function visit(parentId: string | null, depth: number) {
    for (const cat of byParent.get(parentId) ?? []) {
      result.push({ ...cat, depth });
      visit(cat.id, depth + 1);
    }
  }
  visit(null, 0);
  return result;
}
