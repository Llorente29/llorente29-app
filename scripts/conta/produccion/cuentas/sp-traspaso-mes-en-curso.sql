-- scripts/conta/produccion/cuentas/sp-traspaso-mes-en-curso.sql
--
-- SP · LO QUE CUENTA LA TANDA (1954), antes y después. SOLO LEE: el catálogo, y los traspasos de Foodint
-- (la tanda no toca ninguno).
select clave, valor from (
  -- quieta: los traspasos de Foodint, por mes y estado
  select 1 o, 'Foodint · traspasos (mes:estado)' clave,
    (select coalesce(string_agg(to_char(mes, 'YYYY-MM') || ':' || estado, ', ' order by mes), '—')
       from public.conta_diez_traspaso where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') valor
  union all
  select 2, 'conta_traspaso_confirmar admite el mes en curso (antes 0, después 1)',
    (strpos(pg_get_functiondef('public.conta_traspaso_confirmar(uuid,date)'::regprocedure), 'SP·traspaso (15/11)') > 0)::int::text
  union all
  select 3, 'conta_traspaso_terminar no cierra el mes en curso (antes 0, después 1)',
    (strpos(pg_get_functiondef('public.conta_traspaso_terminar(uuid,jsonb,boolean)'::regprocedure), 'SP·traspaso (15/11)') > 0)::int::text
) t order by o;
