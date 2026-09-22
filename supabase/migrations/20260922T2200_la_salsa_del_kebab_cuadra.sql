-- ============================================================================
-- La salsa del kebab: que el escandallo diga lo que la carta ya ofrece
-- ----------------------------------------------------------------------------
-- 22/09/2026. Cuenta Foodint 51ad1792-6629-4ef7-833a-b57b09a86710.
-- APLICADA el 23/09/2026 a las 00:39 (Madrid), con la cocina parada: 0 pedidos
-- en 30 minutos, el ultimo a las 23:16. Pasada en seco antes, con rollback.
--   C1 invariante  OK · 8 filas, todas 30 = 30
--   C2 coste       cada kebab sube EXACTAMENTE 0,1403 (la harissa y nada mas):
--                  DSH-00008 2,4052 -> 2,5455 · DSH-00009 2,4434 -> 2,5837
--                  DSH-00010 2,3636 -> 2,5039 · DSH-00011 1,6524 -> 1,7928
--   C3 computed == explosion  OK · las 4 cuadran
-- Verificado sobre lo vivo: 1 linea de harissa en cada uno, computed = explosion.
--
-- 🔴 ESTA **NO** SE PUEDE PASAR EN BANDA, y no es lo mismo que las dos de los
--    combos. Aquellas eran inertes para el camino del pedido; ESTA lo toca de
--    lleno: `recipe_line` la lee `explode_recipe_to_raws` en CADA cierre de
--    venta. Cambiarla con la cena en marcha parte el servicio por la mitad —
--    los pedidos de antes consumen una cosa y los de despues otra, y el corte
--    queda a mitad de turno sin que nadie lo sepa.
--    Se pasa DESPUES de las 23:45, con el servicio parado.
--
-- DE DONDE SALE. Julio, 22/09: «La salsa se elige para cada kebab del duo, y
-- SUSTITUYE; la pregunta mejor es sin salsa harisa o sin salsa yogur o sin
-- ninguna». Y luego: «La harisa son 30 grs igual que el yogur».
--
-- Ese modelo ya lo tiene montado la carta: el grupo «Quieres quitar aguna salsa
-- de tu kebab?» cuelga de las CUATRO fichas de kebab. No hay que crear nada.
-- Lo que falla es que el ESCANDALLO no lo sostiene.
--
-- MEDIDO EL 22/09:
--   | la carta ofrece                          | la receta pone      | pedido   |
--   |------------------------------------------|---------------------|----------|
--   | «Sin Salsa Harisa» resta 50 de REC-00003 | NADA. Cero harissa. | 15 veces |
--   | «Sin Salsa Yogur»  resta 50 de RAW-00127 | 30 g                |  9 veces |
--
--   · 15 pedidos desde el 17/06 -> 750 g de harissa restados de una salsa que
--     nunca entro en el plato.
--   · 9 pedidos -> 180 g de yogur de mas, 20 cada vez.
--
-- LA INVARIANTE, que no es opinion: lo que quita un «Sin X» tiene que ser
-- EXACTAMENTE lo que pone la receta. Hoy no cuadra ninguna de las dos.
--
-- LO QUE **NO** SE TOCA, y se midio antes de decidirlo:
--   · El extra DE PAGO «Algun extra en tu pita?» esta BIEN: Salsa Harissa
--     extra = 50 g (37 pedidos) y Salsa Yogur extra = 40 g (62 pedidos). Son
--     raciones de extra, mas grandes que la de serie a proposito. Intacto.
--   · Las «Patatas Harisa» llevan 60 g de REC-00003. Es su plato. Intacto.
-- ============================================================================

begin;

-- ── Guarda 1: los cuatro kebabs vivos ──────────────────────────────────────
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.recipe_item ri
   where ri.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
     and ri.folvy_code in ('DSH-00008','DSH-00009','DSH-00010','DSH-00011')
     and ri.is_active and ri.archived_at is null;
  if v_n <> 4 then raise exception 'ABORTA: esperaba los 4 kebabs vivos; encontre %.', v_n; end if;
end $$;

