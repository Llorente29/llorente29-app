-- ============================================================================
-- La salsa del kebab: que el escandallo diga lo que la carta ya ofrece
-- ----------------------------------------------------------------------------
-- 22/09/2026. Cuenta Foodint 51ad1792-6629-4ef7-833a-b57b09a86710.
-- PROPUESTA. NO APLICADA. 🔴 Y LE FALTA UN NUMERO (ver §0).
--
-- DE DONDE SALE. Julio, 22/09: «La salsa se elige para cada kebab del duo, y
-- SUSTITUYE; la idea creo que es mejor que la pregunta sea sin salsa harisa o
-- sin salsa yogur o sin ninguna».
--
-- Ese modelo —el kebab VIENE con las dos salsas y el cliente quita la que no
-- quiera— es el que ya tiene montado la carta: el grupo «Quieres quitar aguna
-- salsa de tu kebab?» cuelga de las CUATRO fichas de kebab, con sus dos
-- opciones y sus dos impactos confirmados. No hay que crear nada.
--
-- El problema es que el ESCANDALLO no lo sostiene. Medido el 22/09:
--
--   | la carta ofrece                        | la receta pone        | pedido |
--   |----------------------------------------|-----------------------|--------|
--   | «Sin Salsa Harisa» resta 50 de REC-00003 | NADA. Cero harissa.  | 15 veces |
--   | «Sin Salsa Yogur»  resta 50 de RAW-00127 | 30 g                 |  9 veces |
--
--   · «Sin Salsa Harisa»: 15 pedidos desde el 17/06 -> 750 g restados de una
--     salsa que nunca entro en el plato. Stock negativo puro.
--   · «Sin Salsa Yogur»: 9 pedidos -> 20 g de mas cada vez, 180 g.
--   · REC-00003 rinde 820 g por tanda, asi que las cantidades son GRAMOS.
--
-- LA INVARIANTE, que no es una opinion: lo que quita un «Sin X» tiene que ser
-- EXACTAMENTE lo que pone la receta. Si no, cada vez que alguien lo pide el
-- almacen se descuadra en la diferencia. Hoy no cuadra ninguna de las dos.
--
-- ── §0 · 🔴 EL NUMERO QUE FALTA ────────────────────────────────────────────
-- El yogur se arregla solo: la receta dice 30 y es el valor que alguien puso a
-- proposito, asi que manda la receta y el «Sin Salsa Yogur» baja de 50 a 30.
--
-- La harissa NO se puede deducir: no hay valor en la receta del que tirar. El
-- unico numero que existe es el 50 del «Sin», que es lo que alguien creyo que
-- llevaba. Hace falta que Julio diga CUANTOS GRAMOS de Salsa Mayo Harissa
-- lleva un kebab.
--
--     Se escribe UNA VEZ, aqui abajo, y el resto del fichero lo usa.
--
--   \set g_harissa 50        -- <<< 🔴 GRAMOS DE HARISSA POR KEBAB. CONFIRMAR.
--
-- Mientras no este confirmado, este fichero NO se pasa: poner un numero
-- inventado en un escandallo es exactamente lo que venimos a arreglar.
-- ============================================================================

begin;

-- ── Guarda 1: las cuatro fichas de kebab siguen igual ───────────────────────
do $$
declare v_n integer;
begin
  select count(*) into v_n
  from public.recipe_item ri
  where ri.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
    and ri.folvy_code in ('DSH-00008','DSH-00009','DSH-00010','DSH-00011')
    and ri.is_active and ri.archived_at is null;
  if v_n <> 4 then
    raise exception 'ABORTA: esperaba los 4 kebabs vivos; encontre %.', v_n;
  end if;
end $$;

-- ── Guarda 2: siguen SIN harissa y CON 30 g de yogur ────────────────────────
-- Si alguien ya lo ha tocado, la premisa ha cambiado y esto no debe correr.
do $$
declare v_h integer; v_y integer;
begin
  select count(*) into v_h
  from public.recipe_line rl
  join public.recipe_item p on p.id=rl.parent_item_id and p.account_id=rl.account_id
  join public.recipe_item c on c.id=rl.child_item_id and c.account_id=rl.account_id
  where rl.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
    and p.folvy_code in ('DSH-00008','DSH-00009','DSH-00010','DSH-00011')
    and c.folvy_code='REC-00003';
  if v_h <> 0 then
    raise exception 'ABORTA: ya hay % linea(s) de harissa en los kebabs. Revisar a mano.', v_h;
  end if;

  select count(*) into v_y
  from public.recipe_line rl
  join public.recipe_item p on p.id=rl.parent_item_id and p.account_id=rl.account_id
  join public.recipe_item c on c.id=rl.child_item_id and c.account_id=rl.account_id
  where rl.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
    and p.folvy_code in ('DSH-00008','DSH-00009','DSH-00010','DSH-00011')
    and c.folvy_code='RAW-00127'
    and coalesce(rl.quantity_gross, rl.quantity_net) = 30;
  if v_y <> 4 then
    raise exception 'ABORTA: esperaba 4 kebabs con 30 g de yogur; encontre %.', v_y;
  end if;
end $$;

