-- supabase/seeds/conta/seed_c01b_r2_staging.sql
--
-- C01b, respuesta 2 · Los dos casos nuevos, en Panadería Luna (cuenta A), que
-- no tenía facturas: así no cambia ninguna cifra de Hermanos Ruiz que miran
-- las capturas y las e2e. SOLO STAGING; datos inventados. Necesita la 0135
-- (read_iban). Se puede volver a lanzar: ids fijos y «on conflict do nothing».
--
--   · IBAN en la ficha de Luna (de ejemplo, válido).
--   · L-0412 y L-412: misma fecha e importe, otro número → «¿Posible repetida?».
--   · L-0431: trae otro IBAN (leído) → «IBAN distinto al de la ficha».

do $$
declare
  a_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  a_local  constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  a_luna   constant uuid := 'c01a0000-0000-4000-8000-0000000000a5';
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla C01b R2: esta base tiene cuentas de producción. No se siembra nada.';
  end if;
  if to_regprocedure('public.supplier_invoice_iban_decide(uuid,text,text)') is null then
    raise exception 'Semilla C01b R2: falta la 0135 (read_iban). Aplícala antes.';
  end if;

  update public.supplier set iban = 'ES6000491500051234567892', iban_verified_at = now()
   where id = a_luna and iban is null;

  insert into public.supplier_invoice (id, account_id, supplier_id, location_id, invoice_number, invoice_date, status,
    tax_base_total, tax_total, grand_total, source, created_by_name, created_at, read_iban)
  values
    ('c1b0a000-0000-4000-8000-000000000511', a_cuenta, a_luna, a_local, 'L-0412', date '2026-09-30', 'aprobada',
      79.45, 7.95, 87.40, 'manual', 'Semillas C01b R2', now() - interval '2 days', null),
    ('c1b0a000-0000-4000-8000-000000000512', a_cuenta, a_luna, a_local, 'L-412', date '2026-09-30', 'aprobada',
      79.45, 7.95, 87.40, 'ocr', 'Semillas C01b R2', now() - interval '1 day', null),
    ('c1b0a000-0000-4000-8000-000000000513', a_cuenta, a_luna, a_local, 'L-0431', date '2026-10-02', 'aprobada',
      138.45, 13.85, 152.30, 'ocr', 'Semillas C01b R2', now() - interval '1 hour', 'ES2120800000611234567890')
  on conflict (id) do nothing;

  raise notice 'Semilla C01b R2: IBAN de Luna, una posible repetida (L-412) y una factura con IBAN distinto (L-0431).';
end $$;
