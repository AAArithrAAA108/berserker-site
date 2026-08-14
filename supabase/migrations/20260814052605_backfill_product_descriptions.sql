-- Backfill products.description from the real, hand-authored PDP pages'
-- .pdp-description content (extracted verbatim, minus the shared
-- "See Shipping Info / Returns & Refunds" boilerplate footer that render.ts
-- already re-appends). One product (gymshark-hoodie, slug "gymshark-hoodie")
-- has no corresponding real PDP file -- it was added directly via the DB
-- after the static pages were hand-authored -- so it is intentionally
-- excluded here and stays null rather than having text invented for it.

update products as p
set description = v.description
from (values
  ('breathedivinity-blood-oath-sweatpants', 'Blood Oath Sweatpants, quality-checked before it leaves our facility.'),
  ('breathedivinity-bloodraven', 'Bloodraven Oversized T-Shirt, quality-checked before it leaves our facility.'),
  ('breathedivinity-deathclaw', 'Deathclaw Oversized T-Shirt, quality-checked before it leaves our facility.'),
  ('breathedivinity-deathwing-oversized-hoodie', 'Deathwing Oversized Hoodie, quality-checked before it leaves our facility.'),
  ('breathedivinity-dragon-blade', 'Dragon Blade Oversized T-Shirt, quality-checked before it leaves our facility.'),
  ('breathedivinity-eternal-wyvern-oversized-sweatpants', 'Eternal Wyvern Oversized Sweatpants, quality-checked before it leaves our facility.'),
  ('breathedivinity-fallen-knight-long-sleeve', 'Fallen Knight Long Sleeve Compression, quality-checked before it leaves our facility.'),
  ('breathedivinity-gargoyle', 'Gargoyle Oversized T-Shirt, quality-checked before it leaves our facility.'),
  ('breathedivinity-hollow-souls', 'Hollow Souls Oversized T-Shirt, quality-checked before it leaves our facility.'),
  ('breathedivinity-voidtech-berserker', 'VoidTech Berserker Compression, quality-checked before it leaves our facility.'),
  ('breathedivinity-voidtech-cyber-skeleton', 'VoidTech Cyber Skeleton Compression, quality-checked before it leaves our facility.'),
  ('breathedivinity-voidtech-immortal', 'VoidTech Immortal Compression, quality-checked before it leaves our facility.'),
  ('breathedivinity-voidtech-infernal', 'VoidTech Infernal Compression, quality-checked before it leaves our facility.'),
  ('breathedivinity-voidtech-nightfall-half-sleeve', 'VoidTech Nightfall Compression Half Sleeve, quality-checked before it leaves our facility.'),
  ('breathedivinity-voidtech-pulsefire', 'VoidTech PulseFire Compression, quality-checked before it leaves our facility.'),
  ('cactusjack-astroworld-oversized-tshirt', 'Astroworld Oversized T-Shirt, quality-checked before it leaves our facility.'),
  ('cactusjack-oversized-tshirt', 'Oversized T-Shirt, quality-checked before it leaves our facility.'),
  ('cactusjack-fragment-oversized-tshirt', 'Oversized T-Shirt, quality-checked before it leaves our facility.'),
  ('cactusjack-mcdonalds-oversized-tshirt', 'Oversized T-Shirt, quality-checked before it leaves our facility.'),
  ('cactusjack-playstation-oversized-tshirt', 'Oversized T-Shirt, quality-checked before it leaves our facility.'),
  ('chromehearts-forever-denim-jacket', 'Forever Black Denim Jacket, quality-checked before it leaves our facility.'),
  ('chromehearts-retro-hoodie', 'Retro Hoodie, quality-checked before it leaves our facility.'),
  ('chromehearts-retro-jeans', 'Retro Jeans, quality-checked before it leaves our facility.'),
  ('chromehearts-retro-oversized-tshirt', 'Retro Oversized T-Shirt, quality-checked before it leaves our facility.'),
  ('chromehearts-vintage-oversized-tshirt', 'Vintage Oversized T-Shirt, quality-checked before it leaves our facility.'),
  ('chromehearts-mastermind-ripped-denim-jacket', 'Ripped Denim Jacket, quality-checked before it leaves our facility.'),
  ('gymshark-founder-hoodie', 'Founder Edition Oversized Hoodie, quality-checked before it leaves our facility.'),
  ('gymshark-lifting-essential-joggers', 'Lifting Essential Joggers, quality-checked before it leaves our facility.'),
  ('gymshark-onyx-5-long-sleeve', 'Onyx 5.0 Seamless Compression Full Sleeve, quality-checked before it leaves our facility.'),
  ('gymshark-onyx-5-half-sleeve', 'Seamless compression half sleeve built for lifting and training, quality-checked before it leaves our facility.'),
  ('gymshark-onyx-5-sleeveless', 'Onyx 5.0 Seamless Compression Sleeveless, quality-checked before it leaves our facility.'),
  ('lululemon-define-nulu-align-yoga-set', 'Define Nulu Jacket + Align Yoga Pants Set, quality-checked before it leaves our facility.'),
  ('skims-cotton-jersey-tshirt', 'Cotton Jersey T-Shirt, quality-checked before it leaves our facility.'),
  ('skims-rhinestone-logo-mini-dress', 'Rhinestone Logo Pointelle Mini Slip Dress, quality-checked before it leaves our facility.'),
  ('youngla-divine-sweats', 'Divine Sweats Sweatpants, quality-checked before it leaves our facility.'),
  ('youngla-drip-oversized-tshirt', 'Drip Oversized T-Shirt, quality-checked before it leaves our facility.'),
  ('youngla-revenge-hoodie', 'Revenge Hoodie, quality-checked before it leaves our facility.'),
  ('youngla-revenge-joggers', 'Revenge Joggers, quality-checked before it leaves our facility.'),
  ('youngla-batman-half-sleeve', 'Compression Half Sleeve, quality-checked before it leaves our facility.'),
  ('youngla-gold''s-gym-tshirt', 'Slim Fit T-Shirt, quality-checked before it leaves our facility.'),
  ('youngla-superman-half-sleeve', 'Compression Half Sleeve, quality-checked before it leaves our facility.')
) as v(slug, description)
where p.slug = v.slug;
