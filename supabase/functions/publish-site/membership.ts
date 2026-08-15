// supabase/functions/publish-site/membership.ts

export const COLLECTION_CATEGORY_MAP: Record<string, string[]> = {
  "t-shirts": ["t-shirt", "compression"],
  "compressions": ["compression"],
  "pants": ["pants"],
  "jackets": ["jacket"],
  "dresses": ["dress"],
  "sets": ["set"],
};

export const COLLECTION_SLUGS = Object.keys(COLLECTION_CATEGORY_MAP);

export function isInCollection(product: { category: string }, collectionSlug: string): boolean {
  const categories = COLLECTION_CATEGORY_MAP[collectionSlug];
  if (!categories) return false;
  return categories.includes(product.category);
}

export function brandFolderFor(product: { brandFolder: string }): string {
  return product.brandFolder;
}
