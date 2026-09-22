-- ============================================================================
-- Lo que se dejó FUERA de la pasada de las 21:05, y por qué
-- ----------------------------------------------------------------------------
-- 22/09/2026. PROPUESTA. NO APLICADA. Va CON la publicación de la carta, que
-- es fuera de servicio de todas formas.
--
-- Las dos migraciones de los combos (20260922T0030 y T2100) se aplicaron el
-- 22/09 a las 21:05, con la cena EN MARCHA (17 pedidos en 30 min). Se pudo
-- porque lo aplicado es INERTE para el camino del pedido, y eso se midió:
--   · `adapt_hubrise_order`, `_sale_line_raw_consumption` y
--     `compute_sale_line_cost` NO leen `menu_item.product_type` ni `combo_slot`.
--   · 0 crons y 0 disparadores sobre `combo_slot` / `combo_slot_option`.
--   · El disparador de precio de `menu_item` es AFTER UPDATE **OF price** con
--     WHEN (old.price IS DISTINCT FROM new.price): no se tocó el precio, no se
--     disparó.
--   · Bloqueos de fila, cero DDL.
--
-- LO QUE SÍ SE QUEDÓ FUERA, y es esto: el borrado de las cuatro asignaciones
-- de grupos del Individual y el apagado de los dos grupos vacíos.
-- `modifier_group_assignment` SÍ la lee `resolver_opcion_de_extra` en su paso 1,
-- en cada pedido vivo. Su paso 2 casa por `ref` en toda la cuenta y rescataría
-- el enlace —está leído, no supuesto—, pero con la cena a pleno no hacía falta
-- meter esa tabla: hasta que se publique la carta, esos grupos no pintan nada.
-- La duda va a favor de esperar cuando esperar no cuesta.
-- ============================================================================

begin;

-- ── Guarda: las dos fichas ya son combo y tienen sus huecos ────────────────
do $$
declare v_n integer;
begin
  if (select count(*) from public.menu_item
       where account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
         and id in ('39c33485-b04a-4f08-8db2-97dafb2e0565','a53c577d-0b8e-4a5c-8d78-bae73c2b8a70')
         and product_type='combo') <> 2
  then raise exception 'ABORTA: las dos fichas no son combo. Esta limpieza va DESPUES de la conversion.'; end if;

  select count(*) into v_n from public.combo_slot_option cso
   join public.combo_slot cs on cs.id=cso.combo_slot_id and cs.account_id=cso.account_id
   where cs.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
     and cs.combo_item_id in ('39c33485-b04a-4f08-8db2-97dafb2e0565','a53c577d-0b8e-4a5c-8d78-bae73c2b8a70');
  if v_n <> 18 then raise exception 'ABORTA: esperaba 18 opciones montadas; hay %.', v_n; end if;
end $$;

-- ── 1) Los cuatro grupos dejan de colgar del Individual ────────────────────
-- Un combo no publica `option_list_refs` (el publicador solo se las pone a los
-- productos), asi que ya no pintan en HubRise; se quitan para que la pantalla
-- de Folvy tampoco los enseñe. Los cuatro son exclusivos de esta ficha.
-- NO se borra ninguna `modifier_option`: el G160 del 21/09 tiene lineas
-- colgando de ellas.
delete from public.modifier_group_assignment
 where account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
   and menu_item_id='39c33485-b04a-4f08-8db2-97dafb2e0565'
   and modifier_group_id in (
     'eebb564c-1735-4547-ba46-2aa81d0a67a0',  -- 1. Escoge tu primer kebab (0 vivas)
     '8819014c-5ed1-4f50-80bf-25208134523e',  -- 1. Elige el tipo de carne de tu primer Kebab
     'e1692b3d-eb83-4904-b823-dd1c9cd5daaf',  -- 1. Escoge la salsa para tu primer kebab
     '02668c11-1a41-4cf9-a05c-50e19ecf0f07'   -- Escoge tu entrante favorito
   );

-- ── 2) Los dos grupos de «escoge tu kebab» se apagan ───────────────────────
-- Cero opciones vivas los dos. No se borran: sus opciones tienen historia.
update public.modifier_group
   set is_active=false, updated_at=now()
 where account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
   and id in ('eebb564c-1735-4547-ba46-2aa81d0a67a0',   -- el del primer kebab
              'a58d72e7-fc0c-4b7a-9b99-0cbd23cb8697');  -- el del segundo

-- ── COMPROBACION ───────────────────────────────────────────────────────────
select 'grupos colgando del Individual (esperado 0)' as que,
       (select count(*)::text from public.modifier_group_assignment
         where account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
           and menu_item_id='39c33485-b04a-4f08-8db2-97dafb2e0565') as dato
union all
select 'grupos «escoge tu kebab» activos (esperado 0)',
       (select count(*)::text from public.modifier_group
         where account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
           and id in ('eebb564c-1735-4547-ba46-2aa81d0a67a0','a58d72e7-fc0c-4b7a-9b99-0cbd23cb8697')
           and is_active);

rollback;
-- commit;
