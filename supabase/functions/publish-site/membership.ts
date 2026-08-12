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

export function brandFolderFor(product: { brand: string }): string | null {
  for (const folder of BRAND_FOLDERS) {
    if (product.brand.startsWith(BRAND_PREFIX_MAP[folder])) return folder;
  }
  return null;
}
