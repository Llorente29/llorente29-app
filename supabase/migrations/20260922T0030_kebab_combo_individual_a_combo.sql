-- ============================================================================
-- Kebab Combo Individual (The Urban Kebab) : producto-con-extras -> COMBO
-- ----------------------------------------------------------------------------
-- Encargo 22/09/2026. Cuenta Foodint 51ad1792-6629-4ef7-833a-b57b09a86710.
--
-- PROPUESTA. NO APLICADA. La ejecuta Julio, FUERA DE SERVICIO (nunca entre
-- 12:15 y 00:30), y despues publica la carta a HubRise a mano.
--
-- Por que existe: `adapt_hubrise_order` solo crea `combo_item` cuando HubRise
-- manda un DEAL. Hoy esta ficha se publica como PRODUCTO (`product_type='item'`)
-- con cuatro grupos de extras, asi que llega como una sola linea sin articulo y
-- la base no descuenta nada. `hubrise-catalog-publish` reparte por
-- `product_type`: lo que es 'combo' sale como deal, lo demas como producto. El
-- cambio de tipo + los dos huecos es lo unico que hace falta.
--
-- Lo que NO toca:
--   - `menu_item.external_id` (d21e1cfa-...): el adaptador casa el deal por
--     `ref` contra esa misma matricula. Cambiarlo romperia el casado.
--   - ventas pasadas: G160 y anteriores se quedan como estan (regla 18/09).
--   - `is_available`: hoy esta en false en las dos fichas. Eso es un 86
--     operativo, lo decide Julio, no esta migracion.
--   - las `modifier_option` viejas: NO se borran (hay `sale_line` colgando de
--     ellas, p.ej. la de "Montmartre." del G160). Se desasignan y se apagan.
--
-- El Kebab Combo Duo NO entra aqui: no tiene ni un grupo de extras en la base y
-- su composicion exacta la tiene que decir Julio.
-- ============================================================================
-- ⚠️  APLICADA el 22/09/2026 a las 21:05 (Madrid), con la cena en marcha.
--     Se aplico TODO menos el borrado de asignaciones de grupos y el apagado
--     de los grupos vacios: eso vive ahora en
--     20260922T2300_limpieza_grupos_de_los_combos.sql y va con la publicacion.
--     Comprobado sobre lo vivo: 5 huecos, 18 opciones, 0 sin articulo,
--     precios 12,50 / 20,50 y matriculas intactas.
-- ----------------------------------------------------------------------------

begin;

-- ── Guarda 1: la cuenta y la marca son las que creo que son ──────────────────
do $$
begin
  if not exists (
    select 1 from public.menu_item
    where id = '39c33485-b04a-4f08-8db2-97dafb2e0565'
      and account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
      and brand_id   = '5a230c99-1de4-47ca-82fb-65d4af589176'
      and external_id = 'd21e1cfa-33ba-4a7e-8d51-8ef947113688'
      and price = 12.50
      and archived_at is null
  ) then
    raise exception 'ABORTA: la ficha Kebab Combo Individual no esta como se midio el 22/09 (cuenta, marca, external_id o precio han cambiado).';
  end if;
end $$;

-- ── Guarda 2: las 7 fichas-opcion existen, estan vivas, son de la marca y
--    tienen articulo. Sin articulo no descuentan, que es el objeto del encargo.
--    Ademas tienen que estar ACTIVAS: el publicador solo construye refs sobre
--    `is_active <> false`, y una opcion sin ref se cae del deal con un aviso.
do $$
declare v_n integer;
begin
  select count(*) into v_n
  from public.menu_item mi
  where mi.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
    and mi.brand_id   = '5a230c99-1de4-47ca-82fb-65d4af589176'
    and mi.archived_at is null
    and mi.is_active
    and mi.recipe_item_id is not null
    and mi.id in (
      '3288f6c4-15c9-48f5-8495-9e04e32522d1',  -- Kebab de Pollo Gyros
      '03881add-c386-4468-9e2c-6579661c5254',  -- Kebab de Ternera Gyros
      'da2425da-62bc-414a-8b57-2a390594b62a',  -- Kebab Mixto: Pollo y Ternera
      'de9c174c-b500-4199-82be-5fde64190013',  -- Kebab de Falafel
      '59615289-a92c-434e-96c6-cf4f0fa61516',  -- Patatas Harisa (DSH-00389)
      '960bc26c-a6fd-4596-9d56-3cce5cfacfdd',  -- Falafel con salsa de yogur (3 uds)
      '560a02e6-17e0-4b87-a229-3c96de2cd800'   -- Rollitos de Queso Feta (3 uds)
    );
  if v_n <> 7 then
    raise exception 'ABORTA: esperaba 7 fichas-opcion activas, con articulo y de la marca; encontre %.', v_n;
  end if;
