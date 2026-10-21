-- scripts/conta/produccion/cuentas/p01-390-sin-sii.sql
--
-- P01 · LO QUE CUENTA LA TANDA DE LA 0380 (quien lleva el SII no presenta el
-- 390), antes y después. SOLO LEE.
--
-- Lo que tiene que pasar: conta_impuesto_reglas cambia de cuerpo (una firma);
-- las empresas con el SII y los modelos 390 vivos, IGUAL antes y después: la
-- regla solo lee, y los modelos de una empresa se recalculan cuando alguien
-- los recalcula (medido el 21/10: ninguna empresa con el SII). Todas las
-- cuentas: es una regla de la base, no un dato de una (regla 9, tabla entera).
select clave, valor from (
  select 1 o, 'conta_impuesto_reglas (firmas · md5 del cuerpo)' clave,
    (select count(*) || ' · ' || coalesce(string_agg(md5(prosrc), ' ' order by oid), '-')
       from pg_proc where pronamespace = 'public'::regnamespace and proname = 'conta_impuesto_reglas') valor union all
  select 2, 'empresas con el SII (todas las cuentas)',
    (select count(*)::text from public.company_tax_profile where coalesce(sii, false)) union all
  select 3, 'modelos 390 vivos de empresas con el SII (todas las cuentas)',
    (select count(*)::text from public.tax_obligation o join public.company_tax_profile p on p.company_id = o.company_id
      where o.form_code = '390' and o.active and coalesce(p.sii, false)) union all
  select 4, 'modelos 390 vivos (todas las cuentas)',
    (select count(*)::text from public.tax_obligation where form_code = '390' and active)
) x order by o;
