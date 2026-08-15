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

// Superseded by brands.folder_slug (via CatalogProduct.brandFolder, see
// data.ts) now that brand is a real foreign key -- brandFolderFor no longer
// needs this. Still exported because index.ts's publish handler iterates
// BRAND_FOLDERS to know which brand pages to generate; that call site moves
// to a DB-derived list of primary brands in a later task, at which point
// this hardcoded map is removed entirely.
export const BRAND_PREFIX_MAP: Record<string, string> = {
  gymshark: "Gymshark",
  youngla: "YoungLA",
  breathedivinity: "BreatheDivinity",
  chromehearts: "Chrome Hearts",
  cactusjack: "Cactus Jack",
  skims: "Skims",
  lululemon: "Lululemon",
};

export const BRAND_FOLDERS = Object.keys(BRAND_PREFIX_MAP);

export function isInCollection(product: { category: string }, collectionSlug: string): boolean {
  const categories = COLLECTION_CATEGORY_MAP[collectionSlug];
  if (!categories) return false;
  return categories.includes(product.category);
}

export function brandFolderFor(product: { brandFolder: string }): string {
  return product.brandFolder;
}