-- ── Guarda 2: siguen SIN harissa y CON 30 g de yogur ───────────────────────
do $$
declare v_h integer; v_y integer;
begin
  select count(*) into v_h from public.recipe_line rl
    join public.recipe_item p on p.id=rl.parent_item_id and p.account_id=rl.account_id
    join public.recipe_item c on c.id=rl.child_item_id  and c.account_id=rl.account_id
   where rl.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
     and p.folvy_code in ('DSH-00008','DSH-00009','DSH-00010','DSH-00011')
     and c.folvy_code='REC-00003';
  if v_h <> 0 then raise exception 'ABORTA: ya hay % linea(s) de harissa. Revisar a mano.', v_h; end if;

  select count(*) into v_y from public.recipe_line rl
    join public.recipe_item p on p.id=rl.parent_item_id and p.account_id=rl.account_id
    join public.recipe_item c on c.id=rl.child_item_id  and c.account_id=rl.account_id
   where rl.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
     and p.folvy_code in ('DSH-00008','DSH-00009','DSH-00010','DSH-00011')
     and c.folvy_code='RAW-00127'
     and coalesce(rl.quantity_gross, rl.quantity_net) = 30;
  if v_y <> 4 then raise exception 'ABORTA: esperaba 4 kebabs con 30 g de yogur; encontre %.', v_y; end if;
end $$;

-- ── Guarda 3: el servicio esta parado ──────────────────────────────────────
-- La banda no se opina: se mide. Esta migracion toca `recipe_line`, que lee
-- `explode_recipe_to_raws` en cada cierre de venta.
do $$
declare v_h integer; v_p integer;
begin
  v_h := extract(hour from (now() at time zone 'Europe/Madrid'))::int;
  if v_h >= 12 and v_h < 24 then
    select count(*) into v_p from public.sale
     where account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
       and sold_at >= now() - interval '30 minutes';
    if v_h < 23 or (v_h = 23 and extract(minute from (now() at time zone 'Europe/Madrid'))::int < 45) then
      raise exception 'ABORTA: son las % (Madrid) y hay % pedidos en los ultimos 30 min. Esta migracion toca recipe_line, que se lee en cada cierre de venta. Despues de las 23:45.', to_char(now() at time zone 'Europe/Madrid','HH24:MI'), v_p;
    end if;
  end if;
end $$;

-- ── 1) La harissa entra en el escandallo: 30 g, igual que el yogur ─────────
-- `unit_id` es NOT NULL y la primera version de este fichero no lo ponia: la
-- migracion habria REVENTADO con 23502 en la primera fila. Lo cazo la pasada
-- con rollback del 23/09 00:34.
-- La unidad no se elige a ojo, se lee: gramos es la unidad BASE de REC-00003,
-- es con la que entra el yogur en los cuatro kebabs, y es con la que la
-- harissa ya entra en DSH-00374 (30) y DSH-00389 (60). No hay ambiguedad.
insert into public.recipe_line
  (account_id, parent_item_id, child_item_id, quantity_net, quantity_gross,
   unit_id, position, comment)
select '51ad1792-6629-4ef7-833a-b57b09a86710', p.id, h.id, 30, 30,
       h.base_unit_id,
       (select max(rl2.position)+1 from public.recipe_line rl2
         where rl2.parent_item_id=p.id and rl2.account_id=p.account_id),
       'Salsa de serie, 30 g igual que el yogur (Julio, 22/09/2026). El cliente la quita con «Sin Salsa Harisa».'
from public.recipe_item p
cross join (select id, base_unit_id from public.recipe_item
             where account_id='51ad1792-6629-4ef7-833a-b57b09a86710' and folvy_code='REC-00003') h
where p.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
  and p.folvy_code in ('DSH-00008','DSH-00009','DSH-00010','DSH-00011');