end $$;

-- ── Guarda 3: no hay ya huecos montados (esta migracion no es re-ejecutable
--    a medias: o no hay nada, o ya esta hecha y no hay que volver a pasarla).
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.combo_slot
  where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
    and combo_item_id = '39c33485-b04a-4f08-8db2-97dafb2e0565';
  if v_n <> 0 then
    raise exception 'ABORTA: el combo ya tiene % hueco(s). Revisar a mano antes de repetir.', v_n;
  end if;
end $$;

-- ── 1) La ficha pasa a combo ────────────────────────────────────────────────
update public.menu_item
   set product_type = 'combo',
       updated_at   = now()
 where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
   and id         = '39c33485-b04a-4f08-8db2-97dafb2e0565';

-- ── 2) Hueco 1: el kebab (1 de 1) ───────────────────────────────────────────
-- Los recargos reproducen EXACTAMENTE los que cobra hoy el grupo de carne:
-- Pollo 0, Ternera +0,80, Mixto +0,50, Falafel +0,90. El cliente paga lo mismo.
insert into public.combo_slot
  (account_id, combo_item_id, name, min_selections, max_selections, position, is_active)
values
  ('51ad1792-6629-4ef7-833a-b57b09a86710', '39c33485-b04a-4f08-8db2-97dafb2e0565',
   'Elige tu Kebab', 1, 1, 0, true);

insert into public.combo_slot_option
  (account_id, combo_slot_id, menu_item_id, price_impact, is_default, position, is_active)
select '51ad1792-6629-4ef7-833a-b57b09a86710', cs.id, v.menu_item_id, v.price_impact, v.is_default, v.pos, true
from public.combo_slot cs
cross join (values
  ('3288f6c4-15c9-48f5-8495-9e04e32522d1'::uuid, 0.00::numeric, true , 0),
  ('03881add-c386-4468-9e2c-6579661c5254'      , 0.80         , false, 1),
  ('da2425da-62bc-414a-8b57-2a390594b62a'      , 0.50         , false, 2),
  ('de9c174c-b500-4199-82be-5fde64190013'      , 0.90         , false, 3)
) as v(menu_item_id, price_impact, is_default, pos)
where cs.account_id    = '51ad1792-6629-4ef7-833a-b57b09a86710'
  and cs.combo_item_id = '39c33485-b04a-4f08-8db2-97dafb2e0565'
  and cs.name          = 'Elige tu Kebab';

-- ── 3) Hueco 2: el entrante (1 de 1) ────────────────────────────────────────
-- Mismo nombre de hueco que ve hoy el cliente, y mismos recargos:
-- Patatas Harisa 0, Falafel +0,90, Rollitos +1,00.
-- "Hummus con pan de pita" NO entra: su opcion ya estaba apagada y su ficha no
-- tiene articulo (`recipe_item_id` null), asi que no descontaria nada.
insert into public.combo_slot
  (account_id, combo_item_id, name, min_selections, max_selections, position, is_active)
values
  ('51ad1792-6629-4ef7-833a-b57b09a86710', '39c33485-b04a-4f08-8db2-97dafb2e0565',
   'Escoge tu entrante favorito', 1, 1, 1, true);

insert into public.combo_slot_option
  (account_id, combo_slot_id, menu_item_id, price_impact, is_default, position, is_active)
