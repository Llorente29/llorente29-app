-- scripts/conta/produccion/cuentas/x14e-codigos.sql
--
-- X14 · 2 · El código de cada cliente al traer (conta_cobro_cliente.codigo_cliente) · LO QUE CUENTA LA TANDA, antes y
-- después. SOLO LEE, y solo columnas que existen antes de la tanda. SOLO NÚMEROS Y HUELLAS: ni nombres ni NIF (T11). La
-- 1415 no cambia ningún dato; la 1649 ajusta a ERP10 el 2024 de QBO. conta_cobro_cliente, sin corte (no tiene created_at y su
-- updated_at lo mueven el ajuste y su vuelta atrás): quieta, ver la medida. Las cargas, con su corte fijo (W06).
--   1. Regla 31, por cuenta (regla 9): sus clientes del cobro (cuántos · con código · huella de empresa, cliente y código).
--   2 a 4. X14 · 2 · «Gana ERP10» (la 1649 ajusta el 2024 de QBO): por cuenta y carga de ERP10 en prueba o dada por buena, los terceros
--      traídos cuya cuenta principal no es la de ERP10, los clientes cuyo código no es el de su 430 y las cuentas que no se
--      llaman como en el sumas y saldos de ERP10. Con la tanda, a 0.
--   0. Y la tabla entera, etiquetada como tal (regla 9).
with c as (   -- X14 · 2 · las cargas de ERP10 en prueba o dadas por buenas: de cada cuenta 40/41/43/44 traída, su tercero
  select r.id carga, r.account_id cuenta, r.company_id, r.detail
    from public.import_run r where r.kind = 'carga' and r.program = 'erp10' and r.status in ('en_prueba', 'dada_por_buena') and r.started_at < timestamptz '2026-11-25 17:00:00+01'
), t as (
  select distinct c.carga, c.cuenta, c.company_id, a.id cta, a.code, l.party_id,
         case when a.code ~ '^4[01]' then 'supplier' else 'customer' end entidad,
         case when a.code ~ '^4[01]' then (select pr.supplier_id::text from public.party_role pr where pr.party_id = l.party_id and pr.role = 'supplier' and pr.supplier_id is not null limit 1)
              else l.party_id::text end entidad_id
    from c join public.journal_entry e on e.import_run_id = c.carga and e.source_type = 'migrated'
    join public.journal_line l on l.entry_id = e.id and l.party_id is not null
    join public.company_account a on a.id = l.company_account_id and a.code ~ '^4[0134]' and not a.is_common
)
select clave, valor from (
  select 2 o, 'cuenta ' || t.cuenta || ' · carga ' || t.carga || ' · terceros traídos cuya cuenta principal no es la de ERP10 (de cuántos)' clave,
         count(*) filter (where k.company_account_id is distinct from t.cta) || ' de ' || count(*) valor
    -- quieta: los enlaces principales de una empresa los cambian solo la ficha del tercero (a mano) y esta tanda
    from t left join public.company_account_link k on k.company_id = t.company_id and k.entity = t.entidad and k.entity_id = t.entidad_id and k.role = 'principal'
   where t.entidad_id is not null group by t.cuenta, t.carga
  union all
  select 3, 'cuenta ' || t.cuenta || ' · carga ' || t.carga || ' · clientes traídos cuyo código no es el de su 430 (de cuántos)',
         count(*) filter (where cc.codigo_cliente is distinct from substr(t.code, 4)::int) || ' de ' || count(*)
    -- quieta: el código de un cliente lo cambian solo su ficha del cobro (a mano) y esta tanda
    from t left join public.conta_cobro_cliente cc on cc.company_id = t.company_id and cc.party_id = t.party_id
   where t.code ~ '^430[0-9]{1,5}$' and substr(t.code, 4)::int between 1 and 99999 group by t.cuenta, t.carga
  union all
  select 4, 'cuenta ' || c.cuenta || ' · carga ' || c.carga || ' · cuentas que no se llaman como en el sumas y saldos de ERP10 (de cuántas)',
         count(*) filter (where a.name <> trim(s->>'nombre')) || ' de ' || count(*)
    from c cross join lateral jsonb_array_elements(case when c.detail->>'sumas_de' = 'fichero' then c.detail->'sumas' else '[]' end) s
    -- quieta: el nombre de una cuenta lo cambian solo el plan de cuentas (a mano) y esta tanda
    join public.company_account a on a.company_id = c.company_id and a.code = s->>'cuenta'
   where nullif(trim(s->>'nombre'), '') is not null group by c.cuenta, c.carga
  union all
  select 1, 'tabla entera · cargas de ERP10 en prueba o dadas por buenas (cuántas · ya ajustadas a ERP10)', count(*) || ' · ' || count(*) filter (where c.detail ? 'ajuste_erp10') from c
  union all
  select 0 o, 'tabla entera · clientes del cobro (cuántos · con código · huella)' clave,
         count(*) || ' · ' || count(codigo_cliente) || ' · ' || coalesce(md5(string_agg(concat_ws('|', company_id, party_id, codigo_cliente), ',' order by company_id, party_id)), 'ninguno') valor
    from public.conta_cobro_cliente   -- quieta: solo la escribe el cobro (G05) al editar un cliente a mano, y la tanda; la vuelta atrás la devuelve
   where true
  union all
  select 1, 'cuenta ' || account_id || ' · clientes del cobro (cuántos · con código · huella)',
         count(*) || ' · ' || count(codigo_cliente) || ' · ' || md5(string_agg(concat_ws('|', company_id, party_id, codigo_cliente), ',' order by company_id, party_id))
    from public.conta_cobro_cliente   -- quieta: solo la escribe el cobro (G05) al editar un cliente a mano, y la tanda; la vuelta atrás la devuelve
   where true
   group by account_id
) t order by o, clave;