-- ── 2) Los «Sin X» quitan EXACTAMENTE lo que pone la receta: 30 y 30 ───────
update public.modifier_recipe_impact mri
   set quantity = 30, updated_at = now()
  from public.modifier_option mo, public.modifier_group mg, public.recipe_item ri
 where mri.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
   and mo.id = mri.modifier_option_id  and mo.account_id = mri.account_id
   and mg.id = mo.modifier_group_id    and mg.account_id = mri.account_id
   and ri.id = mri.target_recipe_item_id and ri.account_id = mri.account_id
   and mg.name ilike '%quitar%'
   and mri.impact_type = 'remove_item'
   and ( (mo.name = 'Sin Salsa Yogur'  and ri.folvy_code = 'RAW-00127')
      or (mo.name = 'Sin Salsa Harisa' and ri.folvy_code = 'REC-00003') );

-- ── 3) El medio gramo del grupo de salsa del combo ─────────────────────────
-- «Salsa Harissa (Picante)» de los grupos «Escoge la salsa para tu … kebab»
-- tiene impacto 0,5 de REC-00003: medio gramo. Esas opciones quedan DORMIDAS
-- en cuanto los combos publiquen como deal, pero un 0,5 olvidado ahi es una
-- mina para el dia que alguien reasigne el grupo. Se pone en 30, que es la
-- salsa de serie que representa.
update public.modifier_recipe_impact mri
   set quantity = 30, updated_at = now()
  from public.modifier_option mo, public.modifier_group mg, public.recipe_item ri
 where mri.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
   and mo.id = mri.modifier_option_id  and mo.account_id = mri.account_id
   and mg.id = mo.modifier_group_id    and mg.account_id = mri.account_id
   and ri.id = mri.target_recipe_item_id and ri.account_id = mri.account_id
   and mg.name ilike '%escoge la salsa%'
   and mo.name = 'Salsa Harissa (Picante)'
   and ri.folvy_code = 'REC-00003'
   and mri.impact_type = 'add_item'
   and mri.quantity = 0.5;

-- ── 4) EL RECALCULO DEL COSTE, que tampoco estaba ─────────────────────────
-- `recipe_line` NO tiene disparador que recalcule el coste: medido el 23/09,
-- solo lleva anticiclos y `updated_at`. Sin esto, la explosion sube 0,1403 y
-- `computed_cost` se queda como estaba — o sea que la invariante que el
-- envase dejo en pie a las 00:01 (computed == explosion) se rompe en
-- SILENCIO, y el coste de plato se queda corto hasta que alguien recalcule.
-- Se usa la version sin guarda porque `kitchen_recompute_item` exige
-- `belongs_to_account`, que sin JWT es false (medido).
-- Los cuatro y nadie mas: estos kebabs no cuelgan de ningun escandallo
-- (medido: 0 usos como hijo en `recipe_line`), solo son opciones de hueco de
-- combo, y el coste del combo se calcula por venta, no se guarda en una ficha.
do $$
declare v_id uuid;
begin
  for v_id in select id from public.recipe_item
               where account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
                 and folvy_code in ('DSH-00008','DSH-00009','DSH-00010','DSH-00011')
  loop
    perform public._kitchen_recompute_item_unguarded(v_id);
  end loop;
end $$;

-- ── C1 · LA INVARIANTE ─────────────────────────────────────────────────────
select p.folvy_code as kebab, c.folvy_code as salsa, c.name,
       coalesce(rl.quantity_gross, rl.quantity_net) as pone_la_receta,
       (select mri.quantity from public.modifier_recipe_impact mri
          join public.modifier_option mo on mo.id=mri.modifier_option_id and mo.account_id=mri.account_id
          join public.modifier_group mg on mg.id=mo.modifier_group_id and mg.account_id=mri.account_id
          join public.modifier_group_assignment a on a.modifier_group_id=mg.id and a.account_id=mri.account_id
          join public.menu_item mi on mi.id=a.menu_item_id and mi.account_id=mri.account_id
         where mri.account_id=p.account_id and mri.target_recipe_item_id=c.id
           and mri.impact_type='remove_item' and mg.name ilike '%quitar%'
           and mi.recipe_item_id = p.id limit 1) as quita_el_sin
  from public.recipe_item p
  join public.recipe_line rl on rl.parent_item_id=p.id and rl.account_id=p.account_id
  join public.recipe_item c on c.id=rl.child_item_id and c.account_id=p.account_id
 where p.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
   and p.folvy_code in ('DSH-00008','DSH-00009','DSH-00010','DSH-00011')
   and c.folvy_code in ('RAW-00127','REC-00003')
 order by p.folvy_code, c.folvy_code;
