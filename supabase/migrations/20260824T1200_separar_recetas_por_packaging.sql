-- 20260824T1200_separar_recetas_por_packaging.sql
--
-- PROBLEMA
-- Cinco recetas compartidas entre marcas llevan packaging PERSONALIZADO de UNA
-- marca. Como el menu_item de cada marca apunta a la MISMA receta, un Burrito
-- de Bendito sale con bolsa impresa de Birria Burrito.
--
-- SOLUCIÓN
-- Una receta por marca que necesite packaging distinto: se copia el recipe_item
-- entero, se copian TODAS sus recipe_line (la comida es idéntica), se cambia
-- solo la línea de packaging, y se reapunta el menu_item de esa marca.
-- La marca "dueña" del packaging actual se queda con la receta original.
--
-- Comprobado antes de escribir esto:
--   * El espejo "Burrito Colosal de Cochinita ★" (36e47125) tiene
--     recipe_item_id = NULL, así que NO arrastra receta y no hay que tocarlo.
--   * combo_slot_option referencia menu_item, no recipe_item: reapuntar la
--     receta le es transparente. 13 filas comprobadas.
--   * No hay menu_item archivados ni recipe_line que usen estas 5 como hijo.
--   * uq_recipe_item_folvy_code (account_id, folvy_code) -> la copia nace con
--     folvy_code NULL. Dos NULL no colisionan.
--   * uq_recipe_line_parent_child (parent, child, position) -> el padre es
--     nuevo, no hay choque; ningún destino tiene ya el packaging que se mete.

begin;

-- ── Qué se separa ───────────────────────────────────────────────────────────
create temporary table _split (
  src uuid, dst uuid, new_name text, menu_item_id uuid, etiqueta text
) on commit drop;

insert into _split (src, dst, new_name, menu_item_id, etiqueta) values
  ('6e758cbe-e026-479f-b0c2-3a906d2edb3a','5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a01',
   'Burrito Colosal de Cochinita (Bendito)','6a567e58-de06-45dc-9d0a-0f918b69d0e2','1·Bendito'),
  ('04f49285-152e-409f-abbd-b1fffad40fa7','5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a02',
   'Burrito Tremendo de Birria de Ternera (Bendito)','69bfde17-aa86-4508-821f-531d24eb4f4d','2·Bendito'),
  ('04f49285-152e-409f-abbd-b1fffad40fa7','5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a03',
   'Burrito Tremendo de Birria de Ternera (DC)','2fe436c2-c1f3-41e9-ad42-5045f53fa2c6','2·DC'),
  ('fda4a8a4-9d7f-4f45-a17d-d91a38eb488a','5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a04',
   'Quesadilla de Pollo (Bendito)','938108c7-7276-4407-badb-ec5fc01fe494','3·Bendito'),
  ('2122e022-4584-47c9-b4d7-3ad56530657a','5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a05',
   'Quesatacos Carnitas (Bendito)','d38bafc8-7b36-4694-b896-9d5821c254bf','4·Bendito'),
  ('bbb1fc5c-0332-4307-816a-54bfca666470','5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a06',
   'Quesatacos Birria Ternera (DC)','da239169-2ec3-4093-994f-607409281c20','5·DC');

-- Cambios de packaging: en la COPIA, este hijo pasa a ser aquel otro.
create temporary table _swap (dst uuid, from_child uuid, to_child uuid) on commit drop;

insert into _swap (dst, from_child, to_child) values
  -- 1 · Bendito: Bolsas Personalizadas Birria Burrito -> kraft genérica
  ('5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a01','ac0cfcde-03fa-4a8b-b74c-57d45dc17440','014c176e-f039-406f-bfb1-91297921bab5'),
  -- 2 · Bendito: idem
  ('5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a02','ac0cfcde-03fa-4a8b-b74c-57d45dc17440','014c176e-f039-406f-bfb1-91297921bab5'),
  -- 2 · DC: Bolsas Personalizadas Birria Burrito -> Bolsas Dos Coyotes
  ('5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a03','ac0cfcde-03fa-4a8b-b74c-57d45dc17440','ba2a9f67-dca1-4c7c-90a1-79873eb90bbe'),
  -- 3 · Bendito: idem kraft
  ('5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a04','ac0cfcde-03fa-4a8b-b74c-57d45dc17440','014c176e-f039-406f-bfb1-91297921bab5'),
  -- 4 · Bendito: los TRES de marca Dos Coyotes que se van.
  --   Caja Dos Coyotes            -> CAJA GENERICA 1350Ml
  --   Bolsas Dos Coyotes          -> kraft genérica
  --   Papel Antigrasa Dos Coyotes -> Envoltorio Pergamino 31x31 blanco
  --     (no existe un "papel antigrasa genérico" en el catálogo: los dos que
  --      hay son de marca, Dos Coyotes y Fitipaldi. El pergamino blanco es el
  --      envoltorio neutro que ya usan los dos burritos.)
  --   "Soporte Caldo Caja Dos Coyotes" SE QUEDA, por decisión de Julio: el
  --   caldo necesita sujeción. Queda anotado que está pensado para la Caja DC
  --   y la copia usa la genérica.
  ('5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a05','e21208fb-281b-4839-af3b-524835b46aeb','0ea41658-935a-4d05-88ba-78cb173a1153'),
  ('5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a05','ba2a9f67-dca1-4c7c-90a1-79873eb90bbe','014c176e-f039-406f-bfb1-91297921bab5'),
  ('5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a05','2335c2f9-7dd5-410d-8529-c1decfd8a106','76a414eb-11c4-40ca-aaae-2c718c4ec51f');

