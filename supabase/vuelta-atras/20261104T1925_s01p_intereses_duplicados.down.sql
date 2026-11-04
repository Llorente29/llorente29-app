-- supabase/vuelta-atras/20261104T1925_s01p_intereses_duplicados.down.sql
--
-- Vuelta atrás de la 1925: el 4/3313 vuelve desde el respaldo con sus líneas; la
-- serie 4 y la cadena, a su número y su huella de antes; y el 303 del 4T como
-- estaba, con su calculated_at, desde conta_s01p6_303_antes.
do $$
declare v_lote uuid; r jsonb;
begin
  select lote into v_lote from public.conta_asiento_borrado
   where company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and que = 'asiento' and deshecho_at is null
     and motivo like 'S01p·6 · Duplicado:%' order by at desc limit 1;
  if v_lote is null then return; end if;
  -- Antes de devolver el asiento, fuera las líneas del 303 recalculado (si no, no se puede renumerar).
  delete from public.tax_return_line where tax_return_id = '8ae554ae-4853-42c9-b5b0-346840223d47';
  r := public._conta_asientos_borrado_deshacer(v_lote);
  if to_regclass('public.conta_s01p6_303_antes') is not null then
    delete from public.tax_return_box where tax_return_id = '8ae554ae-4853-42c9-b5b0-346840223d47';
    delete from public.tax_return_check where tax_return_id = '8ae554ae-4853-42c9-b5b0-346840223d47';
    update public.tax_return t set status = a.status, amount = a.amount, result_kind = a.result_kind,
           calculated_at = a.calculated_at, updated_at = a.updated_at
      from (select (jsonb_populate_record(null::public.tax_return, fila)).* from public.conta_s01p6_303_antes where que = 'declaracion') a
     where t.id = a.id;
    insert into public.tax_return_line select (jsonb_populate_record(null::public.tax_return_line, fila)).* from public.conta_s01p6_303_antes where que = 'linea';
    insert into public.tax_return_box select (jsonb_populate_record(null::public.tax_return_box, fila)).* from public.conta_s01p6_303_antes where que = 'caja';
    insert into public.tax_return_check select (jsonb_populate_record(null::public.tax_return_check, fila)).* from public.conta_s01p6_303_antes where que = 'comprobacion';
    drop table public.conta_s01p6_303_antes;
  end if;
  raise notice 'S01p·6: %', r->>'texto';
end $$;