-- Esperado: 8 filas y en TODAS `pone_la_receta` = `quita_el_sin` = 30.

-- ── C2 · EL COSTE, el mismo numero a los dos lados (regla 31) ──────────────
select p.folvy_code, p.name,
       round((select coalesce(sum(e.qty_base*coalesce(r2.computed_cost,r2.fixed_cost,0)),0)
                from public.explode_recipe_to_raws(p.id,1) e
                join public.recipe_item r2 on r2.id=e.raw_item_id and r2.account_id=p.account_id)::numeric,4) as coste_despues
  from public.recipe_item p
 where p.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
   and p.folvy_code in ('DSH-00008','DSH-00009','DSH-00010','DSH-00011')
 order by p.folvy_code;
-- 🔴 EL «ANTES» DE ESTE FICHERO ESTABA CADUCADO, y casi mide otra cosa.
-- Se escribio el 22/09 con el envase todavia INVISIBLE:
--   DSH-00008 2,1298 · DSH-00009 2,1680 · DSH-00010 2,0882 · DSH-00011 1,3770
-- El 23/09 a las 00:01 entro `packaging` en explode_recipe_to_raws y esos
-- mismos platos pasaron a:
--   DSH-00008 2,4052 · DSH-00009 2,4434 · DSH-00010 2,3636 · DSH-00011 1,6524
-- Comparar contra los de arriba habria dado una diferencia de 0,27 y la
-- conclusion de que la harissa cuesta el doble de lo que cuesta. La vara se
-- vuelve a tomar la misma noche, antes de escribir (regla 31).
-- ESPERADO: cada uno sube 0,1403 = 30 g de REC-00003 explotada a sus dos raws.
--   DSH-00008 2,5455 · DSH-00009 2,5837 · DSH-00010 2,5039 · DSH-00011 1,7927
-- La subida tiene que ser +0,1403 EUR, IGUAL en los cuatro. Ese numero esta
-- MEDIDO por el camino real (explotar 30 g de REC-00003 a sus 2 materias
-- primas), no calculado como 30 x computed_cost, que da 0,1404: un milesima
-- de diferencia por redondeo, y manda el camino.
--   DSH-00008 2,2701 · DSH-00009 2,3083 · DSH-00010 2,2285 · DSH-00011 1,5173
-- Si uno sube distinto, el escandallo de ese no era el que creiamos.

-- ── C3 · ENSAYO POR LOS CUATRO CAMINOS (regla 10) ──────────────────────────
-- Esto mueve coste Y stock, asi que no basta con que el numero salga bien: hay
-- que ver quien lo ESCRIBE. Los cuatro, dentro de esta misma transaccion:
--
--   · cerrar una venta   -> public.close_sale(p_sale_id)
--   · recibir un albaran -> public.confirm_goods_receipt(p_receipt_id)
--   · apuntar una merma  -> public.register_waste(...)   sobre RAW-00127
--   · aprobar un recuento-> public.apply_inventory_count(p_count_id, …)
--
-- 🔴 LOS CUATRO ESTAN SIN ESCRIBIR, y eso es el hallazgo, no un descuido:
--    cada uno necesita una fila REAL sobre la que operar (una venta abierta de
--    un kebab, un albaran en borrador, un recuento sin aprobar) y esas filas
--    cambian cada dia. Se escriben con la base delante en el momento de
--    pasarla, no ahora y de memoria. Si alguno no se puede ensayar esa noche,
--    eso se dice en el parte y NO se hace el commit.
--
--    Lo que hay que mirar en cada uno: que la transaccion NO aborte, y que el
--    movimiento de RAW-00127 y REC-00003 sea el esperado. La p8 del 10/09 se
--    llevo el servicio entero por medir la media sobre 453 filas y no ejecutar
--    ni una venta.

rollback;
-- commit;
