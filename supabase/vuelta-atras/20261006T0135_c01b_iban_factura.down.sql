-- supabase/vuelta-atras/20261006T0135_c01b_iban_factura.down.sql
--
-- Deshace 20261006T0135_c01b_iban_factura.sql: quita el freno, la decisión y
-- las columnas nuevas. Lo que se pierde es solo lo que esa migración trajo
-- (el IBAN leído de cada factura, las decisiones y el rastro del cambio).
--
-- OJO: si alguien llegó a decir «Es el nuevo IBAN», supplier.iban ya es el
-- nuevo y se queda así; esta vuelta atrás borra iban_previous, que era el
-- de antes. Por eso, antes de borrar, lo deja escrito en un NOTICE por
-- proveedor (sin el IBAN entero: los cuatro últimos).

do $$
declare r record;
begin
  for r in select id, right(iban_previous, 4) antes, right(iban, 4) ahora, iban_changed_at
             from public.supplier where iban_changed_at is not null loop
    raise notice 'Proveedor % cambió de IBAN (…% → …%) el %; se pierde el de antes.', r.id, r.antes, r.ahora, r.iban_changed_at;
  end loop;
end $$;

drop trigger if exists supplier_invoice_iban_guard on public.supplier_invoice;
drop function if exists public.supplier_invoice_iban_guard();
drop function if exists public.supplier_invoice_iban_decide(uuid, text, text);
alter table public.supplier
  drop column if exists iban_previous,
  drop column if exists iban_changed_at,
  drop column if exists iban_changed_by,
  drop column if exists iban_changed_by_name;
alter table public.supplier_invoice
  drop constraint if exists supplier_invoice_iban_decision_check,
  drop constraint if exists supplier_invoice_read_iban_format_check,
  drop column if exists read_iban,
  drop column if exists iban_decision,
  drop column if exists iban_decision_at,
  drop column if exists iban_decision_by,
  drop column if exists iban_decision_by_name;
