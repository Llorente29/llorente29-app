-- B73a (06/09/2026) — Nueve impactos que COBRAN y aportan 0 EUR porque les falta
-- la unidad, mas dos altas que no existian. Respaldo previo:
-- `_backup_20260906_modifier_recipe_impact` (36 filas).
--
-- POR QUE 0 EUR: `_impact_cost` devuelve 0 EN SILENCIO cuando `unit_id` es NULL.
-- No es "no inventar": es afirmar que no cuesta nada. Las nueve fichas destino
-- tienen como unidad base la MISMA «Unidad (ud)» global (869711c3..., factor 1,
-- dimension `unit`), asi que la conversion es 1/1 y RESUELVE.
--
-- EL #8 CAMBIA DE TIPO, NO SOLO DE UNIDAD. «Si, con patatas» apunta a un PLATO
-- (`Patatas Clasicas Meraki`), y para eso el patron correcto —el que usan los 16
-- que ya funcionan— es `bundle`, no `add_item`. Dejarlo en `add_item` daria la
-- cifra correcta con el tipo equivocado, que es peor que no arreglarlo.
--
-- LO QUE NO ENTRA, Y ESTA MEDIDO:
--   · `Milanesa House · Base Pollo (The OG)` (f77fb577). Su grupo «Escoge la base
--     de tu bocata» cuelga de DOS familias de plato: en 342 de sus 505 lineas el
--     plato padre YA lleva `Milanesa de Pollo Rebozado` en su escandallo. Ponerle
--     unidad inventaria 315,63 EUR de coste frente a los 143,12 EUR que faltan de
--     verdad. No es un problema de unidad: es a que platos cuelga ese grupo, y eso
--     lo decide Julio.
--   · `Base Ternera (Premium Selection)` (291cd737): duplicado de ficha sin
--     resolver (`Milanesa Ternera Rebozado` vs `Milanesa de Ternera Rebozado`).
--   · Los dos impactos `none` sin unidad: no aportan coste por definicion.
--
-- EL HISTORICO NO SE RECALCULA. `sale_line_cost_sweep` solo toca lineas con
-- `computed_cost IS NULL` («nunca recalcular», escrito en su propio cuerpo), y
-- tocar esta tabla no mueve `recipe_item.updated_at`. Junio, julio y agosto no se
-- mueven. Recalcular sigue disponible en cualquier momento; decide Julio.

-- ── 1 · Los ocho que siguen siendo `add_item`: solo les faltaba la unidad ─────
update modifier_recipe_impact
   set unit_id    = '869711c3-eabd-4e95-92f2-555efaaba6b0',
       quantity   = 1,
       updated_at = now()
 where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
   and unit_id is null
   and impact_type = 'add_item'
   and id in ('5eaf385a-2f5b-4775-8e7a-8802864933c2',  -- Bendito Burrito · Agua.
              'cdce2b58-5db1-431e-a0b9-4848191e489c',  -- Bendito Burrito · Coca Cola. (33cl)
              '7836585e-1d91-4dc1-8168-3862e8d197d7',  -- Bendito Burrito · Coca Cola Zero. (33cl)
              '93189cee-18ae-46bb-b38a-344eb6bb1f26',  -- Bendito Burrito · Fanta Naranja. (33cl)
              '1c43dc42-e1c8-4fc9-b86c-6cdd081dd8cb',  -- Bendito Burrito · Nestea Limon. (33cl)
              '6910746a-4f4b-4eab-9350-860117aaa4b8',  -- Bendito Burrito · Cheesecake de Nutella
              'e4931b85-74fe-4369-aeb8-bcdb9e69b465',  -- Bendito Burrito · Tarta 3 Leches
              '56ef1210-ae98-4660-bc0c-3add254c1036'); -- Lobbers · Quiero dos discos de carne

-- ── 2 · El noveno: cambia de tipo Y de unidad, porque apunta a un PLATO ───────
update modifier_recipe_impact
   set impact_type = 'bundle',
       unit_id     = '869711c3-eabd-4e95-92f2-555efaaba6b0',
       quantity    = 1,
       rationale   = coalesce(rationale || ' · ', '')
                     || 'B73a 06/09: pasa a bundle (una racion del plato) y recibe unidad; antes resolvia a 0 EUR.',
       updated_at  = now()
 where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
   and id = 'b5b81ca0-cf10-4402-b71e-2463eeaaa13e';  -- Lobbers · Si, con patatas

-- ── 3 · Las dos que no existian ──────────────────────────────────────────────
-- Lobbers dejo de vender el 21/07 y su relevo —Lovers Burgers— cobra las mismas
-- patatas SIN ningun impacto. Scandal Burgers, igual. No es un duplicado de
-- importacion: es una opcion por marca, y solo la marca extinta estaba configurada.
insert into modifier_recipe_impact
       (id, account_id, modifier_option_id, impact_type, target_recipe_item_id,
        quantity, unit_id, status, source, rationale, confirmed_by_name, confirmed_at)
