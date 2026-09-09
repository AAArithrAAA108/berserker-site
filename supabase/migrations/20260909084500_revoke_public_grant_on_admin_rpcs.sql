-- Follow-up to 20260909083000: revoking EXECUTE from `anon` alone did
-- nothing, because PostgreSQL's PUBLIC pseudo-role grant is inherited by
-- every role including anon -- these six functions were still also
-- granted to PUBLIC directly (Supabase's default `grant execute on all
-- functions in schema public to ...` bootstrap), so anon kept access
-- through that blanket grant regardless of the anon-specific revoke.
-- `authenticated` keeps working: it holds its own separate explicit
-- EXECUTE grant (confirmed via information_schema.routine_privileges),
-- independent of PUBLIC's.
revoke execute on function public.create_collab_brand(p_name text, p_parent_folder_slug text) from public;
revoke execute on function public.create_primary_brand(p_name text, p_folder_slug text, p_thumbnail_storage_path text) from public;
revoke execute on function public.delete_brand_cascade(p_brand_id uuid) from public;
revoke execute on function public.delete_product_and_renumber(p_product_id uuid) from public;
revoke execute on function public.rename_brand_folder(p_old_slug text, p_new_slug text) from public;
revoke execute on function public.set_product_position(p_product_id uuid, p_new_position integer) from public;
