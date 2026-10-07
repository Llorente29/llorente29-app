-- supabase/staging/sql/20261011_c04_prueba_agente.sql
--
-- SOLO STAGING. El agente «Libro diario» (scripts/conta/agente-libro.sql)
-- tiene que poder FALLAR: un vigía que solo da verde es un espejo (regla 31).
-- Dentro de una transacción que acaba en ROLLBACK:
--   1. Sobre la semilla del C04, el agente no encuentra nada.
--   2. Se rompe a propósito una cosa por comprobación (con los disparadores
--      apagados: es lo que la base no deja hacer por las buenas).
--   3. El agente encuentra cada una.
-- El agente se lee del MISMO fichero que corre cada noche (\set con cat): la
-- prueba mide lo que se despliega, no una copia.

begin;
\set agente `cat scripts/conta/agente-libro.sql`

create temp table antes on commit drop as :agente

do $$
declare j json := (select * from antes); k text;
begin
  if (j->'contado'->>'validados')::int = 0 then raise exception 'PRUEBA agente · 1: no hay asientos validados (¿falta la semilla del C04?).'; end if;
  foreach k in array array['cuadre', 'huecos', 'cadena', 'iva', 'ventas_dia', 'cedidas_70', 'socio_gasto', 'resultado', 'mes_cerrado'] loop
    if json_array_length(j->k) <> 0 then raise exception 'PRUEBA agente · 1: «%» sale con % filas sobre la semilla: %', k, json_array_length(j->k), j->k; end if;
  end loop;
  raise notice 'PRUEBA agente · 1 en verde: % asientos validados y nada que decir.', j->'contado'->>'validados';
end $$;

-- 2 · Romper una cosa por comprobación.
alter table public.journal_entry disable trigger user;
alter table public.journal_line disable trigger user;
do $$
declare
  ea constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  eb constant uuid := '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6';
  v_nomina uuid; v_prestamo uuid; v_factura uuid; v_ventas uuid;
begin
  select id into v_nomina   from public.journal_entry where company_id = ea and source_type = 'payroll' and status = 'validado' limit 1;
  select id into v_prestamo from public.journal_entry where company_id = ea and concept = 'Cuota del préstamo · octubre';
  select id into v_factura  from public.journal_entry where company_id = ea and source_type = 'supplier_invoice' and status = 'validado' limit 1;
  select id into v_ventas   from public.journal_entry where company_id = ea and source_type = 'sales_day' and status = 'validado' limit 1;
  if v_nomina is null or v_prestamo is null or v_factura is null or v_ventas is null then
    raise exception 'PRUEBA agente · 2: falta algún asiento de la semilla del C04.';
  end if;
  -- cuadre (y con él la cadena): un apunte de la nómina cambia de importe.
  update public.journal_line set debit = debit + 1 where entry_id = v_nomina and position = 1;
  -- huecos: el préstamo (General nº 1) pasa a ser el nº 9.
  update public.journal_entry set number = 9 where id = v_prestamo;
  -- iva: la base del IVA de la factura deja de dar su cuota.
  update public.journal_line set tax_base = tax_base + 100 where entry_id = v_factura and tax_rate_id is not null;
  -- cedidas_70: la venta del día se apunta a la marca cedida.
  update public.journal_line set brand_id = 'e0200000-0000-4000-8000-00000000a0b5' where entry_id = v_ventas and position = 2;
  -- socio_gasto: la compra de la factura queda a nombre del socio de marca.
  update public.journal_line set party_id = (select party_id from public.party_role where supplier_id = 'c0300000-0000-4000-8000-000000000002' limit 1)
   where entry_id = v_factura and position = 1;
  -- resultado: un gasto sin local ni «común».
  update public.journal_line set location_id = null, is_common = false where entry_id = v_factura and position = 1;
  -- ventas_dia: el resumen dice un ticket más de los que guarda.
  update public.sales_day_summary set tickets_count = tickets_count + 1 where entry_id = v_ventas;
  -- mes_cerrado: octubre de B cerrado ANTES de validar su préstamo.
  insert into public.fiscal_period_lock (account_id, company_id, fiscal_year_id, month, locked_at, locked_by_name)
  select account_id, company_id, fiscal_year_id, '2026-10-01', validated_at - interval '1 hour', 'prueba'
    from public.journal_entry where company_id = eb and status = 'validado' limit 1;
  -- propuestas: una propuesta de hace 8 días.
  update public.journal_entry set created_at = now() - interval '8 days' where company_id = ea and status = 'propuesto'
     and id = (select id from public.journal_entry where company_id = ea and status = 'propuesto' limit 1);
end $$;

create temp table despues on commit drop as :agente

do $$
declare j json := (select * from despues); k text; faltan text := '';
begin
  foreach k in array array['cuadre', 'huecos', 'cadena', 'iva', 'ventas_dia', 'cedidas_70', 'socio_gasto', 'resultado', 'mes_cerrado', 'propuestas'] loop
    if json_array_length(j->k) = 0 then faltan := faltan || ' ' || k; end if;
  end loop;
  if faltan <> '' then raise exception 'PRUEBA agente · 3: no ha visto lo roto en:%', faltan; end if;
  raise notice 'PRUEBA agente · 3 en verde: ve las diez (cuadre %, huecos %, cadena %, iva %, ventas_dia %, cedidas_70 %, socio_gasto %, resultado %, mes_cerrado %, propuestas %).',
    json_array_length(j->'cuadre'), json_array_length(j->'huecos'), json_array_length(j->'cadena'), json_array_length(j->'iva'),
    json_array_length(j->'ventas_dia'), json_array_length(j->'cedidas_70'), json_array_length(j->'socio_gasto'), json_array_length(j->'resultado'),
    json_array_length(j->'mes_cerrado'), json_array_length(j->'propuestas');
end $$;

\echo '>>> Prueba del agente «Libro diario» en verde. ROLLBACK: no queda nada.'
rollback;
