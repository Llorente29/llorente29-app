-- scripts/conta/produccion/cuentas/r19a-copia-gocardless.sql
--
-- R19 · paso 0 · La copia de GoCardless · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cuántas copias y filas copiadas hay, tomadas antes del corte (antes de la tanda las tablas no existen: 0; después, 0
-- hasta la primera lectura). Las copias solo se añaden y no cambian nunca, así que con el corte no crecen a mitad de un
-- ensayo. (25/11: la de antes contaba lo leído de GoCardless por leido_at, que cada lectura reescribe: no era un corte
-- fijo y el «revisar» del #810 lo paró con razón.) Corte fijo: el 26/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  select 1 o, 'tabla entera · copias de GoCardless' clave,
         case when to_regclass('public.conta_gc_copia') is null then '0'
              else (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.conta_gc_copia where tomada_at < timestamptz ''2026-11-26 00:00:00+01''', false, true, '')))[1]::text end valor
  union all
  select 2, 'tabla entera · filas copiadas',
         case when to_regclass('public.conta_gc_copia_fila') is null then '0'
              else (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.conta_gc_copia_fila f join public.conta_gc_copia c on c.id = f.copia_id where c.tomada_at < timestamptz ''2026-11-26 00:00:00+01''', false, true, '')))[1]::text end
) t order by o, clave;
