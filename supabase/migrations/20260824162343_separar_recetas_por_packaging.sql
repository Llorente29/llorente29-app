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

create temporary table _swap (dst uuid, from_child uuid, to_child uuid) on commit drop;

insert into _swap (dst, from_child, to_child) values
  ('5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a01','ac0cfcde-03fa-4a8b-b74c-57d45dc17440','014c176e-f039-406f-bfb1-91297921bab5'),
  ('5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a02','ac0cfcde-03fa-4a8b-b74c-57d45dc17440','014c176e-f039-406f-bfb1-91297921bab5'),
  ('5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a03','ac0cfcde-03fa-4a8b-b74c-57d45dc17440','ba2a9f67-dca1-4c7c-90a1-79873eb90bbe'),
  ('5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a04','ac0cfcde-03fa-4a8b-b74c-57d45dc17440','014c176e-f039-406f-bfb1-91297921bab5'),
  ('5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a05','e21208fb-281b-4839-af3b-524835b46aeb','0ea41658-935a-4d05-88ba-78cb173a1153'),
  ('5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a05','ba2a9f67-dca1-4c7c-90a1-79873eb90bbe','014c176e-f039-406f-bfb1-91297921bab5'),
  ('5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a05','2335c2f9-7dd5-410d-8529-c1decfd8a106','76a414eb-11c4-40ca-aaae-2c718c4ec51f');

create temporary table _add (dst uuid, child uuid, qty numeric, pos int) on commit drop;
insert into _add (dst, child, qty, pos) values
  ('5f9a1c20-7d64-4a11-9c01-0b1e2d3f4a06','ba2a9f67-dca1-4c7c-90a1-79873eb90bbe', 1, 12);

insert into recipe_item
select (jsonb_populate_record(
          null::recipe_item,
          to_jsonb(ri) || jsonb_build_object(
            'id',           s.dst,
            'name',         s.new_name,
            'folvy_code',   null,
            'code',         null,
            'needs_review', true,
            'created_at',   now(),
            'updated_at',   now()
          ))).*
from recipe_item ri
join _split s on s.src = ri.id
where ri.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710';

insert into recipe_line
  (id, account_id, parent_item_id, child_item_id, quantity_net, quantity_gross,
   unit_id, cut_type_id, comment, position)
select gen_random_uuid(), rl.account_id, s.dst,
       coalesce(w.to_child, rl.child_item_id),
       rl.quantity_net, rl.quantity_gross, rl.unit_id, rl.cut_type_id,
       rl.comment, rl.position
from recipe_line rl
join _split s on s.src = rl.parent_item_id
left join _swap w on w.dst = s.dst and w.from_child = rl.child_item_id
where rl.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710';

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

update menu_item mi
   set recipe_item_id = s.dst, updated_at = now()
from _split s
where mi.id = s.menu_item_id
  and mi.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710';

do $$
declare v_items int; v_lines_src int; v_lines_dst int; v_menu int; v_fuga int;
begin
  select count(*) into v_items from recipe_item where id in (select dst from _split);
  if v_items <> 6 then
    raise exception 'Esperaba 6 recetas nuevas, hay %', v_items;
  end if;

  select sum(c) into v_lines_src from (
    select count(*) c from recipe_line rl join _split s on s.src = rl.parent_item_id
     group by s.dst) t;
  select count(*) into v_lines_dst from recipe_line rl
   where rl.parent_item_id in (select dst from _split);
  if v_lines_dst <> v_lines_src + (select count(*) from _add) then
    raise exception 'Lineas descuadradas: origen %, copia %', v_lines_src, v_lines_dst;
  end if;

  select count(*) into v_menu from menu_item mi join _split s on s.menu_item_id = mi.id
   where mi.recipe_item_id = s.dst;
  if v_menu <> 6 then
    raise exception 'Esperaba 6 menu_item reapuntados, hay %', v_menu;
  end if;

  select count(*) into v_fuga
    from recipe_line rl join _swap w on w.dst = rl.parent_item_id
                                    and w.from_child = rl.child_item_id;
  if v_fuga <> 0 then
    raise exception 'Quedan % lineas con el packaging viejo en una copia', v_fuga;
  end if;
end $$;