select '51ad1792-6629-4ef7-833a-b57b09a86710', cs.id, v.menu_item_id, v.price_impact, v.is_default, v.pos, true
from public.combo_slot cs
cross join (values
  ('59615289-a92c-434e-96c6-cf4f0fa61516'::uuid, 0.00::numeric, true , 0),
  ('960bc26c-a6fd-4596-9d56-3cce5cfacfdd'      , 0.90         , false, 1),
  ('560a02e6-17e0-4b87-a229-3c96de2cd800'      , 1.00         , false, 2)
) as v(menu_item_id, price_impact, is_default, pos)
where cs.account_id    = '51ad1792-6629-4ef7-833a-b57b09a86710'
  and cs.combo_item_id = '39c33485-b04a-4f08-8db2-97dafb2e0565'
  and cs.name          = 'Escoge tu entrante favorito';

-- ── 4) Los cuatro grupos de extras dejan de colgar del combo ────────────────
-- Un combo no publica `option_list_refs` (el publicador solo se las pone a los
-- productos), asi que estos grupos ya no pintarian nada en HubRise; se quitan
-- para que la pantalla de Folvy tampoco los ensene. Los cuatro son exclusivos
-- de esta ficha (medido: 1 asignacion cada uno, 22/09), no se lleva nada por
-- delante de otra ficha.
delete from public.modifier_group_assignment
 where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
   and menu_item_id = '39c33485-b04a-4f08-8db2-97dafb2e0565'
   and modifier_group_id in (
     'eebb564c-1735-4547-ba46-2aa81d0a67a0',  -- 1. Escoge tu primer kebab (0 opciones vivas)
     '8819014c-5ed1-4f50-80bf-25208134523e',  -- 1. Elige el tipo de carne de tu primer Kebab
     'e1692b3d-eb83-4904-b823-dd1c9cd5daaf',  -- 1. Escoge la salsa para tu primer kebab
     '02668c11-1a41-4cf9-a05c-50e19ecf0f07'   -- Escoge tu entrante favorito
   );

-- ── 5) El grupo vacio se apaga (es el de "Montmartre.") ─────────────────────
-- No se borra: el G160 del 21/09 tiene una `sale_line` colgada de su opcion.
update public.modifier_group
   set is_active  = false,
       updated_at = now()
 where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
   and id         = 'eebb564c-1735-4547-ba46-2aa81d0a67a0';

-- ── COMPROBACION (pegar el resultado en el parte, regla 5) ──────────────────
-- 5.1 La ficha es combo y no ha cambiado de matricula ni de precio
select 'ficha' as que, product_type, price, external_id, is_active, is_available
  from public.menu_item
 where account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
   and id='39c33485-b04a-4f08-8db2-97dafb2e0565';

-- 5.2 Los dos huecos con sus opciones, su articulo y su recargo
select cs.position as hueco, cs.name as hueco_nombre, cs.min_selections, cs.max_selections,
       cso.position as opt, mi.name as opcion, ri.folvy_code as articulo, cso.price_impact
  from public.combo_slot cs
  join public.combo_slot_option cso on cso.combo_slot_id=cs.id and cso.account_id=cs.account_id
  join public.menu_item mi on mi.id=cso.menu_item_id and mi.account_id=cs.account_id
  left join public.recipe_item ri on ri.id=mi.recipe_item_id and ri.account_id=cs.account_id
 where cs.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
   and cs.combo_item_id='39c33485-b04a-4f08-8db2-97dafb2e0565'
 order by cs.position, cso.position;
-- Esperado: 7 filas, TODAS con `articulo` no nulo. Una fila sin articulo es un
-- componente que no descuenta: eso es el fallo que venimos a arreglar.

-- 5.3 Ya no cuelgan extras del combo
select count(*) as grupos_colgando
  from public.modifier_group_assignment
 where account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
   and menu_item_id='39c33485-b04a-4f08-8db2-97dafb2e0565';
-- Esperado: 0

-- ── Julio: pasar primero con ROLLBACK, leer las tres comprobaciones, y solo
--    entonces repetir con COMMIT. ────────────────────────────────────────────
rollback;
-- commit;
