-- scripts/conta/produccion/cuentas/gb-sin-titulo.sql
--
-- GB · nº 29, 2 · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. La misma
-- vara a los dos lados (regla 31). Lo que tiene que pasar:
--   1. La función ya sabe de «Sin título»: false → true.
--   2. Los clientes del CRM NO cambian (la migración no llama a nada).
select clave, valor from (
  select 1 o, 'conta_portal_quien_lleva sin «Sin título»' clave,
    coalesce((select position('untitled' in prosrc) > 0 from pg_proc where oid = to_regprocedure('public.conta_portal_quien_lleva(uuid)')), false)::text valor union all
  select 2, 'Clientes del CRM (tabla entera, todas las cuentas, con corte de fecha)',
    (select count(*) from public.conta_gestoria_cliente where created_at < timestamptz '2026-11-10 12:00:00+00')::text
) q order by o;
