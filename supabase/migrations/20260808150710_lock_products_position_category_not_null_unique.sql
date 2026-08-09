alter table products
  alter column position set not null,
  alter column category set not null,
  add constraint products_position_unique unique (position);
