// supabase/functions/publish-site/data.ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface CatalogVariant { size: string; inStock: boolean; }
// thumbUrl points at a small pre-generated derivative (see THUMB_PREFIX below)
// -- used anywhere an image displays small (card slider, PDP thumbnail strip),
// so those contexts don't pay full-resolution egress for a 64-380px box. url
// stays full-resolution for the one context that actually needs it: the PDP
// hero image.
export interface CatalogImage { url: string; thumbUrl: string; sortOrder: number; }
export interface CatalogColor {
  id: string; label: string; hex: string | null; colorGroup: string;
  secondaryColorGroup: string | null;
  variantLabel: string | null;
  coverImageUrl: string; images: CatalogImage[]; variants: CatalogVariant[];
}
export interface CatalogProduct {
  id: string; brand: string; brandFolder: string; name: string; slug: string;
  price: number; codAdvance: number; position: number;
  category: string; sleeveLength: string | null; description: string | null;
  colors: CatalogColor[];
  // Every image uploaded for this product (product_images), sorted by
  // sort_order. Each color's own `images` (see CatalogColor) is the subset
  // explicitly assigned to it (product_images.color_id) -- an image with no
  // color_id still appears here but isn't owned by any color's swatch.
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

  const { data: colors, error: colorsError } = await supabase
    .from("product_colors")
    .select("id, product_id, label, hex, color_group, secondary_color_group, variant_label, cover_image_id, created_at")
    .order("product_id", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (colorsError) throw new Error(`fetchCatalog colors: ${colorsError.message}`);

  const { data: images, error: imagesError } = await supabase
    .from("product_images")
    .select("id, product_id, storage_path, sort_order, color_id")
    .order("sort_order", { ascending: true });
  if (imagesError) throw new Error(`fetchCatalog images: ${imagesError.message}`);

  const { data: variants, error: variantsError } = await supabase
    .from("product_variants")
    .select("color_id, size, in_stock");
  if (variantsError) throw new Error(`fetchCatalog variants: ${variantsError.message}`);

  const publicUrl = (path: string) =>
    supabase.storage.from(STORAGE_BASE).getPublicUrl(path).data.publicUrl;

  // A thumbnail derivative lives alongside the original, one path segment
  // down, e.g. "slug/img-0001.jpg" -> "slug/thumbs/img-0001.jpg". Purely a
  // string transform (no DB column) so both the admin-panel upload flow and
  // this generator can derive it from storage_path alone -- see THUMB_PREFIX
  // usage in the admin panel for where the derivative actually gets created.
  const thumbPath = (path: string) => {
    const slashIdx = path.lastIndexOf("/");
    return slashIdx === -1 ? `thumbs/${path}` : `${path.slice(0, slashIdx)}/thumbs/${path.slice(slashIdx + 1)}`;
  };

  const imagesByProduct = new Map<string, CatalogImage[]>();
  const imagesByColor = new Map<string, CatalogImage[]>();
  const imageUrlById = new Map<string, string>();
  for (const img of images ?? []) {
    const url = publicUrl(img.storage_path);
    const thumbUrl = publicUrl(thumbPath(img.storage_path));
    imageUrlById.set(img.id, url);
    const catalogImg: CatalogImage = { url, thumbUrl, sortOrder: img.sort_order };

    const productList = imagesByProduct.get(img.product_id) ?? [];
    productList.push(catalogImg);
    imagesByProduct.set(img.product_id, productList);

    if (img.color_id) {
      const colorList = imagesByColor.get(img.color_id) ?? [];
      colorList.push(catalogImg);
      imagesByColor.set(img.color_id, colorList);
    }
  }

  const variantsByColor = new Map<string, CatalogVariant[]>();
  for (const v of variants ?? []) {
    const list = variantsByColor.get(v.color_id) ?? [];
    list.push({ size: v.size, inStock: v.in_stock });
    variantsByColor.set(v.color_id, list);
  }

  // Group colors by product, preserving the query's already-correct
  // (product_id, created_at, id) order.
  const colorsByProductRaw = new Map<string, NonNullable<typeof colors>>();
  for (const c of colors ?? []) {
    const list = colorsByProductRaw.get(c.product_id) ?? [];
    list.push(c);
    colorsByProductRaw.set(c.product_id, list);
  }

  const colorsByProduct = new Map<string, CatalogColor[]>();
  for (const [productId, productColors] of colorsByProductRaw) {
    // Each image now carries its own explicit color_id (set by the admin
    // panel), so a color's photos are whatever product_images rows point
    // at it -- no index math, no "does this range overlap that one".
    const list: CatalogColor[] = productColors.map((c) => {
      const ownImages = imagesByColor.get(c.id) ?? [];
      const coverUrl = c.cover_image_id ? imageUrlById.get(c.cover_image_id) : undefined;
      // cover_image_id can point at an image since reassigned to a different
      // color (or deleted) -- only trust it if it's still actually one of
      // this color's own images; otherwise fall back to the first owned one.
      const coverImageUrl =
        (coverUrl && ownImages.some((img) => img.url === coverUrl) ? coverUrl : ownImages[0]?.url) ?? "";
      return {
        id: c.id,
        label: c.label,
        hex: c.hex,
        colorGroup: c.color_group,
        secondaryColorGroup: c.secondary_color_group,
        variantLabel: c.variant_label,
        coverImageUrl,
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
