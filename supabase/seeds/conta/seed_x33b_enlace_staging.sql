-- supabase/seeds/conta/seed_x33b_enlace_staging.sql
--
-- X33b · El enlace del cobro de la semilla del X33 con su factura, como lo dejará la emisión del Q10. SOLO STAGING. Todo
-- inventado (T11). Se puede volver a lanzar. Va detrás de la 20261125T1320 (la tabla conta_gc_cobro_factura): desde la
-- 1320, un cobro sin factura atada va a «Pendiente de revisar», y la e2e del X33 prepara el de la semilla con su 430.
do $$
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'SEMILLA X33b: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regclass('public.conta_gc_cobro_factura') is null then raise exception 'SEMILLA X33b: falta la 20261125T1320.'; end if;
  insert into public.conta_gc_cobro_factura (company_id, account_id, gc_id, invoice_id)
  select '3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'c01a0000-0000-4000-8000-00000000000a', 'PM00X33SEM1', 'a3300000-0000-4000-8000-0000000000c1'
   where exists (select 1 from public.customer_invoice where id = 'a3300000-0000-4000-8000-0000000000c1')
  on conflict do nothing;
end $$;
