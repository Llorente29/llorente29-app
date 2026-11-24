-- scripts/conta/produccion/cuentas/k13-recibida-calcada.sql
--
-- K13 · El código corto (2347) y el reparto en tramos (0001) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Por cuenta (regla 9; los locales, las marcas y las plataformas son de la cuenta, no de la empresa):
--   · los locales, las marcas y las plataformas: cuántos y su huella (id y nombre): la tanda no los toca;
--   · los códigos cortos (conta_codigo_corto, que crea la 2347): cuántos de cada origen («propuesto», «a_mano»,
--     «erp10») y cuántos sin código. Si la tabla no existe (antes de la tanda y después de su vuelta atrás), 0 códigos;
--     después de la tanda, lo que puso el relleno: lo que pide el encargo, cuántos salen de cada manera;
--   · las recibidas contabilizadas y sus apuntes: cuántas y su huella (la tanda no toca ningún asiento validado).
-- Y siempre una fila con todas las cuentas juntas, aunque no haya filas (staging, 23/11).
with q as (
  select 'locales' que, 'locations' tabla, account_id, id, name from public.locations where account_id is not null
  union all select 'marcas', 'brand', account_id, id, name from public.brand
  union all select 'plataformas', 'sales_channel', account_id, id, name from public.sales_channel
), k as (
  -- Los códigos, si la tabla existe: «tabla|id|origen» por fila.
  select split_part(x, '|', 1) tabla, split_part(x, '|', 2)::uuid id, split_part(x, '|', 3) origen
    from unnest(case when to_regclass('public.conta_codigo_corto') is null then '{}'::text[]
                     else (select array_agg(t::text) from unnest(xpath('/table/row/f/text()',
                             query_to_xml('select tabla || ''|'' || entity_id || ''|'' || origen f from public.conta_codigo_corto', false, false, ''))) t) end) x
), c as (
  select q.que, q.account_id, q.id, q.name, k.origen from q left join k on k.tabla = q.tabla and k.id = q.id
), v as (
  select e.account_id, e.id, md5(string_agg(concat_ws('|', jl.company_account_id, jl.debit, jl.credit, jl.location_id, jl.brand_id, jl.channel_id), ';' order by jl.id)) h
    from public.journal_entry e join public.journal_line jl on jl.entry_id = e.id
   where e.source_type = 'supplier_invoice' and e.status = 'validado'
   group by e.account_id, e.id
)
select clave, valor from (
  select 0 o, null::uuid account_id, 0 s,
         'todas las cuentas · locales, marcas y plataformas: filas · huella' clave,
         count(*) || ' · ' || coalesce(left(md5(string_agg(concat_ws('|', que, account_id, id, name), ';' order by que, account_id, id)), 12), 'ninguna') valor
    from c
  union all
  select 0, null, 1, 'todas las cuentas · códigos cortos: propuestos · a mano · de ERP10 · sin código',
         count(*) filter (where origen = 'propuesto') || ' · ' || count(*) filter (where origen = 'a_mano') || ' · '
           || count(*) filter (where origen = 'erp10') || ' · ' || count(*) filter (where origen is null)
    from c
  union all
  select 0, null, 2, 'todas las cuentas · recibidas contabilizadas: asientos · huella de sus apuntes',
         count(*) || ' · ' || coalesce(left(md5(string_agg(h, ';' order by account_id, id)), 12), 'ninguna')
    from v
  union all
  select 1, account_id, 0, 'cuenta ' || account_id || ' · ' || que || ': filas · huella',
         count(*) || ' · ' || left(md5(string_agg(concat_ws('|', id, name), ';' order by id)), 12)
    from c group by account_id, que
  union all
  select 1, account_id, 1, 'cuenta ' || account_id || ' · ' || que || ' · códigos cortos: propuestos · a mano · de ERP10 · sin código',
         count(*) filter (where origen = 'propuesto') || ' · ' || count(*) filter (where origen = 'a_mano') || ' · '
           || count(*) filter (where origen = 'erp10') || ' · ' || count(*) filter (where origen is null)
    from c group by account_id, que
  union all
  select 1, account_id, 2, 'cuenta ' || account_id || ' · recibidas contabilizadas: asientos · huella de sus apuntes',
         count(*) || ' · ' || left(md5(string_agg(h, ';' order by id)), 12)
    from v group by account_id
) t order by o, account_id, s, clave;
