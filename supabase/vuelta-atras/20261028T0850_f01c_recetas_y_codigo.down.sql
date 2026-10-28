-- supabase/vuelta-atras/20261028T0850_f01c_recetas_y_codigo.down.sql
--
-- Vuelta atrás de la 0850 (F01 · PR 3), que solo añade: se quitan sus funciones
-- y sus dos tablas, en orden inverso. Va DETRÁS de la de la 0851 (el disparador
-- y la pasada usan funciones de aquí).
-- PARA si alguien ya ha decidido algo en Marcas › Revisar («Sí, es…» o «No, es
-- otra marca»): son decisiones de una persona con su apunte; antes se decide
-- qué hacer con ellas. Lo hecho en tablas que existían (marcas unidas, platos
-- con su artículo, ventas colocadas) se queda: es verdad con o sin la 0850.

do $$
begin
  if to_regclass('public.f01_marca_reconocida') is not null
     and exists (select 1 from public.f01_marca_reconocida where como in ('confirmada', 'otra')) then
    raise exception 'F01c: hay % decisiones de «Revisar marca» con su apunte: no se quita la 0850 sin decidir antes qué pasa con ellas.',
      (select count(*) from public.f01_marca_reconocida where como in ('confirmada', 'otra'));
  end if;
end $$;

drop function if exists public.f01_aviso_visto(uuid, uuid);
drop function if exists public.f01_decidir_marca(uuid, uuid, text, uuid, boolean);
drop function if exists public.f01_marcas_por_revisar(uuid);
drop function if exists public._f01c_reconocer_solas(uuid);
drop function if exists public._f01c_unir(uuid, uuid, text, uuid, text, jsonb, uuid, text);
drop function if exists public._f01c_candidatas(uuid);
drop function if exists public._f01c_ventas_esperando(uuid, uuid, text);
drop function if exists public._f01c_comparar(uuid, uuid, text);
drop function if exists public.f01_destino_lectura(uuid, uuid, uuid);
drop function if exists public.f01_preparar_receta(uuid, uuid);
drop function if exists public._f01c_preparar(uuid, uuid);
drop function if exists public.f01_carta_marca(uuid, uuid);
drop function if exists public.f01_colocar_recetas(uuid, uuid);
drop function if exists public._f01c_colocar_recetas(uuid, integer);
drop function if exists public._f01c_receta_puesta();
drop table if exists public.f01_marca_reconocida;
drop table if exists public.f01_receta_puesta;