select gen_random_uuid(),
       mo.account_id,
       mo.id,
       'bundle',
       (select target_recipe_item_id from modifier_recipe_impact
         where id = 'b5b81ca0-cf10-4402-b71e-2463eeaaa13e'),   -- Patatas Clasicas Meraki
       1,
       '869711c3-eabd-4e95-92f2-555efaaba6b0',
       'confirmed',
       'human',
       'B73a 06/09: alta. La opcion cobra 3,95 EUR y no tenia ningun impacto. Misma configuracion que la de Lobbers.',
       'Julio (encargo B73a)',
       now()
  from modifier_option mo
 where mo.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
   and mo.id in ('24ecabc0-f7c2-40ee-86ac-183042856fbe',   -- Lovers Burgers  · Si, con patatas
                 '3bcab085-fafe-4291-adfb-1509339a6fcd')   -- Scandal Burgers · Si, con patatas
   and not exists (select 1 from modifier_recipe_impact i where i.modifier_option_id = mo.id);

-- ── 4 · Guardas. Si algo no cuadra, la migracion entera se cae ────────────────
do $$
declare
  v_resueltos int;
  v_patatas   numeric;
  v_altas     int;
  v_sin_unidad int;
  v_bundles   int;
begin
  -- 4.1 · Los nueve resuelven a un numero MAYOR QUE CERO (no basta con que el
  --       campo deje de ser nulo: el cuarto camino silencioso es «no convertible»).
  select count(*) into v_resueltos
    from modifier_recipe_impact i
   where i.id in ('5eaf385a-2f5b-4775-8e7a-8802864933c2','cdce2b58-5db1-431e-a0b9-4848191e489c',
                  '7836585e-1d91-4dc1-8168-3862e8d197d7','93189cee-18ae-46bb-b38a-344eb6bb1f26',
                  '1c43dc42-e1c8-4fc9-b86c-6cdd081dd8cb','6910746a-4f4b-4eab-9350-860117aaa4b8',
                  'e4931b85-74fe-4369-aeb8-bcdb9e69b465','56ef1210-ae98-4660-bc0c-3add254c1036',
                  'b5b81ca0-cf10-4402-b71e-2463eeaaa13e')
     and public._impact_cost(i.target_recipe_item_id, i.quantity, i.unit_id) > 0;
  if v_resueltos <> 9 then
    raise exception 'B73a: solo % de 9 resuelven a un coste > 0.', v_resueltos;
  end if;

  -- 4.2 · El #8 da 0,876096 EUR. Si diera 1,100176 se habria colado el envase,
  --       y eso es B73b, no esto.
  select round(public._impact_cost(i.target_recipe_item_id, i.quantity, i.unit_id), 6)
    into v_patatas
    from modifier_recipe_impact i where i.id = 'b5b81ca0-cf10-4402-b71e-2463eeaaa13e';
  if v_patatas <> 0.876096 then
    raise exception 'B73a: el impacto de las patatas da % EUR, esperaba 0.876096. Si es 1.100176 se ha colado el envase.', v_patatas;
  end if;

  -- 4.3 · Las dos altas existen y estan completas.
  select count(*) into v_altas
    from modifier_recipe_impact i
   where i.modifier_option_id in ('24ecabc0-f7c2-40ee-86ac-183042856fbe','3bcab085-fafe-4291-adfb-1509339a6fcd')
     and i.impact_type = 'bundle' and i.status = 'confirmed'
     and i.unit_id is not null and i.quantity = 1
     and public._impact_cost(i.target_recipe_item_id, i.quantity, i.unit_id) = 0.876096;
  if v_altas <> 2 then
    raise exception 'B73a: hay % altas correctas, esperaba 2.', v_altas;
  end if;

  -- 4.4 · Lo que NO se toca sigue sin tocar: el #10, el duplicado de ternera y
  --       los dos `none`. Cuatro filas de Foodint con `unit_id` nulo.
  select count(*) into v_sin_unidad
    from modifier_recipe_impact
   where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and unit_id is null;
  if v_sin_unidad <> 4 then
    raise exception 'B73a: quedan % impactos sin unidad, esperaba 4.', v_sin_unidad;
  end if;

  -- 4.5 · Los 16 `bundle` de antes seguian completos y ahora son 19 (16 + el #8
  --       reconvertido + las 2 altas). Que NO cambien de VALOR se comprueba fuera,
  --       con la huella md5 tomada antes de esta migracion.
  select count(*) into v_bundles
    from modifier_recipe_impact
   where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     and impact_type = 'bundle' and status = 'confirmed'
     and unit_id is not null and quantity is not null and target_recipe_item_id is not null;
  if v_bundles <> 19 then
    raise exception 'B73a: hay % bundle completos, esperaba 19 (16 previos + patatas + 2 altas).', v_bundles;
  end if;
end $$;
