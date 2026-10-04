-- ============================================================================
-- SOLO STAGING-CONTA · R02 · PRUEBA DE LAS VUELTAS ATRÁS (TODAS)
-- ----------------------------------------------------------------------------
-- Encargo §8: «vuelta atrás probada en staging para cada fichero que toque
-- tablas de Cocina». Con TODO el R02 aplicado (0100–0140, saneado 0210 y
-- eliminación 0200), se aplican las vueltas atrás en el orden en que se
-- harían en producción, y se comprueba cada una:
--   0210 → los dos pedidos saneados vuelven a su modalidad y su alarma
--   0200 → vuelve brand.own_delivery_enabled con sus valores y
--          marca_reparte_propio idéntica a la de producción (md5)
--   0140, 0130 → fuera las funciones nuevas
--   0120 → las cinco funciones idénticas a las de producción del 04/10 (md5)
--   0110 → fuera las filas migradas
--   0100 → fuera la tabla y la resolución
-- Y las guardas: cada una tiene que PARAR cuando toca (se prueban antes, con
-- el estado que las hace saltar). Todo en una transacción que acaba en
-- ROLLBACK: staging queda con el R02 aplicado.
-- ============================================================================
\set ON_ERROR_STOP 1
begin;

-- ── Guardas que tienen que parar ───────────────────────────────────────────
-- 0120 con la columna ya quitada (la 0200 está aplicada): tiene que parar.
\set ON_ERROR_STOP 0
savepoint g0120;
\ir ../../vuelta-atras/20261005T0120_r02_lectores_de_la_resolucion.down.guarda.sql
rollback to savepoint g0120;
\set ON_ERROR_STOP 1
select (:'LAST_ERROR_MESSAGE' like 'VUELTA ATRÁS 0120 (R02): brand.own_delivery_enabled no existe%') as guarda_0120_ok \gset
\if :guarda_0120_ok
  \echo 'Guarda 0120: para si la columna no está. OK'
\else
  do $$ begin raise exception 'PRUEBA: la guarda de la 0120 NO ha parado sin la columna.'; end $$;
\endif

-- 0110 con resolve_dispatch todavía del R02: tiene que parar.
\set ON_ERROR_STOP 0
savepoint g0110;
\ir ../../vuelta-atras/20261005T0110_r02_filas_migradas.down.guarda.sql
rollback to savepoint g0110;
\set ON_ERROR_STOP 1
select (:'LAST_ERROR_MESSAGE' like 'VUELTA ATRÁS 0110 (R02): resolve_dispatch todavía es el del R02%') as guarda_0110_ok \gset
\if :guarda_0110_ok
  \echo 'Guarda 0110: para si los lectores siguen siendo los del R02. OK'
\else
  do $$ begin raise exception 'PRUEBA: la guarda de la 0110 NO ha parado.'; end $$;
\endif

-- 0100 con una celda decidida por una persona: tiene que parar.
savepoint g0100;
insert into public.brand_delivery_policy (account_id, brand_id, channel_slug, delivery_by, source)
values ('c01a0000-0000-4000-8000-00000000000a', 'e0200000-0000-4000-8000-00000000a0b1', 'deliveroo', 'own', 'manual');
\set ON_ERROR_STOP 0
\ir ../../vuelta-atras/20261005T0100_r02_brand_delivery_policy.down.guarda.sql
\set ON_ERROR_STOP 1
rollback to savepoint g0100;
select (:'LAST_ERROR_MESSAGE' like 'VUELTA ATRÁS 0100 (R02): hay % celdas decididas%') as guarda_0100_ok \gset
\if :guarda_0100_ok
  \echo 'Guarda 0100: para si hay decisiones de personas. OK'
\else
  do $$ begin raise exception 'PRUEBA: la guarda de la 0100 NO ha parado con una celda manual.'; end $$;
\endif

-- ── Las vueltas atrás, en orden ────────────────────────────────────────────
\echo '== 0210 · saneado'
\ir ../../vuelta-atras/20261005T0210_r02_saneado_pedidos_abiertos.down.sql
select platform_order_code, service_type, delivery_alarm_kind,
       (service_type = 'own_delivery' and delivery_alarm_kind = 'no_despachado' and dispatch_error is not null) as como_antes
  from public.sale where id in ('e0200000-0000-4000-8000-0000000052a1', 'e0200000-0000-4000-8000-0000000052a2')
 order by platform_order_code;
