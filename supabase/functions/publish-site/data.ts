// supabase/functions/publish-site/data.ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface CatalogVariant { size: string; inStock: boolean; }
export interface CatalogImage { url: string; sortOrder: number; }
export interface CatalogColor {
  id: string; label: string; hex: string | null; colorGroup: string;
  coverImageUrl: string; images: CatalogImage[]; variants: CatalogVariant[];
}
export interface CatalogProduct {
  id: string; brand: string; brandFolder: string; name: string; slug: string;
  price: number; codAdvance: number; position: number;
  category: string; sleeveLength: string | null; description: string | null;
  colors: CatalogColor[];
  // Every image uploaded for this product (product_images), sorted by
  // sort_order. Each color's own `images` (see CatalogColor) is a slice of
  // this same list -- see fetchCatalog's color-range comment for how that
  // slice is computed. Renderers use this full list (not just each color's
  // slice) for the gallery/slider so every uploaded photo is reachable, even
  // if a color's image_index range has a gap or anomaly.
  images: CatalogImage[];
}
export interface Catalog { products: CatalogProduct[]; }

const STORAGE_BASE = "product-images";

export async function fetchCatalog(supabase: SupabaseClient): Promise<Catalog> {
  const { data: products, error: productsError } = await supabase
    .from("products")
    .select("id, brand_id, name, slug, price, cod_advance, position, category, sleeve_length, description")
    .order("position", { ascending: true });
  if (productsError) throw new Error(`fetchCatalog products: ${productsError.message}`);

  const { data: brands, error: brandsError } = await supabase
    .from("brands")
    .select("id, name, folder_slug");
  if (brandsError) throw new Error(`fetchCatalog brands: ${brandsError.message}`);

  const brandById = new Map((brands ?? []).map((b) => [b.id, b]));

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
    .select("id, product_id, label, hex, image_index, color_group")
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

  // Group colors by product, preserving the query's already-correct
  // (product_id, image_index, id) order -- the range computation below
  // depends on each product's colors being in image_index order.
  const colorsByProductRaw = new Map<string, NonNullable<typeof colors>>();
  for (const c of colors ?? []) {
    const list = colorsByProductRaw.get(c.product_id) ?? [];
    list.push(c);
    colorsByProductRaw.set(c.product_id, list);
  }

  const colorsByProduct = new Map<string, CatalogColor[]>();
  for (const [productId, productColors] of colorsByProductRaw) {
    // image_index is a 0-based position into this product's own
    // sort_order-sorted image list (migration 20260809050957 established
    // sort_order = image_index + 1; directly confirmed against real data,
    // e.g. a 21-color/42-image product where every color's image_index
    // steps by exactly 2 -- one pair of photos per color). A color owns
    // every image from its own image_index up to (but not including) the
    // next color's image_index; the count varies per color (some products
    // have 1 image per color, some 2, some more) and the last color owns
    // everything through the end of the list. This recovers real,
    // already-uploaded per-color photos (e.g. a second angle shot) that a
    // single-cover-image view left permanently unreachable, without a
    // schema change -- and doubles as the cover-image source, so a color
    // never needs a separate nullable FK to know its own first photo.
    const productImages = imagesByProduct.get(productId) ?? [];
    const list: CatalogColor[] = productColors.map((c, i) => {
      const start = Math.min(c.image_index, productImages.length);
      const nextStart =
        i + 1 < productColors.length
          ? Math.min(productColors[i + 1].image_index, productImages.length)
          : productImages.length;
      let ownImages = productImages.slice(start, Math.max(start, nextStart));
      // Defensive fallback for data anomalies (two colors sharing an
      // image_index, or one past the end of the list) -- never leave a
      // color with zero images if the product has any at all.
      if (ownImages.length === 0 && productImages.length > 0) {
        ownImages = [productImages[Math.min(start, productImages.length - 1)]];
      }
      return {
        id: c.id,
        label: c.label,
        hex: c.hex,
        colorGroup: c.color_group,
        coverImageUrl: ownImages[0]?.url ?? "",
        images: ownImages,
        variants: variantsByColor.get(c.id) ?? [],
      };
    });
    colorsByProduct.set(productId, list);
  }

  return {
    products: (products ?? []).map((p) => ({
      id: p.id,
      brand: brandById.get(p.brand_id)?.name ?? "",
      brandFolder: brandById.get(p.brand_id)?.folder_slug ?? "",
      name: p.name, slug: p.slug,
      price: Number(p.price), codAdvance: Number(p.cod_advance), position: p.position,
      category: p.category, sleeveLength: p.sleeve_length, description: p.description,
      colors: colorsByProduct.get(p.id) ?? [],
      images: imagesByProduct.get(p.id) ?? [],
    })),
  };
}

export interface PrimaryBrand { name: string; folderSlug: string; thumbnailUrl: string }

export async function fetchPrimaryBrands(supabase: SupabaseClient): Promise<PrimaryBrand[]> {
  const { data, error } = await supabase
    .from("brands")
    .select("name, folder_slug, thumbnail_storage_path")
    .eq("is_primary", true)
    .order("name", { ascending: true });
  if (error) throw new Error(`fetchPrimaryBrands: ${error.message}`);

  const publicUrl = (path: string) =>
    supabase.storage.from(STORAGE_BASE).getPublicUrl(path).data.publicUrl;

  return (data ?? []).map((b) => ({
    name: b.name,
    folderSlug: b.folder_slug,
    thumbnailUrl: b.thumbnail_storage_path ? publicUrl(b.thumbnail_storage_path) : "",
  }));
}
