-- Finding 6: the raw-RGB-Euclidean classifier in classify_color_group() loses
-- hue for dark/desaturated colours, so e.g. Forest Green #1a4a1a landed in
-- Black and Purple #3a1a5a landed in Navy. Where the colour's own text label
-- already names a palette colour, that name is far more reliable than the hex.
--
-- Resolution order per row:
--   1. the earliest whole-word palette colour name in the label wins
--      (whole-word, so "Stealth Black" is Black and not Green via "s-TEAL-th");
--   2. otherwise a vague neutral word ("stealth") -> Grey;
--   3. otherwise a near-neutral hex (max-min channel spread <= 16) is bucketed
--      by lightness, because the distance classifier maps flat greys like
--      #2a2a2a to Navy;
--   4. otherwise fall back to the existing hex-distance classifier.
with kw(word, grp) as (values
  ('black','Black'),('white','White'),('grey','Grey'),('gray','Grey'),('charcoal','Grey'),
  ('red','Red'),('crimson','Red'),('blue','Blue'),('denim','Denim'),
  ('green','Green'),('teal','Green'),('purple','Purple'),('pink','Pink'),
  ('orange','Orange'),('navy','Navy'),('maroon','Maroon'),('gold','Gold'),
  ('brown','Brown'),('cream','Cream'),('beige','Cream')
),
rgb as (
  select pc.id, pc.label, pc.hex,
    case when pc.hex ~* '^#[0-9a-f]{6}$' then ('x'||substr(pc.hex,2,2))::bit(8)::int end as r,
    case when pc.hex ~* '^#[0-9a-f]{6}$' then ('x'||substr(pc.hex,4,2))::bit(8)::int end as g,
    case when pc.hex ~* '^#[0-9a-f]{6}$' then ('x'||substr(pc.hex,6,2))::bit(8)::int end as b
  from product_colors pc
),
resolved as (
  select rgb.*, k.grp as label_group
  from rgb
  left join lateral (
    select grp from kw
    where lower(rgb.label) ~ ('\m' || word || '\M')
    order by strpos(lower(rgb.label), word) asc, length(word) desc
    limit 1
  ) k on true
)
update product_colors pc
set color_group = coalesce(
  resolved.label_group,
  case when lower(resolved.label) ~ '\mstealth\M' then 'Grey' end,
  case when resolved.r is not null
        and greatest(resolved.r, resolved.g, resolved.b) - least(resolved.r, resolved.g, resolved.b) <= 16
       then case when greatest(resolved.r, resolved.g, resolved.b) < 60 then 'Black'
                 when least(resolved.r, resolved.g, resolved.b) > 200 then 'White'
                 else 'Grey' end end,
  classify_color_group(resolved.hex)
)
from resolved
where pc.id = resolved.id;
