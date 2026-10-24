-- scripts/conta/produccion/cuentas/n6-puerta-v1.sql
--
-- N6 (24/10) · LO QUE CUENTA LA TANDA DE LA PUERTA V1, antes y después. SOLO
-- LEE, y solo el catálogo: cuántas de sus funciones hay, por su nombre (así no
-- le afecta la fuente_nominas_mes_v1 del N7). No toca datos de ninguna cuenta
-- (regla 9: no hay cifra de nadie).
--
-- Después del real: 7 funciones (5 de la puerta y 2 de apoyo), y 0 fuentes de
-- liquidaciones (son de Sumied: Julio, 24/10).
select clave, valor from (
  select 1 o, 'funciones de la puerta v1 (5 + 2 de apoyo)' clave,
         (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
           and proname in ('fuente__cuenta', 'fuente__locales', 'fuente_recepciones_v1', 'fuente_recepcion_lineas_v1',
                           'fuente_ventas_dia_v1', 'fuente_pedidos_v1', 'fuente_productos_v1'))::text valor union all
  select 2, 'fuentes de liquidaciones (tienen que ser 0)',
         (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
           and proname in ('fuente_liquidaciones_plataforma_v1', 'fuente_liquidacion_pedidos_v1', 'fuente_licencias_mes_v1'))::text
) t order by o;
