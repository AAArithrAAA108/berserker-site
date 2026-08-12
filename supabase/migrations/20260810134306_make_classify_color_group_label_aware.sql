-- Foundation's final review flagged that fix_color_group_prefer_label_over_hex_distance
-- only corrected EXISTING rows' color_group via a one-time UPDATE -- it never fixed
-- classify_color_group() itself, which still only takes hex and uses the flawed
-- raw-RGB-Euclidean classifier that loses hue for dark/desaturated colors (e.g.
-- #1a4a1a still returns 'Black' instead of 'Green'). This resurfaced in the admin
-- panel's "auto-suggest color_group" feature (Phase 2, Task 6), which calls this
-- function directly -- any new color added via the admin panel would reintroduce
-- the exact ~32% misclassification rate Foundation's data migration fixed for old
-- rows. This migration promotes that migration's label-first resolution logic into
-- the reusable function itself, replacing the single-arg signature with a new one
-- that accepts an optional label (default null, so any existing 1-arg caller keeps
-- working, just without the label-aware improvement).
drop function if exists classify_color_group(text);

create or replace function classify_color_group(hex text, label text default null)
returns text
language plpgsql
immutable
as $$
declare
  r int; g int; b int;
  palette text[] := array['Black','White','Grey','Red','Blue','Green','Purple','Pink','Orange','Navy','Maroon','Gold','Brown','Cream','Denim'];
  palette_hex text[] := array['#141414','#f0ede8','#8a8a8a','#c41e1e','#1c4aa0','#1c8a3a','#5a1ca0','#c41e8a','#c46a1e','#1c2c4a','#5a1a1a','#c4a01c','#5a3f2a','#ede9e3','#6b9fd4'];
  kw_words text[] := array['black','white','grey','gray','charcoal','red','crimson','blue','denim','green','teal','purple','pink','orange','navy','maroon','gold','brown','cream','beige'];
  kw_groups text[] := array['Black','White','Grey','Grey','Grey','Red','Red','Blue','Denim','Green','Green','Purple','Pink','Orange','Navy','Maroon','Gold','Brown','Cream','Cream'];
  lower_label text;
  best_word_pos int := null;
  best_word_len int := -1;
  best_word_group text := null;
  i int;
  pos int;
  best_name text := 'Black';
  best_dist float8 := 'Infinity'::float8;
  pr int; pg int; pb int;
  dist float8;
  spread int;
begin
  lower_label := lower(coalesce(label, ''));

  if lower_label <> '' then
    for i in 1 .. array_length(kw_words, 1) loop
      if lower_label ~ ('\m' || kw_words[i] || '\M') then
        pos := strpos(lower_label, kw_words[i]);
        if best_word_pos is null or pos < best_word_pos
           or (pos = best_word_pos and length(kw_words[i]) > best_word_len) then
          best_word_pos := pos;
          best_word_len := length(kw_words[i]);
          best_word_group := kw_groups[i];
        end if;
      end if;
    end loop;
    if best_word_group is not null then
      return best_word_group;
    end if;
    if lower_label ~ '\mstealth\M' then
      return 'Grey';
    end if;
  end if;

  if hex is null or length(hex) != 7 or hex !~* '^#[0-9a-f]{6}$' then
    return 'Uncategorized';
  end if;
  r := ('x' || substr(hex, 2, 2))::bit(8)::int;
  g := ('x' || substr(hex, 4, 2))::bit(8)::int;
  b := ('x' || substr(hex, 6, 2))::bit(8)::int;

  spread := greatest(r, g, b) - least(r, g, b);
  if spread <= 16 then
    if greatest(r, g, b) < 60 then return 'Black';
    elsif least(r, g, b) > 200 then return 'White';
    else return 'Grey';
    end if;
  end if;

  for i in 1 .. array_length(palette, 1) loop
    pr := ('x' || substr(palette_hex[i], 2, 2))::bit(8)::int;
    pg := ('x' || substr(palette_hex[i], 4, 2))::bit(8)::int;
    pb := ('x' || substr(palette_hex[i], 6, 2))::bit(8)::int;
    dist := pow(r - pr, 2) + pow(g - pg, 2) + pow(b - pb, 2);
    if dist < best_dist then
      best_dist := dist;
      best_name := palette[i];
    end if;
  end loop;
  return best_name;
end;
$$;
