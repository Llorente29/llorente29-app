-- supabase/vuelta-atras/20261103T0743_s01q_glovo_rehacer.down.sql
--
-- Vuelta atrás de la 0743: fuera las propuestas rehechas y lo que se apuntó
-- como «sin propuesta»; vuelven las 27 de antes con sus líneas y sus pendientes,
-- y el 303 del 4T como estaba (con su calculated_at), desde conta_s01q10_antes.
do $$
declare v_303 constant uuid := '8ae554ae-4853-42c9-b5b0-346840223d47'; v_liqs uuid[];
begin
  if to_regclass('public.conta_s01q10_antes') is null then return; end if;
  select array_agg((fila #>> '{}')::uuid) into v_liqs from public.conta_s01q10_antes where que = 'liquidacion';
  delete from public.journal_entry e where e.source_type = 'channel_settlement' and e.source_id = any(v_liqs) and e.status = 'propuesto';
  delete from public.conta_propuesta_pendiente q where q.origen = 'channel_settlement' and q.origen_id = any(select x::text from unnest(v_liqs) x);
  insert into public.journal_entry select (jsonb_populate_record(null::public.journal_entry, fila)).* from public.conta_s01q10_antes where que = 'propuesta';
  insert into public.journal_line select (jsonb_populate_record(null::public.journal_line, fila)).* from public.conta_s01q10_antes where que = 'linea';
  insert into public.conta_propuesta_pendiente select (jsonb_populate_record(null::public.conta_propuesta_pendiente, fila)).* from public.conta_s01q10_antes where que = 'pendiente';
  delete from public.tax_return_line where tax_return_id = v_303;
  delete from public.tax_return_box where tax_return_id = v_303;
  delete from public.tax_return_check where tax_return_id = v_303;
  update public.tax_return t set status = a.status, amount = a.amount, result_kind = a.result_kind, calculated_at = a.calculated_at, updated_at = a.updated_at
    from (select (jsonb_populate_record(null::public.tax_return, fila)).* from public.conta_s01q10_antes where que = 'declaracion') a
   where t.id = a.id;
  insert into public.tax_return_line select (jsonb_populate_record(null::public.tax_return_line, fila)).* from public.conta_s01q10_antes where que = 'linea303';
  insert into public.tax_return_box select (jsonb_populate_record(null::public.tax_return_box, fila)).* from public.conta_s01q10_antes where que = 'caja';
  insert into public.tax_return_check select (jsonb_populate_record(null::public.tax_return_check, fila)).* from public.conta_s01q10_antes where que = 'comprobacion';
  drop table public.conta_s01q10_antes;
  raise notice 'S01q·10: las 27 propuestas y el 303, como estaban.';
end $$;
