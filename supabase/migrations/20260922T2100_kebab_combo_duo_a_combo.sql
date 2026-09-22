-- ============================================================================
-- Kebab Combo Duo (The Urban Kebab) : producto sin nada -> COMBO
-- ----------------------------------------------------------------------------
-- 22/09/2026. Cuenta Foodint 51ad1792-6629-4ef7-833a-b57b09a86710.
-- Hermana de 20260922T0030 (el Individual). PROPUESTA. NO APLICADA.
--
-- EL ENCARGO DECIA «preguntar a Julio la composicion exacta; no deducirla». No
-- la he deducido: la he ENCONTRADO. Estaba en la base, huerfana.
--
-- Lo medido el 22/09:
--   · Existen TRES grupos de modificadores para el SEGUNDO kebab, activos y sin
--     asignar a nada:
--       a58d72e7  «2. Escoge tu segundo kebab»            1 de 1 · 6 opc · 0 vivas
--       a6a59e57  «2. Elige el tipo de carne de tu 2º Kebab» 1 de 1 · 4 opc · 4 vivas
--       e4942692  «2. Escoge la salsa para tu segundo kebab» 1..3  · 3 opc · 2 vivas
--   · Los seis grupos (los tres del 1º y los tres del 2º) tienen UN SOLO sello
--     de creacion: 12/06/2026 11:21:35.364111. Misma importacion de Last.
--   · Son los UNICOS tres grupos huerfanos de toda la marca. No hay nada mas
--     suelto que pudiera pertenecer a otro producto.
--   · El Individual se quedo los tres del «primer» kebab. El unico producto de
--     la carta que puede usar los del «segundo» es el Duo.
--   · El Duo no tiene ni una linea de venta en su historia, asi que no hay
--     ningun pedido que pueda contradecir esto.
--
-- Los recargos del segundo kebab son IDENTICOS a los del primero (0 / +0,80 /
-- +0,50 / +0,90), asi que el cliente paga lo mismo por cada mitad.
--
-- 🔴 LO QUE SIGUE SIN SABERSE, Y POR ESO ESTE FICHERO NO ESTA ENTERO:
--    EL ENTRANTE. El grupo «Escoge tu entrante favorito» (02668c11) esta
--    asignado SOLO al Individual — pero el Duo no tiene NINGUNA asignacion de
--    nada, asi que esa ausencia no prueba nada. Puede llevar uno, dos o ninguno.
--    El hueco esta escrito abajo y COMENTADO. Lo descomenta Julio cuando diga
--    cual de las tres.
--    (La aritmetica APUNTA a uno, y va dicho que es aritmetica y no la carta:
--     Individual 12,50 = 1 kebab + 1 entrante. Duo 20,50. La diferencia son
--     8,00 €, que es un segundo kebab y poco mas. Dos entrantes no caben en 8.)
-- ============================================================================

begin;

-- ── Guarda 1: la ficha del Duo es la que creo que es ────────────────────────
do $$
begin
  if not exists (
    select 1 from public.menu_item
    where id = 'a53c577d-0b8e-4a5c-8d78-bae73c2b8a70'
      and account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
      and brand_id   = '5a230c99-1de4-47ca-82fb-65d4af589176'
      and external_id = 'edbc123c-d083-4811-9814-2feb89dd06bd'
      and price = 20.50
      and archived_at is null
  ) then
    raise exception 'ABORTA: la ficha Kebab Combo Duo no esta como se midio el 22/09.';
  end if;
end $$;

-- ── Guarda 2: los tres grupos del segundo kebab SIGUEN huerfanos ────────────
-- Si alguien se los ha asignado a algo entre medias, esta migracion parte de
-- una premisa falsa y no debe correr.
do $$
declare v_n integer;
begin
  select count(*) into v_n
  from public.modifier_group_assignment a
  where a.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
    and a.modifier_group_id in ('a58d72e7-fc0c-4b7a-9b99-0cbd23cb8697',
                                'a6a59e57-ccb3-490a-b9d5-a5949304420a',
                                'e4942692-7b57-4eae-990e-7f032a6fb721');
  if v_n <> 0 then
    raise exception 'ABORTA: los grupos del segundo kebab ya tienen % asignacion(es). La premisa ha cambiado.', v_n;
  end if;
end $$;

-- ── Guarda 3: las cuatro fichas de kebab siguen vivas y con articulo ────────
do $$
declare v_n integer;
begin
  select count(*) into v_n
  from public.menu_item mi
  where mi.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
    and mi.brand_id   = '5a230c99-1de4-47ca-82fb-65d4af589176'
    and mi.archived_at is null and mi.is_active and mi.recipe_item_id is not null
    and mi.id in ('3288f6c4-15c9-48f5-8495-9e04e32522d1',
                  '03881add-c386-4468-9e2c-6579661c5254',
                  'da2425da-62bc-414a-8b57-2a390594b62a',
                  'de9c174c-b500-4199-82be-5fde64190013');
  if v_n <> 4 then
    raise exception 'ABORTA: esperaba 4 fichas de kebab activas con articulo; encontre %.', v_n;
  end if;
end $$;

-- ── Guarda 4: el Duo no tiene ya huecos montados ────────────────────────────
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.combo_slot
  where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
    and combo_item_id = 'a53c577d-0b8e-4a5c-8d78-bae73c2b8a70';
  if v_n <> 0 then
    raise exception 'ABORTA: el Duo ya tiene % hueco(s).', v_n;
  end if;
end $$;