do $$ begin
  if (select count(*) from public.sale
       where id in ('e0200000-0000-4000-8000-0000000052a1', 'e0200000-0000-4000-8000-0000000052a2')
         and service_type = 'own_delivery' and delivery_alarm_kind = 'no_despachado' and dispatch_error is not null) <> 2 then
    raise exception 'PRUEBA: la vuelta atrás del saneado no ha devuelto los dos pedidos como estaban.';
  end if;
end $$;

\echo '== 0200 · interruptor antiguo'
\ir ../../vuelta-atras/20261005T0200_r02_elimina_interruptor_antiguo.down.sql
do $$ begin
  if (select string_agg(name || '=' || own_delivery_enabled, ', ' order by name) from public.brand
       where id in ('e0200000-0000-4000-8000-00000000a0b3', 'e0200000-0000-4000-8000-00000000a0b4'))
     is distinct from 'Lovers de Prueba=false, Smash de Prueba=false' then
    raise exception 'PRUEBA: el interruptor no ha vuelto con sus valores.';
  end if;
  if (select md5(prosrc) from pg_proc where proname = 'marca_reparte_propio') <> '64c4d85ea2feb564e333918c981e2d0e' then
    raise exception 'PRUEBA: marca_reparte_propio no es la de producción.';
  end if;
end $$;

\echo '== 0140 y 0130 · funciones nuevas'
\ir ../../vuelta-atras/20261005T0140_r02_sugerencia_ia.down.sql
\ir ../../vuelta-atras/20261005T0130_r02_guardar_celdas.down.sql

\echo '== 0120 · los cinco lectores, como en producción'
\ir ../../vuelta-atras/20261005T0120_r02_lectores_de_la_resolucion.down.sql
select p.proname, md5(p.prosrc) = v.md5 as igual_que_produccion
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  join (values ('brand_price_grid', '3c784cdcf31dfa81e1c6c34be86a71bc'),
               ('dispatch_watchdog_scan', 'f37ee45fcd26e5c0061d9743c85bb8b1'),
               ('metrica_direcciones_de_reparto', '340b17c6da556291e6631bac36a61279'),
               ('resolve_dispatch', 'b965d8d7ab81012198db34a618736292'),
               ('tg_sale_service_type_por_interruptor', 'acf6fdab742eb0688ba25eaa58167c84')) v(proname, md5)
    on v.proname = p.proname
 order by 1;
do $$ begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
       join (values ('brand_price_grid', '3c784cdcf31dfa81e1c6c34be86a71bc'),
                    ('dispatch_watchdog_scan', 'f37ee45fcd26e5c0061d9743c85bb8b1'),
                    ('metrica_direcciones_de_reparto', '340b17c6da556291e6631bac36a61279'),
                    ('resolve_dispatch', 'b965d8d7ab81012198db34a618736292'),
                    ('tg_sale_service_type_por_interruptor', 'acf6fdab742eb0688ba25eaa58167c84')) v(proname, md5)
         on v.proname = p.proname and md5(p.prosrc) = v.md5) <> 5 then
    raise exception 'PRUEBA: algún lector no ha vuelto idéntico al de producción.';
  end if;
end $$;

\echo '== 0110 · filas migradas'
\ir ../../vuelta-atras/20261005T0110_r02_filas_migradas.down.sql
\echo '== 0100 · tabla y resolución'
\ir ../../vuelta-atras/20261005T0100_r02_brand_delivery_policy.down.sql
do $$ begin
  if to_regclass('public.brand_delivery_policy') is not null
     or exists (select 1 from pg_proc where proname = 'resolve_delivery_by') then
    raise exception 'PRUEBA: la vuelta atrás de la 0100 no ha quitado la tabla o la resolución.';
  end if;
end $$;

\echo 'R02 · todas las vueltas atrás hacen lo que dicen y sus guardas paran cuando toca. ROLLBACK.'
rollback;
