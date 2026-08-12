-- Task 5 (admin product editor): fix product_colors.cover_image_id FK so deleting
-- a product_images row that is currently used as a color's cover does not fail
-- with a foreign-key-violation error. Previously this FK had no ON DELETE clause
-- (defaults to NO ACTION); change it to ON DELETE SET NULL so the delete succeeds
-- and the color simply loses its cover reference (admin can assign a new one).
alter table product_colors
  drop constraint product_colors_cover_image_id_fkey,
  add constraint product_colors_cover_image_id_fkey
    foreign key (cover_image_id) references product_images(id) on delete set null;
