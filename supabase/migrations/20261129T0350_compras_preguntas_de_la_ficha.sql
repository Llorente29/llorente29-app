-- cambia: public._compras_camino_guarda · prueba: supabase/staging/sql/20261129_compras_preguntas_de_la_ficha_prueba.sql
-- cambia: public._compras_forma_facturar · prueba: supabase/staging/sql/20261129_compras_preguntas_de_la_ficha_prueba.sql
--
-- supabase/migrations/20261129T0350_compras_preguntas_de_la_ficha.sql
--
-- Compras · AL GUARDAR LA FICHA, LAS PREGUNTAS QUE SALEN DE LA FICHA SE
-- VUELVEN A MIRAR, TAMBIÉN EN LAS RECEPCIONES QUE YA TIENEN FACTURA (Julio,
-- 21/10: «recalcular las preguntas abiertas al guardar la ficha»).
--
-- Lo que pasaba (medido en producción el 21/10, solo lectura): Julio puso la
-- forma de facturar de EUROPASTRY, COHELDI y OLIMPO entre las 09:11 y las
-- 09:13, y «Por revisar» siguió preguntando «la ficha no dice cómo factura» en
-- 5 recepciones. Las 5 ya tenían su factura hecha (consumed_at puesto), y
-- _compras_camino_guarda se salta ENTERA una recepción consumida: el camino
-- no se vuelve a decidir —bien—, pero la pregunta tampoco —mal—, y se queda
-- para siempre diciendo algo que ya no es verdad.
--
-- El cambio, en las dos funciones (las dos con la misma firma: en caliente):
--   · _compras_camino_guarda: en una recepción consumida, el camino sigue sin
--     tocarse, pero las dos preguntas que salen de la FICHA —ficha_sin_forma y
--     papel_y_ficha— se vuelven a calcular. Si hoy sale una de esas dos o
--     ninguna, se escribe; si sale otra cosa, no se toca. Las preguntas del
--     paso de la factura (factura_repetida, factura_sin_importes, error) no se
--     tocan nunca: las pone el disparador de la factura y no dependen de la
--     ficha.
--   · _compras_forma_facturar: además de las no consumidas, recorre las
--     consumidas que tienen una de esas dos preguntas.
--
-- Los cuerpos de partida son los de la 0120, comprobados contra producción el
-- 21/10 (md5 del cuerpo: guarda 63843e28…, forma 73d8f962…). Lo único nuevo
-- en cada uno va marcado con «0350».
--
-- El tipo de gasto no necesita nada aquí: lo que le falta a una ficha
-- (compras_ficha_le_falta) se calcula al leer, así que en cuanto se guarda
-- deja de salir.
--
-- No toca el camino del pedido: goods_receipt_path es de las recepciones de
-- compra. El disparador trg_goods_receipt_path_factura salta con el update,
-- pero no hace nada en una fila consumida (primera línea de su cuerpo, 0140).
-- No cambia datos: la pasada de las que ya están mal es la 0360.
-- Vuelta atrás: supabase/vuelta-atras/20261129T0350_compras_preguntas_de_la_ficha.down.sql

create or replace function public._compras_camino_guarda(p_recepcion uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_cuenta uuid; p goods_receipt_path;
begin
  select account_id into v_cuenta from goods_receipt where id = p_recepcion;
  select * into p from goods_receipt_path where goods_receipt_id = p_recepcion;
  if p.consumed_at is not null then
    -- 0350: ya la usó una factura, un casado o una liquidación, y el camino no
    -- se vuelve a decidir. Pero las preguntas que salen de la ficha sí: si la
    -- ficha cambió, la de antes ya no es verdad.
    if p.question in ('ficha_sin_forma', 'papel_y_ficha') then
      v := public._compras_camino_calcula(p_recepcion);
      if v->>'question' is null or v->>'question' in ('ficha_sin_forma', 'papel_y_ficha') then
        update goods_receipt_path set question = v->>'question', question_detail = nullif(v->'question_detail', 'null'::jsonb)
         where id = p.id
           and (question, question_detail) is distinct from (v->>'question', nullif(v->'question_detail', 'null'::jsonb));
      end if;
    end if;
    return null;
  end if;
  v := public._compras_camino_calcula(p_recepcion);
  insert into goods_receipt_path (account_id, goods_receipt_id, path, supplier_id, company_id, doc_type, bill_to_name, bill_to_tax_id,
                                  bill_to_how, question, question_detail, reason, error, decided_at)
  values (v_cuenta, p_recepcion, v->>'path', (v->>'supplier_id')::uuid, (v->>'company_id')::uuid, v->>'doc_type', v->>'bill_to_name',
          v->>'bill_to_tax_id', v->>'bill_to_how', v->>'question', nullif(v->'question_detail', 'null'::jsonb), v->>'reason', null, now())
  on conflict (goods_receipt_id) do update set
    path = excluded.path, supplier_id = excluded.supplier_id, company_id = excluded.company_id, doc_type = excluded.doc_type,
    bill_to_name = excluded.bill_to_name, bill_to_tax_id = excluded.bill_to_tax_id, bill_to_how = excluded.bill_to_how,
    question = excluded.question, question_detail = excluded.question_detail, reason = excluded.reason, error = null, decided_at = now();
  return v;
end $$;
revoke all on function public._compras_camino_guarda(uuid) from public, anon, authenticated;
comment on function public._compras_camino_guarda(uuid) is
  'Compras. Decide y guarda el camino de una recepción. Si ya la usó una factura, un casado o una liquidación (consumed_at), el camino no se toca; solo se vuelven a mirar las preguntas que salen de la ficha (ficha_sin_forma, papel_y_ficha) — 0350, 21/10.';

create or replace function public._compras_forma_facturar(p_proveedor uuid, p_modo text, p_por_local boolean, p_frecuencia text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int := 0; r record; v_cuenta uuid;
begin
  select account_id into v_cuenta from supplier where id = p_proveedor;
  if v_cuenta is null then raise exception 'Ese proveedor no existe.' using errcode = 'P0002'; end if;
  update supplier set invoicing_mode = p_modo,
         invoicing_per_location = case when p_modo = 'delivery_note_then_invoice' then p_por_local else null end,
         invoicing_frequency = case when p_modo = 'delivery_note_then_invoice' then coalesce(p_frecuencia, invoicing_frequency)
                                    when p_modo = 'per_delivery' then 'per_delivery'
                                    when p_modo = 'monthly_settlement' then 'monthly' else invoicing_frequency end
   where id = p_proveedor;
  -- 0350: también las consumidas con una pregunta de la ficha.
  for r in select p.goods_receipt_id from goods_receipt_path p join goods_receipt g on g.id = p.goods_receipt_id
            where p.account_id = v_cuenta
              and (p.consumed_at is null or p.question in ('ficha_sin_forma', 'papel_y_ficha'))
              and (g.supplier_id = p_proveedor or p.supplier_id = p_proveedor
                   or (p.question = 'a_nombre_de' and (p.question_detail->>'proveedor')::uuid = p_proveedor)) loop
    perform public._compras_camino_guarda(r.goods_receipt_id); v_n := v_n + 1;
  end loop;
  return jsonb_build_object('proveedor', p_proveedor, 'modo', p_modo, 'recepciones', v_n);
end $$;
revoke all on function public._compras_forma_facturar(uuid, text, boolean, text) from public, anon, authenticated;
