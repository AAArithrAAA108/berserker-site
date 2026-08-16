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

// Reserved site routes -- never a valid brand folder_slug. Mirrors the
// identical list enforced server-side in create_primary_brand/rename_brand_folder
// (supabase/migrations/20260815120100_add_brand_rpcs.sql) and client-side in
// admin/dashboard/brands.js. All three copies must stay in sync.
export const RESERVED_BRAND_SLUGS = [
  "admin",
  "checkout",
  "collections",
  "all-products",
  "about-berserker",
  "contact-berserker",
  "returns-and-refunds",
  "shipping-info",
  "brands",
];

// Computes which published pages to delete when a brand folder is renamed
// mid-publish (renameFrom -> renameTo). Defensive against three ways this
// could go wrong even though the admin UI is the only caller today:
//   - renameFrom is a reserved route (would delete a real site page, e.g. checkout/)
//   - renameFrom is still owned by a live primary brand (stale/racing rename;
//     deleting it would take down that brand's current page)
//   - a computed delete path collides with a path this same publish is about
//     to write (would create two tree entries for one path)
export function renameDeletePaths(
  products: { brandFolder: string; slug: string }[],
  renameFrom: string | undefined,
  renameTo: string | undefined,
  livePrimaryFolderSlugs: string[],
  files: Record<string, string>
): string[] {
  if (!renameFrom || !renameTo) return [];
  if (RESERVED_BRAND_SLUGS.includes(renameFrom)) return [];
  if (livePrimaryFolderSlugs.includes(renameFrom)) return [];

  const paths = [`${renameFrom}/index.html`];
  for (const product of products) {
    if (product.brandFolder === renameTo) {
      paths.push(`${renameFrom}/${product.slug}/index.html`);
    }
  }
  return paths.filter((p) => !(p in files));
}
