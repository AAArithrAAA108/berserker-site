// supabase/functions/publish-site/data.ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface CatalogVariant { size: string; inStock: boolean; }
export interface CatalogImage { url: string; sortOrder: number; }
export interface CatalogColor {
  id: string; label: string; hex: string | null; colorGroup: string;
  coverImageUrl: string; images: CatalogImage[]; variants: CatalogVariant[];
}
export interface CatalogProduct {
  id: string; brand: string; name: string; slug: string;
  price: number; codAdvance: number; position: number;
  category: string; sleeveLength: string | null; description: string | null;
  colors: CatalogColor[];
  // Every image uploaded for this product (product_images), sorted by
  // sort_order -- not filtered/deduped per color. A color's coverImageUrl is
  // one entry from this same list (see product_colors.cover_image_id). The
  // PDP gallery uses this full list so products with more photos than
  // colors (e.g. one color, several angle shots) aren't reduced to a single
  // thumbnail -- see render.ts's renderPdpPage.
  images: CatalogImage[];
}
export interface Catalog { products: CatalogProduct[]; }

const STORAGE_BASE = "product-images";

export async function fetchCatalog(supabase: SupabaseClient): Promise<Catalog> {
  const { data: products, error: productsError } = await supabase
    .from("products")
    .select("id, brand, name, slug, price, cod_advance, position, category, sleeve_length, description")
    .order("position", { ascending: true });
  if (productsError) throw new Error(`fetchCatalog products: ${productsError.message}`);

  // product_colors.image_index is the real, admin-authored ordering for a
  // product's colors/variants (0-based; migration 20260809050957 confirms it's
  // what the live storefront's data-img-index has always keyed off). It must
  // be selected and ordered on explicitly -- without it, Postgres has no
  // defined row order, so colors (and therefore which swatch is "first"/
  // pre-selected, and which image each swatch points at) come back in
  // essentially random order. Order by product_id (grouping stability), then
  // image_index (the real intended sequence), then id as a final tiebreaker
  // for rows that share an image_index (e.g. newly admin-added colors, which
  // default to 0) so repeated calls with identical data return identical order.
  const { data: colors, error: colorsError } = await supabase
    .from("product_colors")
    .select("id, product_id, label, hex, image_index, color_group, cover_image_id")
    .order("product_id", { ascending: true })
    .order("image_index", { ascending: true })
    .order("id", { ascending: true });
  if (colorsError) throw new Error(`fetchCatalog colors: ${colorsError.message}`);

  const { data: images, error: imagesError } = await supabase
    .from("product_images")
    .select("id, product_id, storage_path, sort_order")
    .order("sort_order", { ascending: true });
  if (imagesError) throw new Error(`fetchCatalog images: ${imagesError.message}`);

  const { data: variants, error: variantsError } = await supabase
    .from("product_variants")
    .select("color_id, size, in_stock");
  if (variantsError) throw new Error(`fetchCatalog variants: ${variantsError.message}`);

  const publicUrl = (path: string) =>
    supabase.storage.from(STORAGE_BASE).getPublicUrl(path).data.publicUrl;

  const imagesByProduct = new Map<string, CatalogImage[]>();
  for (const img of images ?? []) {
    const list = imagesByProduct.get(img.product_id) ?? [];
    list.push({ url: publicUrl(img.storage_path), sortOrder: img.sort_order });
    imagesByProduct.set(img.product_id, list);
  }

  const variantsByColor = new Map<string, CatalogVariant[]>();
  for (const v of variants ?? []) {
    const list = variantsByColor.get(v.color_id) ?? [];
    list.push({ size: v.size, inStock: v.in_stock });
    variantsByColor.set(v.color_id, list);
  }

  const imageUrlById = new Map<string, string>();
  for (const [, list] of imagesByProduct) {
    for (const img of list) imageUrlById.set(img.url, img.url);
  }
  const imageById = new Map<string, CatalogImage>();
  for (const img of images ?? []) {
    imageById.set(img.id, { url: publicUrl(img.storage_path), sortOrder: img.sort_order });
  }

  const colorsByProduct = new Map<string, CatalogColor[]>();
  for (const c of colors ?? []) {
    const list = colorsByProduct.get(c.product_id) ?? [];
    list.push({
      id: c.id,
      label: c.label,
      hex: c.hex,
      colorGroup: c.color_group,
      coverImageUrl: c.cover_image_id ? (imageById.get(c.cover_image_id)?.url ?? "") : "",
      images: imagesByProduct.get(c.product_id) ?? [],
      variants: variantsByColor.get(c.id) ?? [],
    });
    colorsByProduct.set(c.product_id, list);
  }

  return {
    products: (products ?? []).map((p) => ({
      id: p.id, brand: p.brand, name: p.name, slug: p.slug,
      price: Number(p.price), codAdvance: Number(p.cod_advance), position: p.position,
      category: p.category, sleeveLength: p.sleeve_length, description: p.description,
      colors: colorsByProduct.get(p.id) ?? [],
      images: imagesByProduct.get(p.id) ?? [],
    })),
  };
}
