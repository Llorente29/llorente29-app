-- ============================================================================
-- SOLO STAGING · R9 (13/10) · staging como estaba producción antes de la tanda
-- ----------------------------------------------------------------------------
-- Lo corre scripts/conta/produccion/real-en-staging.sh DESPUÉS de deshacer la
-- tanda que staging ya tenía (run 144) y ANTES de tomar las cuentas de antes.
-- Con las funciones de antes (sin regla por plataforma), la empresa A tiene,
-- como Foodint el 13/10, días propuestos enteros que la 0130 retirará:
--   24/09 · Glovo, Casa Lola: 22,00 (base 20,00) y 11,00; una cedida de 18,00.
--   25/09 · Glovo, Casa Lola: 16,50 (base 15,00).
-- Y los propone el cierre del día, el de antes (conta_proponer_dias), como lo
-- habría hecho el cron. Si ya están (otra vuelta), no los repite.
-- ============================================================================
do $$
declare
  v_acc    constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc    constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_marca  constant uuid := '7e000000-0000-4000-8000-000000000b01';
  v_cedida constant uuid := 'e0200000-0000-4000-8000-00000000a0b5';
  v_glovo  constant uuid := 'e0200000-0000-4000-8000-00000000a0c1';
  h        constant interval := interval '13 hours';
  v_e uuid; v jsonb;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Preparar staging (R9): esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regclass('public.conta_ventas_canal') is not null then
    raise exception 'Preparar staging (R9): la tanda de ventas por plataforma sigue puesta; primero se deshace.';
  end if;
  select id into v_e from public.company where account_id = v_acc order by created_at limit 1;
  if not exists (select 1 from public.sale where account_id = v_acc and platform_order_code like 'R9-%') then
    insert into public.sale (account_id, location_id, brand_id, channel_id, sold_at, status, order_status, total, taxable_base, tax, source, platform_order_code, is_active) values
      (v_acc, v_loc, v_marca,  v_glovo, ('2026-09-24'::timestamp + h) at time zone 'Europe/Madrid', 'closed', 'completed', 22.00, 20.00, 2.00, 'hubrise', 'R9-2401', true),
      (v_acc, v_loc, v_marca,  v_glovo, ('2026-09-24'::timestamp + h + interval '1 hour') at time zone 'Europe/Madrid', 'closed', 'completed', 11.00, null, null, 'hubrise', 'R9-2402', true),
      (v_acc, v_loc, v_cedida, v_glovo, ('2026-09-24'::timestamp + h + interval '2 hours') at time zone 'Europe/Madrid', 'closed', 'completed', 18.00, null, null, 'hubrise', 'R9-2403', true),
      (v_acc, v_loc, v_marca,  v_glovo, ('2026-09-25'::timestamp + h) at time zone 'Europe/Madrid', 'closed', 'completed', 16.50, 15.00, 1.50, 'hubrise', 'R9-2501', true);
  end if;
  v := public.conta_proponer_dias(v_e, now());
  raise notice 'Preparar staging (R9): el cierre del día de antes: %', v - 'company_id';
  raise notice 'Preparar staging (R9): la empresa A tiene % asiento(s) de ventas del día entero propuestos (los 24 y 25/09: %).',
    (select count(*) from public.journal_entry e join public.sales_day_summary d on d.entry_id = e.id where e.company_id = v_e and e.status = 'propuesto'),
    (select count(*) from public.sales_day_summary d where d.company_id = v_e and d.sales_day in ('2026-09-24', '2026-09-25'));
end $$;