-- Líneas NUEVAS que no existen en el origen (caso 5: la receta no tenía bolsa).
create temporary table _add (dst uuid, child uuid, qty numeric, pos int) on commit drop;
insert into _add (dst, child, qty, pos) values
  ('5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a06','ba2a9f67-dca1-4c7c-90a1-79873eb90bbe', 1, 12);

-- ── 1 · La copia del recipe_item ────────────────────────────────────────────
-- Ida y vuelta por jsonb para copiar TODAS las columnas (incluidas las que se
-- añadan en el futuro) y sobrescribir solo lo que debe cambiar.
insert into recipe_item
select (jsonb_populate_record(
          null::recipe_item,
          to_jsonb(ri) || jsonb_build_object(
            'id',           s.dst,
            'name',         s.new_name,
            'folvy_code',   null,          -- índice único (account_id, folvy_code)
            'code',         null,          -- el código del original no es de esta
            'needs_review', true,          -- el coste no está recalculado aún
            'created_at',   now(),
            'updated_at',   now()
          ))).*
from recipe_item ri
join _split s on s.src = ri.id
where ri.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710';

-- ── 2 · Las líneas: comida idéntica, packaging cambiado ─────────────────────
insert into recipe_line
  (id, account_id, parent_item_id, child_item_id, quantity_net, quantity_gross,
   unit_id, cut_type_id, comment, position)
select gen_random_uuid(), rl.account_id, s.dst,
       coalesce(w.to_child, rl.child_item_id),          -- <- el único cambio
       rl.quantity_net, rl.quantity_gross, rl.unit_id, rl.cut_type_id,
       rl.comment, rl.position
from recipe_line rl
join _split s on s.src = rl.parent_item_id
left join _swap w on w.dst = s.dst and w.from_child = rl.child_item_id
where rl.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710';

-- ── 3 · Las líneas añadidas (caso 5) ────────────────────────────────────────
-- La unidad se toma de una línea de packaging del propio origen: así la unidad
-- es la que ya usa esa receta para envases, no una inventada.
insert into recipe_line
  (id, account_id, parent_item_id, child_item_id, quantity_net, quantity_gross,
   unit_id, position)
select gen_random_uuid(), '51ad1792-6629-4ef7-833a-b57b09a86710', a.dst, a.child,
       a.qty, a.qty,
       (select rl.unit_id from recipe_line rl
          join recipe_item ch on ch.id = rl.child_item_id
         where rl.parent_item_id = s.src and ch.type = 'packaging'
         order by rl.position limit 1),
       a.pos
from _add a join _split s on s.dst = a.dst;

-- ── 4 · Reapuntar el menu_item de cada marca a su receta ────────────────────
update menu_item mi
   set recipe_item_id = s.dst, updated_at = now()
from _split s
where mi.id = s.menu_item_id
  and mi.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710';

-- ── 5 · Guardas: si algo no cuadra, la transacción entera se cae ────────────
do $$
declare v_items int; v_lines_src int; v_lines_dst int; v_menu int; v_fuga int;
begin
  select count(*) into v_items from recipe_item
   where id in (select dst from _split);
  if v_items <> 6 then
    raise exception 'Esperaba 6 recetas nuevas, hay %', v_items;
  end if;

  -- Cada copia debe tener EXACTAMENTE las líneas del origen (+ las añadidas).
  select sum(c) into v_lines_src from (
    select count(*) c from recipe_line rl join _split s on s.src = rl.parent_item_id
     group by s.dst) t;
  select count(*) into v_lines_dst from recipe_line rl
   where rl.parent_item_id in (select dst from _split);
  if v_lines_dst <> v_lines_src + (select count(*) from _add) then
    raise exception 'Líneas descuadradas: origen %, copia %', v_lines_src, v_lines_dst;
  end if;

  select count(*) into v_menu from menu_item mi join _split s on s.menu_item_id = mi.id
   where mi.recipe_item_id = s.dst;
  if v_menu <> 6 then
    raise exception 'Esperaba 6 menu_item reapuntados, hay %', v_menu;
  end if;

  -- Lo que motiva todo el encargo: ninguna copia puede conservar packaging
  -- de una marca ajena que hayamos declarado que se va.
  select count(*) into v_fuga
    from recipe_line rl join _swap w on w.dst = rl.parent_item_id
                                    and w.from_child = rl.child_item_id;
  if v_fuga <> 0 then
    raise exception 'Quedan % líneas con el packaging viejo en una copia', v_fuga;
  end if;
end $$;

commit;