-- ── 1) La ficha pasa a combo ────────────────────────────────────────────────
update public.menu_item
   set product_type = 'combo', updated_at = now()
 where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
   and id         = 'a53c577d-0b8e-4a5c-8d78-bae73c2b8a70';

-- ── 2) Los dos huecos de kebab, con los recargos que ya cobraba Last ────────
insert into public.combo_slot
  (account_id, combo_item_id, name, min_selections, max_selections, position, is_active)
values
  ('51ad1792-6629-4ef7-833a-b57b09a86710','a53c577d-0b8e-4a5c-8d78-bae73c2b8a70','Elige tu primer Kebab',  1,1,0,true),
  ('51ad1792-6629-4ef7-833a-b57b09a86710','a53c577d-0b8e-4a5c-8d78-bae73c2b8a70','Elige tu segundo Kebab', 1,1,1,true);

insert into public.combo_slot_option
  (account_id, combo_slot_id, menu_item_id, price_impact, is_default, position, is_active)
select '51ad1792-6629-4ef7-833a-b57b09a86710', cs.id, v.menu_item_id, v.price_impact, v.is_default, v.pos, true
from public.combo_slot cs
cross join (values
  ('3288f6c4-15c9-48f5-8495-9e04e32522d1'::uuid, 0.00::numeric, true , 0),  -- Pollo Gyros
  ('03881add-c386-4468-9e2c-6579661c5254'      , 0.80         , false, 1),  -- Ternera Gyros
  ('da2425da-62bc-414a-8b57-2a390594b62a'      , 0.50         , false, 2),  -- Mixto
  ('de9c174c-b500-4199-82be-5fde64190013'      , 0.90         , false, 3)   -- Falafel
) as v(menu_item_id, price_impact, is_default, pos)
where cs.account_id    = '51ad1792-6629-4ef7-833a-b57b09a86710'
  and cs.combo_item_id = 'a53c577d-0b8e-4a5c-8d78-bae73c2b8a70'
  and cs.name in ('Elige tu primer Kebab','Elige tu segundo Kebab');

-- ── 3) 🔴 EL ENTRANTE — DESCOMENTAR SOLO CUANDO JULIO LO DIGA ───────────────
-- Si el Duo lleva UN entrante, quitar los comentarios de este bloque entero.
-- Si lleva DOS, duplicarlo cambiando el nombre y la posicion (2 y 3).
-- Si no lleva ninguno, borrar el bloque y ya esta.
--
-- insert into public.combo_slot
--   (account_id, combo_item_id, name, min_selections, max_selections, position, is_active)
-- values
--   ('51ad1792-6629-4ef7-833a-b57b09a86710','a53c577d-0b8e-4a5c-8d78-bae73c2b8a70',
--    'Escoge tu entrante favorito', 1, 1, 2, true);
--
-- insert into public.combo_slot_option
--   (account_id, combo_slot_id, menu_item_id, price_impact, is_default, position, is_active)
-- select '51ad1792-6629-4ef7-833a-b57b09a86710', cs.id, v.menu_item_id, v.price_impact, v.is_default, v.pos, true
-- from public.combo_slot cs
-- cross join (values
--   ('59615289-a92c-434e-96c6-cf4f0fa61516'::uuid, 0.00::numeric, true , 0),  -- Patatas Harisa DSH-00389
--   ('960bc26c-a6fd-4596-9d56-3cce5cfacfdd'      , 0.90         , false, 1),  -- Falafel c/ yogur DSH-00368
--   ('560a02e6-17e0-4b87-a229-3c96de2cd800'      , 1.00         , false, 2)   -- Rollitos Feta DSH-00015
-- ) as v(menu_item_id, price_impact, is_default, pos)
-- where cs.account_id    = '51ad1792-6629-4ef7-833a-b57b09a86710'
--   and cs.combo_item_id = 'a53c577d-0b8e-4a5c-8d78-bae73c2b8a70'
--   and cs.name          = 'Escoge tu entrante favorito';

-- ── 4) El grupo vacio del segundo kebab se apaga ────────────────────────────
-- Cero opciones vivas, igual que su gemelo del primero. No se borra: sus
-- opciones podrian tener historia colgando.
update public.modifier_group
   set is_active = false, updated_at = now()
 where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
   and id         = 'a58d72e7-fc0c-4b7a-9b99-0cbd23cb8697';

-- ── COMPROBACION (pegar el resultado en el parte, regla 5) ──────────────────
select cs.position as hueco, cs.name as hueco_nombre, cs.min_selections, cs.max_selections,
       cso.position as opt, mi.name as opcion, ri.folvy_code as articulo, cso.price_impact
  from public.combo_slot cs
  join public.combo_slot_option cso on cso.combo_slot_id=cs.id and cso.account_id=cs.account_id
  join public.menu_item mi on mi.id=cso.menu_item_id and mi.account_id=cs.account_id
  left join public.recipe_item ri on ri.id=mi.recipe_item_id and ri.account_id=cs.account_id
 where cs.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
   and cs.combo_item_id='a53c577d-0b8e-4a5c-8d78-bae73c2b8a70'
 order by cs.position, cso.position;
-- Esperado SIN entrante: 8 filas (4 + 4), TODAS con articulo.
-- Esperado CON un entrante: 11 filas.
-- Una fila sin articulo es un componente que no descuenta.

select 'ficha' as que, product_type, price, external_id, is_active, is_available
  from public.menu_item
 where account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
   and id='a53c577d-0b8e-4a5c-8d78-bae73c2b8a70';

rollback;
-- commit;
