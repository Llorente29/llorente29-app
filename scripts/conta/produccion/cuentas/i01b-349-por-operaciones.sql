-- scripts/conta/produccion/cuentas/i01b-349-por-operaciones.sql
--
-- I01b · LO QUE CUENTA LA TANDA DEL 349 POR OPERACIONES (0250), antes y después.
-- SOLO LEE. Recuentos de Foodint (regla 9) y huellas de definiciones.
--
-- Lo que tiene que pasar: la huella de conta_impuesto_reglas, otra;
-- conta_paises_ue, de «no existe» a «existe». Y lo de Foodint, IGUAL antes y
-- después: sus obligaciones vigentes por modelo (la tanda no recalcula nada).
select clave, valor from (
  select 1 o, 'huella de conta_impuesto_reglas' clave,
    coalesce((select left(md5(pg_get_functiondef(p.oid)), 16) from pg_proc p where p.oid = to_regprocedure('public.conta_impuesto_reglas(uuid)')), 'no existe') valor union all
  select 2, 'conta_paises_ue',
    case when to_regprocedure('public.conta_paises_ue()') is null then 'no existe' else 'existe' end union all
  select 3, 'obligaciones vigentes de Foodint (modelo:presenta)',
    (select coalesce(string_agg(form_code || ':' || active, ' · ' order by form_code), 'ninguna') from public.tax_obligation
      where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and valid_to is null)
) t order by o;
