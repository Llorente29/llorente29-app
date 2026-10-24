-- supabase/migrations/20261129T0360_compras_preguntas_foodint.sql
--
-- Compras · LA PASADA ÚNICA DE HOY: las preguntas de la ficha que se quedaron
-- viejas en Foodint (Julio, 21/10: «con la pasada única de hoy con
-- "autorizo"»). Va con la 0350 y detrás: ésa arregla el guardado de la ficha;
-- ésta, lo que ya quedó mal antes de que existiera.
--
-- Medido en producción el 21/10 (solo lectura, todas las cuentas): 6
-- recepciones con pregunta abierta en «Por revisar», las 6 de Foodint; 5 ya
-- con factura (consumidas) y con una pregunta que hoy ya no sale:
--   · ALB-00195 y ALB-00203 (EUROPASTRY), ALB-00198 y ALB-00206 (COHELDI):
--     «la ficha no dice cómo factura», y ya lo dice («con cada entrega»):
--     la pregunta desaparece;
--   · ALB-00218 (OLIMPO): «la ficha no dice cómo factura», y ahora dice
--     «albarán y factura después» mientras el documento es un albarán-factura:
--     pasa a «el documento y la ficha no dicen lo mismo», que es verdad y se
--     puede cerrar con «dejarlo así».
-- La sexta, ALB-00215 (COHELDI, sin consumir), ya se recalculó al guardar
-- (09:11) y su pregunta es verdad: albarán frente a «con cada entrega».
--
-- Solo Foodint (cuenta 51ad1792…; regla 9); en otra base no hace nada. Solo
-- las consumidas con una pregunta de la ficha, con el mismo cálculo que usa el
-- guardado (_compras_camino_calcula) y el update a la vista, para que el
-- analizador lo vea: no escribe nada que no escribiera un guardado de la
-- ficha con la 0350. Si hay más de 20 (se midieron 5), para y no cambia
-- nada. No toca el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261129T0360_compras_preguntas_foodint.down.sql

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  r record; v_n int := 0; v jsonb;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'Compras 0360: esta base no tiene a Foodint: no hay nada que recalcular.';
    return;
  end if;
  select count(*) into v_n from public.goods_receipt_path
   where account_id = v_acc and consumed_at is not null and question in ('ficha_sin_forma', 'papel_y_ficha');
  if v_n > 20 then
    raise exception 'Compras 0360: % recepciones consumidas con pregunta de la ficha; se midieron 5: no se cambia nada.', v_n;
  end if;

  v_n := 0;
  for r in select p.id, p.goods_receipt_id, g.code, p.question
             from public.goods_receipt_path p join public.goods_receipt g on g.id = p.goods_receipt_id
            where p.account_id = v_acc and g.account_id = v_acc and p.consumed_at is not null
              and p.question in ('ficha_sin_forma', 'papel_y_ficha')
            order by g.code loop
    -- Lo mismo que hace _compras_camino_guarda (0350) con una consumida, a la
    -- vista: el camino no se toca; la pregunta, solo si hoy sale una de la
    -- ficha o ninguna.
    v := public._compras_camino_calcula(r.goods_receipt_id);
    if v->>'question' is null or v->>'question' in ('ficha_sin_forma', 'papel_y_ficha') then
      update public.goods_receipt_path set question = v->>'question', question_detail = nullif(v->'question_detail', 'null'::jsonb)
       where id = r.id and account_id = v_acc;
      v_n := v_n + 1;
    end if;
    raise notice 'Compras 0360: % · % → %', r.code, r.question, coalesce(v->>'question', 'sin pregunta');
  end loop;
  raise notice 'Compras 0360: % recepciones de Foodint con la pregunta vuelta a calcular.', v_n;
end $$;
