-- scripts/conta/produccion/cuentas/n6-puerta-v1.sql
--
-- N6 (24/10) · LO QUE CUENTA LA TANDA DE LA PUERTA V1, antes y después. SOLO
-- LEE, y solo el catálogo: cuántas funciones fuente_* hay. No toca datos de
-- ninguna cuenta (regla 9: no hay cifra de nadie).
--
-- Después del real: 10 funciones fuente_* (8 de la puerta y 2 de apoyo).
select clave, valor from (
  select 1 o, 'funciones fuente_*' clave,
         (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'fuente\_%')::text valor union all
  select 2, 'funciones fuente_*_v1',
         (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'fuente\_%\_v1')::text
) t order by o;
