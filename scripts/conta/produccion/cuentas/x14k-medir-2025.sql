-- scripts/conta/produccion/cuentas/x14k-medir-2025.sql
--
-- X14 · 2 · La carga a medias del 2025 de QBO Integrity (la empresa de la carga del 2024, e694df2e…) · SOLO LEE. SOLO NÚMEROS Y
-- TIPOS DE IVA: ni nombres, ni NIF, ni números de factura (T11). Cargas empezadas antes del 26/11/2026 a las 18:00 de Madrid
-- (corte fijo, W06). Cada medida sale siempre, también donde la carga no existe (staging).
--   1. Las recibidas que traen dos tramos o más al mismo tipo de IVA (lo que choca con supplier_invoice_tax), y cómo vienen.
--   2. Por dónde va la cola y en qué trozo para.
--   3. El diario, mes a mes: asientos y líneas leídas, y las frases de «no da lo mismo que ERP10» que guardó la carga.
with c as (
  select r.* from public.import_run r   -- quieta: la carga a medias no avanza mientras nadie pulse «Volver a intentarlo»
   where r.company_id = (select company_id from public.import_run where id = 'e694df2e-56ff-41b0-a7f7-94be3efaa6c9')
     and r.kind = 'carga' and r.status = 'cargando' and r.started_at < timestamptz '2026-11-26 18:00:00+01'
), t as (
  select q.* from public.conta_traer_trozo q join c on q.carga = c.id   -- quieta: como su carga
), f as (
  select t.orden, t.hecho, t.dato from t where t.tipo = 'factura' and t.dato->>'libro' = 'recibidas'
), g as (   -- cada (factura, tipo) con dos tramos o más
  select f.orden, f.hecho, (f.dato->>'asiento') is not null casada, z->>'tipo' tipo, count(*) n,
         count(distinct ((z->>'base'), (z->>'cuota'))) variantes,
         bool_or((z->>'cuota')::numeric = 0) con_cero, count(distinct sign((z->>'base')::numeric)) signos,
         jsonb_array_length(f.dato->'tramos') tramos
    from f, jsonb_array_elements(f.dato->'tramos') z
   group by f.orden, f.hecho, f.dato, z->>'tipo' having count(*) > 1
)
select clave, valor from (
  select 1 o, 'cargas a medias de QBO' clave, (select count(*) from c)::text valor
  union all select 2, 'cola · asientos (hechos · total)', (select count(*) filter (where hecho) || ' · ' || count(*) from t where tipo = 'asiento')
  union all select 3, 'cola · facturas recibidas (hechas · total)', (select count(*) filter (where hecho) || ' · ' || count(*) from f)
  union all select 4, 'cola · facturas emitidas (hechas · total)', (select count(*) filter (where hecho) || ' · ' || count(*) from t where tipo = 'factura' and dato->>'libro' = 'expedidas')
  union all select 5, 'cola · primer trozo sin hacer (tipo · libro · ¿tiene dos tramos al mismo tipo?)',
    coalesce((select t.tipo || ' · ' || coalesce(t.dato->>'libro', '—') || ' · ' || (exists (select 1 from g where g.orden = t.orden))::text
                from t where not t.hecho order by t.orden limit 1), 'ninguno')
  union all select 10, 'recibidas con dos tramos o más al mismo tipo de IVA', (select count(distinct orden) from g)::text
  union all select 11, 'tramos repetidos: grupos (factura y tipo)', (select count(*) from g)::text
  union all select 12, 'tramos repetidos: por tipo de IVA (tipo: grupos)', coalesce((select string_agg(x, ' · ' order by x) from (select coalesce(tipo, 'sin tipo') || ': ' || count(*) x from g group by tipo) y), 'ninguno')
  union all select 13, 'tramos repetidos: tramos por grupo (2 · 3 · más)', (select count(*) filter (where n = 2) || ' · ' || count(*) filter (where n = 3) || ' · ' || count(*) filter (where n > 3) from g)
  union all select 14, 'tramos repetidos: grupos con los tramos idénticos (misma base y cuota)', (select count(*) filter (where variantes = 1) from g)::text
  union all select 15, 'tramos repetidos: grupos con un tramo en negativo y otro en positivo', (select count(*) filter (where signos > 1) from g)::text
  union all select 16, 'tramos repetidos: grupos con algún tramo de cuota 0', (select count(*) filter (where con_cero) from g)::text
  union all select 17, 'tramos repetidos: facturas casadas con su asiento', (select count(distinct orden) filter (where casada) from g)::text
  union all select 18, 'tramos repetidos: facturas ya hechas (no debería haber ninguna)', (select count(distinct orden) filter (where hecho) from g)::text
  union all select 19, 'tramos repetidos: tramos de la factura en total (mínimo · máximo)', coalesce((select min(tramos) || ' · ' || max(tramos) from g), '—')
  union all
  select 30 + m.i, 'diario · ' || m.mes || ' · asientos · líneas leídas',
         (select count(*) || ' · ' || coalesce(sum(jsonb_array_length(dato->'apuntes')), 0) from t
           where t.tipo = 'asiento' and left(t.dato->>'fecha', 7) = m.mes)
    from (select i, '2025-' || lpad(i::text, 2, '0') mes from generate_series(1, 12) i) m
  union all select 50, 'diario · asientos fuera de 2025', (select count(*) from t where tipo = 'asiento' and left(dato->>'fecha', 4) <> '2025')::text
  union all select 51, 'frases guardadas · de «no da lo mismo que el resumen de ERP10»',
    (select count(*) from c, jsonb_array_elements_text(coalesce(c.detail->'estado'->'frases', '[]')) x where x like '%no da lo mismo%')::text
  union all select 52, 'frases guardadas · la de enero (solo tipos de asiento y recuentos)',
    coalesce((select left(x, 700) from c, jsonb_array_elements_text(coalesce(c.detail->'estado'->'frases', '[]')) x where x like 'En enero%no da lo mismo%' limit 1), 'ninguna')
) t order by o, clave;
