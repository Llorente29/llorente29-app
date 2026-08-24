-- REVERT de 20260824T1200_separar_recetas_por_packaging.sql
--
-- Devuelve cada menu_item a su receta compartida original y borra las 6 copias.
-- Las recipe_line de las copias se van solas: recipe_line.parent_item_id tiene
-- ON DELETE CASCADE (verificado en pg_constraint antes de escribir esto).
--
-- Seguro de ejecutar mientras las 6 copias no se hayan editado a mano ni se les
-- haya colgado nada nuevo. Si alguien ya ha tocado una, este revert borra ese
-- trabajo: mirar antes con la consulta del final.

begin;

update menu_item set recipe_item_id = '6e758cbe-e026-479f-b0c2-3a906d2edb3a', updated_at = now()
 where id = '6a567e58-de06-45dc-9d0a-0f918b69d0e2';
update menu_item set recipe_item_id = '04f49285-152e-409f-abbd-b1fffad40fa7', updated_at = now()
 where id in ('69bfde17-aa86-4508-821f-531d24eb4f4d','2fe436c2-c1f3-41e9-ad42-5045f53fa2c6');
update menu_item set recipe_item_id = 'fda4a8a4-9d7f-4f45-a17d-d91a38eb488a', updated_at = now()
 where id = '938108c7-7276-4407-badb-ec5fc01fe494';
update menu_item set recipe_item_id = '2122e022-4584-47c9-b4d7-3ad56530657a', updated_at = now()
 where id = 'd38bafc8-7b36-4694-b896-9d5821c254bf';
update menu_item set recipe_item_id = 'bbb1fc5c-0332-4307-816a-54bfca666470', updated_at = now()
 where id = 'da239169-2ec3-4093-994f-607409281c20';

delete from recipe_item
 where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
   and id in ('5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a01','5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a02',
              '5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a03','5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a04',
              '5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a05','5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a06');

commit;

-- Antes de revertir, comprobar que nadie ha editado las copias:
--   select id, name, updated_at from recipe_item
--    where id::text like '5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a%';
