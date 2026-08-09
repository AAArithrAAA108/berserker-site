alter table products
  add column position int,
  add column category text,
  add column sleeve_length text,
  add column description text;

alter table products
  add constraint products_category_check
    check (category in ('t-shirt','compression','pants','jacket','dress','set')),
  add constraint products_sleeve_length_check
    check (sleeve_length is null or sleeve_length in ('half','full','sleeveless'));
