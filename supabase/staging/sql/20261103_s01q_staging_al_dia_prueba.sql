-- supabase/staging/sql/20261103_s01q_staging_al_dia_prueba.sql
--
-- SOLO STAGING. Prueba del S01q·10 · staging al día con lo de la S01 (las 0830,
-- 0849, 0905, 0929 y 1025, que producción tiene y staging no). Todo en una
-- transacción con ROLLBACK. No crea datos.
--   1. Las 25 funciones, con la misma huella (md5 de su definición) que en
--      producción el 03/11: staging queda igual que producción.
--   2. Sus disparadores (al leer una liquidación, la de un socio y la de los
--      pedidos) y su cron de noche, puestos.
--   3. Se pueden pasar otra vez (como hará main al fusionar): las cinco, dos veces.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01q·10 staging al día: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';
-- sin usuario: solo mira definiciones; no hay nada que leer como usuario.

\i supabase/migrations/20261028T0830_s01_propuestas_recibido.sql
\i supabase/migrations/20261028T0849_s01_propuestas_pagado_despues.sql
\i supabase/migrations/20261028T0905_s01_propuestas_socio.sql
\i supabase/migrations/20261028T0929_s01_propuestas_plataforma.sql
\i supabase/migrations/20261028T1025_s01_pasada_de_noche.sql

-- 1 · La misma huella que en producción.
do $$
declare v_mal text;
begin
  select string_agg(format('%s (%s)', f, coalesce(md5(pg_get_functiondef(to_regprocedure(f))), 'no está')), '; ') into v_mal
    from (values
    ('public._conta_aprendizaje(uuid,text,jsonb,jsonb)', '9885dcac55f28706a12ab11e586557fa'),
    ('public._conta_cuotas_y_redondeo(jsonb,numeric)', '7dd5927a6c38e6735fd17de34672a310'),
    ('public._conta_enlace(uuid,text,text,text)', '87f95f5c121a56b7088ce4e871915b35'),
    ('public._conta_hoja(uuid,text)', '3c7b4957d180f1a6e5e72416fa66ac7c'),
    ('public._conta_plataforma_entrada(uuid,uuid)', '3b0f4b41c7b5b278ca2906671451fdd4'),
    ('public._conta_plataforma_regla(jsonb,jsonb)', '20e4e585be35e54e93dddfae5f96fce9'),
    ('public._conta_proponer_plataforma(uuid,uuid,text)', '9a1ccdb292c515cbda162fa0d2b6eb43'),
    ('public._conta_proponer_socio(uuid,uuid,text)', 'dfee44024a7bc968c4101a87dbade348'),
    ('public._conta_propuesta_ventas(uuid,uuid,date,uuid,uuid,uuid)', '01bc0116714249a80903c288410ee647'),
    ('public._conta_tipo_iva(uuid,numeric)', '3fd3884ab077280017704baff6c451a5'),
    ('public.conta_aprendizaje(uuid,text,text[])', 'b4c423397c2e8989955e0028644ec78b'),
    ('public.conta_proponer_pagados_despues(uuid,text)', '1c4e51faa4ec57ce44ad5d103c587110'),
    ('public.conta_proponer_plataformas(uuid,date,date,text)', '7bf7f543b1107a2be27701aeb4968d3c'),
    ('public.conta_proponer_recibidos(uuid,date,date,text)', 'b68bfe39933859e614686dfa59070c5f'),
    ('public.conta_proponer_socios(uuid,date,date,text)', 'db1fe7d5bdee5a616888a801888e394e'),
    ('public.conta_propuesta_pagado_despues(uuid,jsonb)', '6fe03a4c3d63d6dfcc31b81a829b1765'),
    ('public.conta_propuesta_ventas_unidad(uuid,uuid,date,uuid,uuid)', 'e9719518a0a1300528b14b9a18d0b1d6'),
    ('public.conta_propuestas_de_noche_todas()', 'f21a3652badc2e2e6e6690d0dfd329e6'),
    ('public.conta_propuestas_de_noche(uuid)', 'a48152e48da0dd1e268e9bdc2c213d98'),
    ('public.conta_propuestas_plataforma(uuid,uuid)', '0d156124086a20605d5eb7e4a478dfb3'),
    ('public.conta_propuestas_recibido(uuid)', '29bc2040ab9641da85d28bdf26a66c40'),
    ('public.conta_propuestas_socio(uuid,uuid)', 'b716120913963dca46f9bda310a24fcc'),
    ('public.tg_conta_liquidacion_pedidos_proponer()', 'eb9ea02fbdb84ec2a6bb3c7f47e829cc'),
    ('public.tg_conta_plataforma_proponer()', '7110afd4d019d5b34f124ba80ba2df27'),
    ('public.tg_conta_socio_proponer()', '3de450d388d934b0cdf7e4617eb18c99')) p(f, huella)
   where to_regprocedure(f) is null or md5(pg_get_functiondef(to_regprocedure(f))) <> huella;
  if v_mal is not null then
    raise exception 'PRUEBA S01q·10 · 1: estas funciones no son las de producción: %', v_mal;
  end if;
  raise notice 'PRUEBA S01q·10 · 1: las 25 funciones, con la huella de producción.';
end $$;

-- 2 · Sus disparadores y su cron.
do $$
declare v_mal text;
begin
  select string_agg(t, ', ') into v_mal from (values ('conta_plataforma_proponer'), ('conta_socio_proponer'), ('conta_liquidacion_pedidos_proponer_al_entrar'), ('conta_liquidacion_pedidos_proponer_al_casar')) d(t)
   where not exists (select 1 from pg_trigger g where g.tgname = d.t and not g.tgisinternal);
  if v_mal is not null then raise exception 'PRUEBA S01q·10 · 2: faltan los disparadores %.', v_mal; end if;
  if not exists (select 1 from cron.job where jobname = 'conta-propuestas-de-noche') then
    raise exception 'PRUEBA S01q·10 · 2: falta el cron de la pasada de noche.';
  end if;
  raise notice 'PRUEBA S01q·10 · 2: sus cuatro disparadores y el cron de la pasada de noche, puestos.';
end $$;

-- 3 · Otra vez (main las pasará al fusionar).
\i supabase/migrations/20261028T0830_s01_propuestas_recibido.sql
\i supabase/migrations/20261028T0849_s01_propuestas_pagado_despues.sql
\i supabase/migrations/20261028T0905_s01_propuestas_socio.sql
\i supabase/migrations/20261028T0929_s01_propuestas_plataforma.sql
\i supabase/migrations/20261028T1025_s01_pasada_de_noche.sql
do $$ begin raise notice 'PRUEBA S01q·10 · 3: las cinco se pueden pasar dos veces.'; end $$;

rollback;
