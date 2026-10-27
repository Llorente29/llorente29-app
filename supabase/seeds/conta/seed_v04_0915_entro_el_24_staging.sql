-- ============================================================================
-- V04 · Respuesta 5, punto 5 · F-2026-0915 ENTRÓ EL 24/09. SOLO STAGING-CONTA.
-- ----------------------------------------------------------------------------
-- De dónde salía el descuadre del agente de los libros (#347) en staging:
--   · seed_c01_staging creaba la factura (fecha 24/09) el día que se pasaba la
--     semilla: created_at 01/10/2026 22:40 UTC;
--   · seed_c04_staging la asienta el 24/09 (journal_entry_proponer);
--   · el libro la registra el día que entró (D07, 0850): el 01/10. Asiento en el
--     3T y su IVA en el 4T.
-- seed_c01_staging ya la crea con created_at el 24/09. Esto deja igual lo que
-- ya está en staging: la factura entró el 24/09 y su libro la registra ese día.
--
-- Con el candado (1233), si el 3T de la cuenta A estuviera presentado, esto
-- PARA (cambia el libro de un periodo presentado). Hoy no lo está.
-- Se puede volver a pasar. Guarda: aborta con cuentas de producción.
-- ============================================================================

do $$
declare
  a_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  a_ruiz   constant uuid := 'c01a0000-0000-4000-8000-0000000000a3';
  v_factura uuid; v_n int;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'V04 · semilla F-2026-0915 ABORTADA: esta base tiene cuentas de producción.';
  end if;
  select id into v_factura from public.supplier_invoice
   where account_id = a_cuenta and supplier_id = a_ruiz and invoice_number = 'F-2026-0915';
  if v_factura is null then
    raise notice 'V04 · F-2026-0915 no está en esta base: nada que hacer.';
    return;
  end if;
  update public.supplier_invoice set created_at = timestamptz '2026-09-24 09:00:00+02'
   where id = v_factura and created_at::date <> date '2026-09-24';
  update public.vat_book_entry v set received_date = date '2026-09-24', updated_at = now(), updated_by_name = 'Semillas V04'
    from public.journal_entry e
   where e.account_id = a_cuenta and e.source_type = 'supplier_invoice' and e.source_id = v_factura
     and v.entry_id = e.id and v.account_id = a_cuenta and v.received_date is distinct from date '2026-09-24';
  get diagnostics v_n = row_count;
  raise notice 'V04 · F-2026-0915: entró el 24/09; % anotaciones del libro registradas ese día.', v_n;
end $$;
