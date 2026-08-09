-- Product catalog seed (generated from live product pages).
--
-- FRESH/EMPTY DATABASE BOOTSTRAP ONLY. This file is NOT safe to re-run against
-- a populated database. In particular, the `delete from product_colors ...`
-- below cascades: product_variants.color_id references product_colors(id)
-- on delete cascade, so re-running this against a live database would
-- silently delete every product_variants row (destroying all in_stock flags)
-- and every product_colors row's cover_image_id assignment (colours are
-- recreated with brand-new ids that no longer match anything). The guard
-- immediately below refuses to run once `products` has any rows, precisely
-- to prevent this. Do not remove that guard to "just reseed" a live database
-- without first understanding and accepting that data loss.
--
-- products.position, products.category and product_colors.color_group are all
-- NOT NULL with no default, so every insert below supplies them explicitly:
--   position      sequential 1..41, the storefront display order.
--   category      one of the products_category_check values
--                 (t-shirt / compression / pants / jacket / dress / set).
--   sleeve_length half / full / sleeveless, or null where not applicable.
--   color_group   one of the 15 palette names used by classify_color_group();
--                 preferred from the colour's own label where the label names a
--                 real colour, falling back to classify_color_group(hex) otherwise.
--
-- position is deliberately NOT part of the ON CONFLICT update: re-running this
-- file (against a fresh database, per the guard above) must not clobber an
-- ordering the admin panel has since changed.

do $$
begin
  if exists (select 1 from products limit 1) then
    raise exception 'seed.sql refused to run: products table is not empty. This file is for bootstrapping a fresh database only — running it against existing data would cascade-delete product_variants stock flags and product_colors cover_image_id assignments. If you really intend to wipe and reseed, review this guard and remove it deliberately.';
  end if;
end $$;

insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('Gymshark', 'Founder Edition Oversized Hoodie', 'gymshark-founder-hoodie', 5299, 4500, 4, 'jacket', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('Gymshark', 'Lifting Essential Joggers', 'gymshark-lifting-essential-joggers', 4799, 3000, 5, 'pants', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('Gymshark', 'Onyx 5.0 Seamless Compression Half Sleeve', 'gymshark-onyx-5-half-sleeve', 4799, 3000, 1, 'compression', 'half') on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('Gymshark', 'Onyx 5.0 Seamless Compression Full Sleeve', 'gymshark-onyx-5-long-sleeve', 4799, 3000, 2, 'compression', 'full') on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('Gymshark', 'Onyx 5.0 Seamless Compression Sleeveless', 'gymshark-onyx-5-sleeveless', 4799, 3000, 3, 'compression', 'sleeveless') on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('YoungLA × Batman', 'Compression Half Sleeve', 'youngla-batman-half-sleeve', 4799, 4000, 6, 'compression', 'half') on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('YoungLA', 'Divine Sweats Sweatpants', 'youngla-divine-sweats', 4499, 2900, 12, 'pants', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('YoungLA', 'Drip Oversized T-Shirt', 'youngla-drip-oversized-tshirt', 4399, 2800, 9, 't-shirt', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('YoungLA × Gold''s Gym', 'Slim Fit T-Shirt', 'youngla-gold''s-gym-tshirt', 4799, 3000, 8, 't-shirt', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('YoungLA', 'Revenge Hoodie', 'youngla-revenge-hoodie', 5099, 3500, 10, 'jacket', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('YoungLA', 'Revenge Joggers', 'youngla-revenge-joggers', 4799, 3000, 11, 'pants', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('YoungLA × Superman', 'Compression Half Sleeve', 'youngla-superman-half-sleeve', 4799, 3000, 7, 'compression', 'half') on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('BreatheDivinity', 'Blood Oath Sweatpants', 'breathedivinity-blood-oath-sweatpants', 5099, 3400, 26, 'pants', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('BreatheDivinity', 'Bloodraven Oversized T-Shirt', 'breathedivinity-bloodraven', 5299, 3600, 20, 't-shirt', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('BreatheDivinity', 'Deathclaw Oversized T-Shirt', 'breathedivinity-deathclaw', 5399, 3700, 21, 't-shirt', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('BreatheDivinity', 'Deathwing Oversized Hoodie', 'breathedivinity-deathwing-oversized-hoodie', 5299, 3500, 25, 'jacket', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('BreatheDivinity', 'Dragon Blade Oversized T-Shirt', 'breathedivinity-dragon-blade', 5399, 3700, 22, 't-shirt', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('BreatheDivinity', 'Eternal Wyvern Oversized Sweatpants', 'breathedivinity-eternal-wyvern-oversized-sweatpants', 5099, 3400, 27, 'pants', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('BreatheDivinity', 'Fallen Knight Long Sleeve Compression', 'breathedivinity-fallen-knight-long-sleeve', 5499, 3700, 24, 'compression', 'full') on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('BreatheDivinity', 'Gargoyle Oversized T-Shirt', 'breathedivinity-gargoyle', 5399, 3700, 23, 't-shirt', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('BreatheDivinity', 'Hollow Souls Oversized T-Shirt', 'breathedivinity-hollow-souls', 5299, 3500, 19, 't-shirt', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('BreatheDivinity', 'VoidTech Berserker Compression', 'breathedivinity-voidtech-berserker', 4799, 2500, 14, 'compression', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('BreatheDivinity', 'VoidTech Cyber Skeleton Compression', 'breathedivinity-voidtech-cyber-skeleton', 5299, 3500, 15, 'compression', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('BreatheDivinity', 'VoidTech Immortal Compression', 'breathedivinity-voidtech-immortal', 5299, 3500, 16, 'compression', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('BreatheDivinity', 'VoidTech Infernal Compression', 'breathedivinity-voidtech-infernal', 5299, 3500, 18, 'compression', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('BreatheDivinity', 'VoidTech Nightfall Compression Half Sleeve', 'breathedivinity-voidtech-nightfall-half-sleeve', 4299, 2500, 13, 'compression', 'half') on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('BreatheDivinity', 'VoidTech PulseFire Compression', 'breathedivinity-voidtech-pulsefire', 5299, 3500, 17, 'compression', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('Chrome Hearts', 'Forever Black Denim Jacket', 'chromehearts-forever-denim-jacket', 8999, 7300, 31, 'jacket', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('Chrome Hearts × Mastermind', 'Ripped Denim Jacket', 'chromehearts-mastermind-ripped-denim-jacket', 8999, 7300, 32, 'jacket', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('Chrome Hearts', 'Retro Hoodie', 'chromehearts-retro-hoodie', 4799, 5100, 30, 'jacket', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('Chrome Hearts', 'Retro Jeans', 'chromehearts-retro-jeans', 7499, 5600, 33, 'pants', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('Chrome Hearts', 'Retro Oversized T-Shirt', 'chromehearts-retro-oversized-tshirt', 4799, 3100, 28, 't-shirt', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('Chrome Hearts', 'Vintage Oversized T-Shirt', 'chromehearts-vintage-oversized-tshirt', 4799, 3100, 29, 't-shirt', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('Cactus Jack x Travis Scott', 'Astroworld Oversized T-Shirt', 'cactusjack-astroworld-oversized-tshirt', 4799, 3000, 35, 't-shirt', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('Cactus Jack x Travis Scott x Fragment', 'Oversized T-Shirt', 'cactusjack-fragment-oversized-tshirt', 4799, 3000, 36, 't-shirt', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('Cactus Jack x Travis Scott x McDonald''s', 'Oversized T-Shirt', 'cactusjack-mcdonalds-oversized-tshirt', 4799, 3000, 37, 't-shirt', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('Cactus Jack x Travis Scott', 'Oversized T-Shirt', 'cactusjack-oversized-tshirt', 4799, 3000, 34, 't-shirt', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('Cactus Jack x Travis Scott x Playstation', 'Oversized T-Shirt', 'cactusjack-playstation-oversized-tshirt', 4799, 3000, 38, 't-shirt', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('Skims', 'Cotton Jersey T-Shirt', 'skims-cotton-jersey-tshirt', 4399, 2600, 39, 't-shirt', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('Skims', 'Rhinestone Logo Pointelle Mini Slip Dress', 'skims-rhinestone-logo-mini-dress', 6499, 4900, 40, 'dress', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;
insert into products (brand, name, slug, price, cod_advance, position, category, sleeve_length) values ('Lululemon', 'Define Nulu Jacket + Align Yoga Pants Set', 'lululemon-define-nulu-align-yoga-set', 6499, 6000, 41, 'set', null) on conflict (slug) do update set brand=excluded.brand, name=excluded.name, price=excluded.price, cod_advance=excluded.cod_advance, category=excluded.category, sleeve_length=excluded.sleeve_length;

-- Product colors (linked by slug lookup). The delete+reinsert pattern below
-- only avoids duplicate rows in the fresh-database scenario the guard above
-- enforces — see the header warning; it is NOT safe against a populated
-- database, where it would cascade-delete product_variants and orphan
-- product_colors.cover_image_id.

delete from product_colors where product_id in (select id from products);
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Forest Green', '#1a4a35', 0, 'Green' from products where slug = 'gymshark-founder-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Black', '#1a1a1a', 2, 'Black' from products where slug = 'gymshark-founder-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Red', '#c41e1e', 0, 'Red' from products where slug = 'gymshark-lifting-essential-joggers';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Stealth Black', '#0d0d0d', 3, 'Black' from products where slug = 'gymshark-lifting-essential-joggers';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Navy', '#2c3244', 6, 'Navy' from products where slug = 'gymshark-lifting-essential-joggers';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Grey', '#9a9a9a', 9, 'Grey' from products where slug = 'gymshark-lifting-essential-joggers';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Forest Green', '#1a4a1a', 0, 'Green' from products where slug = 'gymshark-onyx-5-half-sleeve';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Deep Purple', '#3a1a5a', 2, 'Purple' from products where slug = 'gymshark-onyx-5-half-sleeve';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Stealth Black', '#1a1a1a', 4, 'Black' from products where slug = 'gymshark-onyx-5-half-sleeve';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Dark Red', '#5a1a1a', 6, 'Red' from products where slug = 'gymshark-onyx-5-half-sleeve';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Black', '#1a1a1a', 0, 'Black' from products where slug = 'gymshark-onyx-5-long-sleeve';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Dark Red', '#5a1a1a', 2, 'Red' from products where slug = 'gymshark-onyx-5-long-sleeve';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Teal', '#1a4a4a', 4, 'Green' from products where slug = 'gymshark-onyx-5-long-sleeve';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Gray', '#4a4a4a', 6, 'Grey' from products where slug = 'gymshark-onyx-5-long-sleeve';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Black', '#1a1a1a', 0, 'Black' from products where slug = 'gymshark-onyx-5-sleeveless';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Purple', '#3a1a5a', 2, 'Purple' from products where slug = 'gymshark-onyx-5-sleeveless';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Dark Red', '#5a1a1a', 4, 'Red' from products where slug = 'gymshark-onyx-5-sleeveless';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Dark Knight', '#1a1a2e', 0, 'Black' from products where slug = 'youngla-batman-half-sleeve';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Stealth', '#2a2a2a', 2, 'Grey' from products where slug = 'youngla-batman-half-sleeve';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'White', '#e8e8e8', 3, 'White' from products where slug = 'youngla-batman-half-sleeve';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Maroon', '#5a2a35', 0, 'Maroon' from products where slug = 'youngla-divine-sweats';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Black', '#141414', 1, 'Black' from products where slug = 'youngla-divine-sweats';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Navy', '#2e3240', 2, 'Navy' from products where slug = 'youngla-divine-sweats';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Purple', '#3f2f4a', 3, 'Purple' from products where slug = 'youngla-divine-sweats';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Charcoal', '#3a3d3a', 5, 'Grey' from products where slug = 'youngla-divine-sweats';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Maroon', '#5a2a35', 0, 'Maroon' from products where slug = 'youngla-drip-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Brown', '#4a3f30', 3, 'Brown' from products where slug = 'youngla-drip-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Black', '#141414', 6, 'Black' from products where slug = 'youngla-drip-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Maroon', '#6e1f2a', 0, 'Maroon' from products where slug = 'youngla-gold''s-gym-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Black', '#141414', 1, 'Black' from products where slug = 'youngla-gold''s-gym-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Yellow', '#f2c318', 3, 'Gold' from products where slug = 'youngla-gold''s-gym-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Cream', '#ece7db', 4, 'Cream' from products where slug = 'youngla-gold''s-gym-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Green', '#0d3b2e', 0, 'Green' from products where slug = 'youngla-revenge-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Grey', '#8a8a8a', 2, 'Grey' from products where slug = 'youngla-revenge-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Black', '#141414', 3, 'Black' from products where slug = 'youngla-revenge-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Purple', '#413a52', 0, 'Purple' from products where slug = 'youngla-revenge-joggers';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Black', '#141414', 2, 'Black' from products where slug = 'youngla-revenge-joggers';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Teal', '#0e5f5f', 4, 'Green' from products where slug = 'youngla-revenge-joggers';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Red', '#c41e1e', 7, 'Red' from products where slug = 'youngla-revenge-joggers';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Black', '#12141c', 0, 'Black' from products where slug = 'youngla-superman-half-sleeve';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Red', '#c41e1e', 1, 'Red' from products where slug = 'youngla-superman-half-sleeve';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Blue', '#1e3fc4', 2, 'Blue' from products where slug = 'youngla-superman-half-sleeve';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Purple', '#5a1ca0', 1, 'Purple' from products where slug = 'breathedivinity-blood-oath-sweatpants';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'White', '#3a3a3a', 3, 'White' from products where slug = 'breathedivinity-blood-oath-sweatpants';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Red', '#a01c1c', 7, 'Red' from products where slug = 'breathedivinity-blood-oath-sweatpants';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Red', '#a01c1c', 2, 'Red' from products where slug = 'breathedivinity-bloodraven';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Purple', '#5a1ca0', 4, 'Purple' from products where slug = 'breathedivinity-bloodraven';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'White', '#3a3a3a', 0, 'White' from products where slug = 'breathedivinity-bloodraven';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Red White', '#8a1c1c', 6, 'Red' from products where slug = 'breathedivinity-bloodraven';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Blue', '#1c4aa0', 8, 'Blue' from products where slug = 'breathedivinity-bloodraven';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Black', '#141414', 10, 'Black' from products where slug = 'breathedivinity-bloodraven';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Pink', '#c41e8a', 12, 'Pink' from products where slug = 'breathedivinity-bloodraven';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Red White', '#8a1c1c', 0, 'Red' from products where slug = 'breathedivinity-deathclaw';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'White', '#3a3a3a', 2, 'White' from products where slug = 'breathedivinity-deathclaw';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Purple', '#5a1ca0', 0, 'Purple' from products where slug = 'breathedivinity-deathwing-oversized-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'White', '#3a3a3a', 2, 'White' from products where slug = 'breathedivinity-deathwing-oversized-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Red', '#a01c1c', 4, 'Red' from products where slug = 'breathedivinity-deathwing-oversized-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Blue', '#1c4aa0', 0, 'Blue' from products where slug = 'breathedivinity-dragon-blade';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'White', '#3a3a3a', 2, 'White' from products where slug = 'breathedivinity-dragon-blade';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Red', '#a01c1c', 4, 'Red' from products where slug = 'breathedivinity-dragon-blade';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Orange', '#c46a1e', 6, 'Orange' from products where slug = 'breathedivinity-dragon-blade';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Purple', '#5a1ca0', 8, 'Purple' from products where slug = 'breathedivinity-dragon-blade';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Red Blue', '#7a2c4a', 10, 'Red' from products where slug = 'breathedivinity-dragon-blade';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Pink', '#c41e8a', 12, 'Pink' from products where slug = 'breathedivinity-dragon-blade';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Black', '#141414', 0, 'Black' from products where slug = 'breathedivinity-eternal-wyvern-oversized-sweatpants';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'White', '#3a3a3a', 1, 'White' from products where slug = 'breathedivinity-eternal-wyvern-oversized-sweatpants';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Red', '#a01c1c', 4, 'Red' from products where slug = 'breathedivinity-eternal-wyvern-oversized-sweatpants';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Purple', '#5a1ca0', 7, 'Purple' from products where slug = 'breathedivinity-eternal-wyvern-oversized-sweatpants';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Orange', '#c46a1e', 0, 'Orange' from products where slug = 'breathedivinity-fallen-knight-long-sleeve';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Pink', '#c41e8a', 2, 'Pink' from products where slug = 'breathedivinity-fallen-knight-long-sleeve';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Blue', '#1c4aa0', 4, 'Blue' from products where slug = 'breathedivinity-fallen-knight-long-sleeve';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Purple', '#5a1ca0', 6, 'Purple' from products where slug = 'breathedivinity-fallen-knight-long-sleeve';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Red', '#a01c1c', 8, 'Red' from products where slug = 'breathedivinity-fallen-knight-long-sleeve';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'White', '#3a3a3a', 0, 'White' from products where slug = 'breathedivinity-gargoyle';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Red', '#a01c1c', 2, 'Red' from products where slug = 'breathedivinity-gargoyle';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Purple', '#5a1ca0', 4, 'Purple' from products where slug = 'breathedivinity-gargoyle';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Crimson', '#8a1c1c', 6, 'Red' from products where slug = 'breathedivinity-gargoyle';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Red', '#a01c1c', 0, 'Red' from products where slug = 'breathedivinity-hollow-souls';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Charcoal', '#3a3a3a', 2, 'Grey' from products where slug = 'breathedivinity-hollow-souls';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Blue', '#1c4aa0', 4, 'Blue' from products where slug = 'breathedivinity-hollow-souls';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Green', '#1c8a3a', 5, 'Green' from products where slug = 'breathedivinity-hollow-souls';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Black', '#141414', 7, 'Black' from products where slug = 'breathedivinity-hollow-souls';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Purple', '#5a1ca0', 9, 'Purple' from products where slug = 'breathedivinity-hollow-souls';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Orange', '#c46a1e', 10, 'Orange' from products where slug = 'breathedivinity-hollow-souls';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Pink', '#c41e8a', 11, 'Pink' from products where slug = 'breathedivinity-hollow-souls';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'White', '#3a3a3a', 0, 'White' from products where slug = 'breathedivinity-voidtech-berserker';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Red', '#a01c1c', 2, 'Red' from products where slug = 'breathedivinity-voidtech-berserker';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Purple', '#5a1ca0', 4, 'Purple' from products where slug = 'breathedivinity-voidtech-berserker';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Blue', '#1c4aa0', 6, 'Blue' from products where slug = 'breathedivinity-voidtech-berserker';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Black', '#141414', 0, 'Black' from products where slug = 'breathedivinity-voidtech-cyber-skeleton';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Purple', '#5a1ca0', 2, 'Purple' from products where slug = 'breathedivinity-voidtech-cyber-skeleton';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Red', '#a01c1c', 0, 'Red' from products where slug = 'breathedivinity-voidtech-immortal';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'White Red', '#8a1c1c', 2, 'White' from products where slug = 'breathedivinity-voidtech-immortal';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'White', '#3a3a3a', 4, 'White' from products where slug = 'breathedivinity-voidtech-immortal';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Purple', '#5a1ca0', 6, 'Purple' from products where slug = 'breathedivinity-voidtech-immortal';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Green', '#1c8a3a', 8, 'Green' from products where slug = 'breathedivinity-voidtech-immortal';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Purple', '#5a1ca0', 0, 'Purple' from products where slug = 'breathedivinity-voidtech-infernal';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'White', '#3a3a3a', 2, 'White' from products where slug = 'breathedivinity-voidtech-infernal';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Red', '#a01c1c', 4, 'Red' from products where slug = 'breathedivinity-voidtech-infernal';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Blue', '#1c4aa0', 6, 'Blue' from products where slug = 'breathedivinity-voidtech-infernal';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Pink', '#c41e8a', 9, 'Pink' from products where slug = 'breathedivinity-voidtech-infernal';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'White', '#1a1a1a', 0, 'White' from products where slug = 'breathedivinity-voidtech-nightfall-half-sleeve';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Crimson Red', '#5a1a1a', 1, 'Red' from products where slug = 'breathedivinity-voidtech-nightfall-half-sleeve';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Gold', '#8a5a00', 2, 'Gold' from products where slug = 'breathedivinity-voidtech-nightfall-half-sleeve';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'White', '#3a3a3a', 0, 'White' from products where slug = 'breathedivinity-voidtech-pulsefire';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'PulseFire', '#a01c5a', 1, 'Pink' from products where slug = 'breathedivinity-voidtech-pulsefire';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Purple', '#5a1ca0', 2, 'Purple' from products where slug = 'breathedivinity-voidtech-pulsefire';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Blue', '#1c4aa0', 3, 'Blue' from products where slug = 'breathedivinity-voidtech-pulsefire';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Orange', '#c46a1e', 4, 'Orange' from products where slug = 'breathedivinity-voidtech-pulsefire';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Black', '#141414', 0, 'Black' from products where slug = 'chromehearts-forever-denim-jacket';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Denim Blue', '#6b9fd4', 0, 'Denim' from products where slug = 'chromehearts-mastermind-ripped-denim-jacket';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 1', '#2a2a2a', 0, 'Black' from products where slug = 'chromehearts-retro-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 2', '#2a2a2a', 2, 'Black' from products where slug = 'chromehearts-retro-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 3', '#2a2a2a', 4, 'Black' from products where slug = 'chromehearts-retro-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 4', '#2a2a2a', 6, 'Black' from products where slug = 'chromehearts-retro-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 5', '#2a2a2a', 8, 'Black' from products where slug = 'chromehearts-retro-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 6', '#2a2a2a', 10, 'Black' from products where slug = 'chromehearts-retro-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 7', '#2a2a2a', 12, 'Black' from products where slug = 'chromehearts-retro-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 8', '#2a2a2a', 14, 'Black' from products where slug = 'chromehearts-retro-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 9', '#2a2a2a', 16, 'Black' from products where slug = 'chromehearts-retro-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 10', '#2a2a2a', 18, 'Black' from products where slug = 'chromehearts-retro-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 11', '#2a2a2a', 20, 'Black' from products where slug = 'chromehearts-retro-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 12', '#2a2a2a', 22, 'Black' from products where slug = 'chromehearts-retro-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 13', '#2a2a2a', 24, 'Black' from products where slug = 'chromehearts-retro-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 14', '#2a2a2a', 26, 'Black' from products where slug = 'chromehearts-retro-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 15', '#2a2a2a', 28, 'Black' from products where slug = 'chromehearts-retro-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 16', '#2a2a2a', 30, 'Black' from products where slug = 'chromehearts-retro-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 17', '#2a2a2a', 32, 'Black' from products where slug = 'chromehearts-retro-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 18', '#2a2a2a', 34, 'Black' from products where slug = 'chromehearts-retro-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 19', '#2a2a2a', 36, 'Black' from products where slug = 'chromehearts-retro-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 20', '#2a2a2a', 38, 'Black' from products where slug = 'chromehearts-retro-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 21', '#2a2a2a', 40, 'Black' from products where slug = 'chromehearts-retro-hoodie';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 1', '#2a2a2a', 0, 'Black' from products where slug = 'chromehearts-retro-jeans';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 2', '#2a2a2a', 1, 'Black' from products where slug = 'chromehearts-retro-jeans';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 3', '#2a2a2a', 2, 'Black' from products where slug = 'chromehearts-retro-jeans';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 4', '#2a2a2a', 3, 'Black' from products where slug = 'chromehearts-retro-jeans';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 5', '#2a2a2a', 4, 'Black' from products where slug = 'chromehearts-retro-jeans';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 6', '#2a2a2a', 5, 'Black' from products where slug = 'chromehearts-retro-jeans';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 1', '#2a2a2a', 0, 'Black' from products where slug = 'chromehearts-retro-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 2', '#2a2a2a', 1, 'Black' from products where slug = 'chromehearts-retro-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 3', '#2a2a2a', 2, 'Black' from products where slug = 'chromehearts-retro-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 4', '#2a2a2a', 4, 'Black' from products where slug = 'chromehearts-retro-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 5', '#2a2a2a', 6, 'Black' from products where slug = 'chromehearts-retro-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 6', '#2a2a2a', 8, 'Black' from products where slug = 'chromehearts-retro-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 7', '#2a2a2a', 10, 'Black' from products where slug = 'chromehearts-retro-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 8', '#2a2a2a', 12, 'Black' from products where slug = 'chromehearts-retro-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 9', '#2a2a2a', 14, 'Black' from products where slug = 'chromehearts-retro-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 10', '#2a2a2a', 16, 'Black' from products where slug = 'chromehearts-retro-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 11', '#2a2a2a', 18, 'Black' from products where slug = 'chromehearts-retro-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 12', '#2a2a2a', 20, 'Black' from products where slug = 'chromehearts-retro-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 13', '#2a2a2a', 22, 'Black' from products where slug = 'chromehearts-retro-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 14', '#2a2a2a', 24, 'Black' from products where slug = 'chromehearts-retro-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 15', '#2a2a2a', 26, 'Black' from products where slug = 'chromehearts-retro-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 16', '#2a2a2a', 28, 'Black' from products where slug = 'chromehearts-retro-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 17', '#2a2a2a', 30, 'Black' from products where slug = 'chromehearts-retro-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 18', '#2a2a2a', 32, 'Black' from products where slug = 'chromehearts-retro-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 19', '#2a2a2a', 34, 'Black' from products where slug = 'chromehearts-retro-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 20', '#2a2a2a', 36, 'Black' from products where slug = 'chromehearts-retro-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 21', '#2a2a2a', 38, 'Black' from products where slug = 'chromehearts-retro-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 1', '#2a2a2a', 0, 'Black' from products where slug = 'chromehearts-vintage-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 2', '#2a2a2a', 1, 'Black' from products where slug = 'chromehearts-vintage-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 3', '#2a2a2a', 2, 'Black' from products where slug = 'chromehearts-vintage-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 4', '#2a2a2a', 3, 'Black' from products where slug = 'chromehearts-vintage-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 5', '#2a2a2a', 4, 'Black' from products where slug = 'chromehearts-vintage-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 6', '#2a2a2a', 5, 'Black' from products where slug = 'chromehearts-vintage-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 7', '#2a2a2a', 6, 'Black' from products where slug = 'chromehearts-vintage-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 8', '#2a2a2a', 7, 'Black' from products where slug = 'chromehearts-vintage-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 9', '#2a2a2a', 8, 'Black' from products where slug = 'chromehearts-vintage-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 1', '#2a2a2a', 0, 'Black' from products where slug = 'cactusjack-astroworld-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 2', '#2a2a2a', 1, 'Black' from products where slug = 'cactusjack-astroworld-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 3', '#2a2a2a', 2, 'Black' from products where slug = 'cactusjack-astroworld-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 4', '#2a2a2a', 3, 'Black' from products where slug = 'cactusjack-astroworld-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 5', '#2a2a2a', 4, 'Black' from products where slug = 'cactusjack-astroworld-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 6', '#2a2a2a', 5, 'Black' from products where slug = 'cactusjack-astroworld-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 7', '#2a2a2a', 6, 'Black' from products where slug = 'cactusjack-astroworld-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 8', '#2a2a2a', 7, 'Black' from products where slug = 'cactusjack-astroworld-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 9', '#2a2a2a', 8, 'Black' from products where slug = 'cactusjack-astroworld-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 10', '#2a2a2a', 9, 'Black' from products where slug = 'cactusjack-astroworld-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 1', '#2a2a2a', 0, 'Black' from products where slug = 'cactusjack-fragment-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 2', '#2a2a2a', 1, 'Black' from products where slug = 'cactusjack-fragment-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 3', '#2a2a2a', 2, 'Black' from products where slug = 'cactusjack-fragment-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 4', '#2a2a2a', 3, 'Black' from products where slug = 'cactusjack-fragment-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 5', '#2a2a2a', 4, 'Black' from products where slug = 'cactusjack-fragment-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 6', '#2a2a2a', 5, 'Black' from products where slug = 'cactusjack-fragment-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 1', '#2a2a2a', 0, 'Black' from products where slug = 'cactusjack-mcdonalds-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 2', '#2a2a2a', 1, 'Black' from products where slug = 'cactusjack-mcdonalds-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 3', '#2a2a2a', 2, 'Black' from products where slug = 'cactusjack-mcdonalds-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 4', '#2a2a2a', 3, 'Black' from products where slug = 'cactusjack-mcdonalds-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 5', '#2a2a2a', 4, 'Black' from products where slug = 'cactusjack-mcdonalds-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 6', '#2a2a2a', 5, 'Black' from products where slug = 'cactusjack-mcdonalds-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 7', '#2a2a2a', 6, 'Black' from products where slug = 'cactusjack-mcdonalds-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 8', '#2a2a2a', 7, 'Black' from products where slug = 'cactusjack-mcdonalds-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 9', '#2a2a2a', 8, 'Black' from products where slug = 'cactusjack-mcdonalds-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 10', '#2a2a2a', 9, 'Black' from products where slug = 'cactusjack-mcdonalds-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 11', '#2a2a2a', 10, 'Black' from products where slug = 'cactusjack-mcdonalds-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 12', '#2a2a2a', 11, 'Black' from products where slug = 'cactusjack-mcdonalds-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 13', '#2a2a2a', 12, 'Black' from products where slug = 'cactusjack-mcdonalds-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 14', '#2a2a2a', 13, 'Black' from products where slug = 'cactusjack-mcdonalds-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 1', '#2a2a2a', 0, 'Black' from products where slug = 'cactusjack-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 2', '#2a2a2a', 1, 'Black' from products where slug = 'cactusjack-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 3', '#2a2a2a', 2, 'Black' from products where slug = 'cactusjack-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 4', '#2a2a2a', 3, 'Black' from products where slug = 'cactusjack-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 5', '#2a2a2a', 4, 'Black' from products where slug = 'cactusjack-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 6', '#2a2a2a', 5, 'Black' from products where slug = 'cactusjack-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 7', '#2a2a2a', 6, 'Black' from products where slug = 'cactusjack-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 8', '#2a2a2a', 7, 'Black' from products where slug = 'cactusjack-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 1', '#2a2a2a', 0, 'Black' from products where slug = 'cactusjack-playstation-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 2', '#2a2a2a', 1, 'Black' from products where slug = 'cactusjack-playstation-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Variant 3', '#2a2a2a', 2, 'Black' from products where slug = 'cactusjack-playstation-oversized-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Heather Grey', '#c9c9c9', 0, 'Grey' from products where slug = 'skims-cotton-jersey-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Black', '#141414', 3, 'Black' from products where slug = 'skims-cotton-jersey-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'White', '#f0ede8', 6, 'White' from products where slug = 'skims-cotton-jersey-tshirt';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Black', '#141414', 0, 'Black' from products where slug = 'skims-rhinestone-logo-mini-dress';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Pink', '#e8a8cf', 2, 'Pink' from products where slug = 'skims-rhinestone-logo-mini-dress';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'White', '#f0ede8', 4, 'White' from products where slug = 'skims-rhinestone-logo-mini-dress';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Blue', '#a8bcc8', 0, 'Blue' from products where slug = 'lululemon-define-nulu-align-yoga-set';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Mauve', '#c9a898', 2, 'Grey' from products where slug = 'lululemon-define-nulu-align-yoga-set';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'Black', '#141414', 4, 'Black' from products where slug = 'lululemon-define-nulu-align-yoga-set';
insert into product_colors (product_id, label, hex, image_index, color_group) select id, 'White', '#f0ede8', 6, 'White' from products where slug = 'lululemon-define-nulu-align-yoga-set';
