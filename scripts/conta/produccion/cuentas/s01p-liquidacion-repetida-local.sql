-- scripts/conta/produccion/cuentas/s01p-liquidacion-repetida-local.sql
--
-- S01p·21b · LO QUE CUENTA LA TANDA (1914), antes y después. SOLO LEE: el catálogo, y las cuatro liquidaciones
-- de Foodint y sus dos 303 por su id (nada más las escribe; la tanda no toca ningún dato).
select clave, valor from (
  -- quieta: las cuatro liquidaciones de Foodint (4/1016, 9/2, 4/1194, 9/3), por su id: la tanda no las toca
  select 1 o, 'Foodint · las cuatro liquidaciones (validadas · contraasientos)' clave,
    (select count(*) filter (where e.status = 'validado') || ' · ' ||
            (select count(*) from public.journal_entry c where c.reverses_entry_id in ('172a0803-7645-4b89-a085-e5b4d118c9dd', 'a560e7d1-2b0e-40a6-b891-ab308aaf6122', 'b1105ece-f00a-4a21-81ee-506d6e4067cd', '02436d5d-c0e2-4295-8029-651e4f2919c1'))
       from public.journal_entry e
      where e.id in ('172a0803-7645-4b89-a085-e5b4d118c9dd', 'a560e7d1-2b0e-40a6-b891-ab308aaf6122', 'b1105ece-f00a-4a21-81ee-506d6e4067cd', '02436d5d-c0e2-4295-8029-651e4f2919c1')) valor
  union all
  -- quieta: sus dos 303 (1T y 2T de 2026), por su id: la tanda no los enlaza (lo hace «Dejar solo esta»)
  select 2, 'Foodint · 303 del 1T y del 2T (estado · enlazado)',
    (select string_agg(t.period || ' ' || t.status || ' ' || (t.liquidation_entry_id is not null)::text, ', ' order by t.period)
       from public.tax_return t where t.id in ('07d1c618-4d0e-4935-b77d-a7d583a1f441', '32d5a3d4-9e35-4aca-8dff-09ead6dba24e'))
  union all
  select 3, 'conta_liquidacion_dejar_esta marca como comunes los apuntes sin local (antes 0, después 1)',
    (strpos(pg_get_functiondef('public.conta_liquidacion_dejar_esta(uuid,uuid,text)'::regprocedure), 'S01p·21b') > 0)::int::text
) t order by o;
