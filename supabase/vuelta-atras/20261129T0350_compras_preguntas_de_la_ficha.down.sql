-- supabase/vuelta-atras/20261129T0350_compras_preguntas_de_la_ficha.down.sql
--
-- Vuelta atrás de la 0350: _compras_camino_guarda y _compras_forma_facturar
-- vuelven a los cuerpos de la 0120, tal cual (md5 del cuerpo: guarda
-- 63843e28…, forma 73d8f962…), y sin el comentario que les puso la 0350.
-- No devuelve preguntas: lo que la 0360 (o un guardado de la ficha) dejó
-- recalculado se queda así, que es lo verdadero; deshacer la 0360 es su
-- propio fichero.

create or replace function public._compras_camino_guarda(p_recepcion uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_cuenta uuid;
begin
  select account_id into v_cuenta from goods_receipt where id = p_recepcion;
  if exists (select 1 from goods_receipt_path where goods_receipt_id = p_recepcion and consumed_at is not null) then
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
comment on function public._compras_camino_guarda(uuid) is null;

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
  for r in select p.goods_receipt_id from goods_receipt_path p join goods_receipt g on g.id = p.goods_receipt_id
            where p.account_id = v_cuenta and p.consumed_at is null
              and (g.supplier_id = p_proveedor or p.supplier_id = p_proveedor
                   or (p.question = 'a_nombre_de' and (p.question_detail->>'proveedor')::uuid = p_proveedor)) loop
    perform public._compras_camino_guarda(r.goods_receipt_id); v_n := v_n + 1;
  end loop;
  return jsonb_build_object('proveedor', p_proveedor, 'modo', p_modo, 'recepciones', v_n);
end $$;
revoke all on function public._compras_forma_facturar(uuid, text, boolean, text) from public, anon, authenticated;