-- ── 1) La harissa entra en el escandallo de los cuatro kebabs ───────────────
-- Va DETRAS del yogur, en la posicion siguiente, para que la ficha se lea en el
-- mismo orden en que se monta el kebab.
insert into public.recipe_line
  (account_id, parent_item_id, child_item_id, quantity_net, quantity_gross, position, comment)
select '51ad1792-6629-4ef7-833a-b57b09a86710', p.id, h.id,
       :g_harissa, :g_harissa,
       (select max(rl2.position)+1 from public.recipe_line rl2
         where rl2.parent_item_id=p.id and rl2.account_id=p.account_id),
       'Salsa de serie. El cliente la quita con «Sin Salsa Harisa» (22/09/2026).'
from public.recipe_item p
cross join (select id from public.recipe_item
             where account_id='51ad1792-6629-4ef7-833a-b57b09a86710' and folvy_code='REC-00003') h
where p.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
  and p.folvy_code in ('DSH-00008','DSH-00009','DSH-00010','DSH-00011');

-- ── 2) Los «Sin X» pasan a quitar EXACTAMENTE lo que pone la receta ─────────
-- Yogur: 50 -> 30, que es lo que dice la receta.
update public.modifier_recipe_impact mri
   set quantity = 30, updated_at = now()
  from public.modifier_option mo, public.modifier_group mg, public.recipe_item ri
 where mri.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
   and mo.id = mri.modifier_option_id and mo.account_id = mri.account_id
   and mg.id = mo.modifier_group_id   and mg.account_id = mri.account_id
   and ri.id = mri.target_recipe_item_id and ri.account_id = mri.account_id
   and mg.name ilike '%quitar%' and mo.name = 'Sin Salsa Yogur'
   and ri.folvy_code = 'RAW-00127'
   and mri.impact_type = 'remove_item';

-- Harissa: al numero confirmado.
update public.modifier_recipe_impact mri
   set quantity = :g_harissa, updated_at = now()
  from public.modifier_option mo, public.modifier_group mg, public.recipe_item ri
 where mri.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
   and mo.id = mri.modifier_option_id and mo.account_id = mri.account_id
   and mg.id = mo.modifier_group_id   and mg.account_id = mri.account_id
   and ri.id = mri.target_recipe_item_id and ri.account_id = mri.account_id
   and mg.name ilike '%quitar%' and mo.name = 'Sin Salsa Harisa'
   and ri.folvy_code = 'REC-00003'
   and mri.impact_type = 'remove_item';

-- ── 3) El extra de salsa del combo, que ponia MEDIO GRAMO ───────────────────
-- «Salsa Harissa (Picante)» de los grupos de salsa del combo tiene impacto 0,5
-- de REC-00003, cuando sus hermanas usan 50-60. Es un extra de PAGO (+1,50 en
-- la pita), asi que lo que anade debe ser una racion, no medio gramo.
-- Deja de usarse en cuanto los dos combos sean combo de verdad (esos grupos se
-- desasignan), pero el extra de la pita SIGUE vivo.
update public.modifier_recipe_impact mri
   set quantity = :g_harissa, updated_at = now()
  from public.modifier_option mo, public.recipe_item ri
 where mri.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
   and mo.id = mri.modifier_option_id and mo.account_id = mri.account_id
   and ri.id = mri.target_recipe_item_id and ri.account_id = mri.account_id
   and mo.name = 'Salsa Harissa (Picante)'
   and ri.folvy_code = 'REC-00003'
   and mri.impact_type = 'add_item'
   and mri.quantity = 0.5;

-- ── COMPROBACION ────────────────────────────────────────────────────────────
-- C1. La invariante: lo que pone la receta = lo que quita el «Sin».
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
-- Esperado: 8 filas, y en TODAS `pone_la_receta` = `quita_el_sin`.
-- Si una sola difiere, cada vez que se pida ese «Sin» el almacen se descuadra.

-- C2. Lo que cambia el coste del kebab (regla 31: el mismo numero a los dos lados)
select p.folvy_code, p.name,
       round((select coalesce(sum(e.qty_base*coalesce(r2.computed_cost,r2.fixed_cost,0)),0)
                from public.explode_recipe_to_raws(p.id,1) e
                join public.recipe_item r2 on r2.id=e.raw_item_id and r2.account_id=p.account_id)::numeric,4) as coste_ahora
  from public.recipe_item p
 where p.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
   and p.folvy_code in ('DSH-00008','DSH-00009','DSH-00010','DSH-00011')
 order by p.folvy_code;
-- ANTES (medido el 22/09, sin la harissa):
--   DSH-00008 2,1298 · DSH-00009 2,1680 · DSH-00010 2,0882 · DSH-00011 1,3770
-- La diferencia tiene que ser g_harissa x 0,00468 EUR/g en los cuatro, y la
-- MISMA en los cuatro. Con 50 g serian +0,234 EUR por kebab.

-- ── 🔴 ENSAYO POR CAMINOS (regla 10) — PENDIENTE ───────────────────────────
-- Esto SI es un cambio de coste y de stock, asi que antes del commit hay que
-- pasar los cuatro caminos dentro de esta misma transaccion: cerrar una venta,
-- recibir un albaran, apuntar una merma y aprobar un recuento. No los he
-- escrito porque el fichero esta bloqueado por el numero de §0 y un ensayo con
-- un gramaje inventado no mide nada. Van antes del commit, no despues.

rollback;
-- commit;
