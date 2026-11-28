-- supabase/migrations/20261127T2205_x14l_tramos_por_casilla.sql
-- cambia: public.supplier_invoice_tax · prueba: supabase/staging/sql/20261127_x14l_tramos_por_casilla_prueba.sql
-- cambia: public.supplier_invoice_tax_tipo_y_casilla · prueba: supabase/staging/sql/20261127_x14l_tramos_por_casilla_prueba.sql
-- cambia: public.tg_supplier_invoice_tax_casilla · prueba: supabase/staging/sql/20261127_x14l_tramos_por_casilla_prueba.sql
--
-- X14 · 2 (Julio, 27/11: «sí»). El 2025 de QBO Integrity no entra en prueba: «conta_traer_seguir: duplicate key value violates
-- unique constraint supplier_invoice_tax_supplier_invoice_id_vat_pct_key». ERP10 manda cada factura recibida con hasta 8
-- casillas de IVA, y 10 de las 380 del 2025 traen dos (una, tres) al mismo tipo: en 9, una en positivo y otra en negativo (una
-- línea y su abono). En ERP10 es válido; Sumied solo admitía un tramo por factura y tipo. La copia de ERP10 es exacta: cada
-- casilla entra como su propio tramo, sin sumar ninguna y sin tirar ninguna.
--   1. supplier_invoice_tax.import_position (NUEVA): el número de la casilla, en el orden en que vino de ERP10 (1, 2, 3…). Vacía
--      en todo lo que no se trae de ERP10: las facturas de Sumied siguen como hoy, con un tramo por tipo.
--   2. Un disparador (tg_supplier_invoice_tax_casilla) la rellena solo, en una recibida traída (source = 'traida'), con la
--      siguiente de su factura. Así la carga (_conta_traer_seguir) no cambia: inserta las casillas en su orden, como hoy.
--   3. La regla de un tramo por factura y tipo pasa a ser por factura, tipo y casilla: primero el índice único nuevo
--      (supplier_invoice_tax_tipo_y_casilla, con la casilla vacía como una sola) y después se quita la restricción de antes
--      (supplier_invoice_tax_supplier_invoice_id_vat_pct_key), en la misma transacción.
-- Quién lee los tramos (medido el 27/11): en la base, se suman o se recorren en lista (s01o2, k09, e03, d03, d07c); los libros
-- de IVA y el 303 salen del diario, no de esta tabla. En la pantalla, los cuatro lectores los leen como lista.
-- No cambia ninguna fila al aplicarse (la columna nueva sale vacía). Nada en el camino del pedido. El real lo lanza Julio.
-- Vuelta atrás: devuelve la restricción de antes (para si ya hay dos tramos al mismo tipo en una factura) y quita lo nuevo.

-- 1 · La casilla ---------------------------------------------------------------------------------------------------------------
alter table public.supplier_invoice_tax add column if not exists import_position smallint;
comment on column public.supplier_invoice_tax.import_position is
  'X14l · La casilla de IVA de ERP10 (1, 2, 3…, en el orden en que vino). Solo en lo traído de ERP10; vacía en las facturas de Sumied.';
alter table public.supplier_invoice_tax add constraint supplier_invoice_tax_casilla_valida
  check (import_position is null or import_position between 1 and 99);

-- 2 · La rellena sola, en una recibida traída ------------------------------------------------------------------------------------
create or replace function public._supplier_invoice_tax_casilla()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.import_position is null
     and exists (select 1 from public.supplier_invoice i where i.id = new.supplier_invoice_id and i.source = 'traida') then
    select coalesce(max(t.import_position), 0) + 1 into new.import_position
      from public.supplier_invoice_tax t where t.supplier_invoice_id = new.supplier_invoice_id;
  end if;
  return new;
end $$;
revoke all on function public._supplier_invoice_tax_casilla() from public, anon, authenticated;
create trigger tg_supplier_invoice_tax_casilla before insert on public.supplier_invoice_tax
  for each row execute function public._supplier_invoice_tax_casilla();

-- 3 · Un tramo por factura, tipo y casilla: el índice nuevo antes de quitar la regla de antes -------------------------------------
create unique index if not exists supplier_invoice_tax_tipo_y_casilla
  on public.supplier_invoice_tax (supplier_invoice_id, vat_pct, coalesce(import_position, 0));
alter table public.supplier_invoice_tax drop constraint supplier_invoice_tax_supplier_invoice_id_vat_pct_key;
