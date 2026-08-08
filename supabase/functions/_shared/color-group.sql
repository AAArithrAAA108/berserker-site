-- Read-only mirror of the live classify_color_group() function in schema.sql for repo visibility

create or replace function classify_color_group(hex text)
returns text
language plpgsql
immutable
as $$
declare
  r int; g int; b int;
  palette text[] := array['Black','White','Grey','Red','Blue','Green','Purple','Pink','Orange','Navy','Maroon','Gold','Brown','Cream','Denim'];
  palette_hex text[] := array['#141414','#f0ede8','#8a8a8a','#c41e1e','#1c4aa0','#1c8a3a','#5a1ca0','#c41e8a','#c46a1e','#1c2c4a','#5a1a1a','#c4a01c','#5a3f2a','#ede9e3','#6b9fd4'];
  best_name text := 'Black';
  best_dist float8 := 'Infinity'::float8;
  i int;
  pr int; pg int; pb int;
  dist float8;
begin
  if hex is null or length(hex) != 7 then
    return 'Uncategorized';
  end if;
  r := ('x' || substr(hex, 2, 2))::bit(8)::int;
  g := ('x' || substr(hex, 4, 2))::bit(8)::int;
  b := ('x' || substr(hex, 6, 2))::bit(8)::int;
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
