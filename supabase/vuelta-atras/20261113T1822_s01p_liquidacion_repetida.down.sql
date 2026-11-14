-- supabase/vuelta-atras/20261113T1822_s01p_liquidacion_repetida.down.sql
--
-- S01p·21 · la vuelta atrás: las cuatro funciones desde su respaldo y fuera las dos nuevas.
-- La tabla se queda si ya tiene filas (son decisiones con su contraasiento validado, que no se
-- borra: se anula desde el diario); si está vacía, se quita.
select public._restaurar_funcion('public.conta_motivos_para_validar(uuid)', '20261113T1822_s01p_liquidacion_repetida');
select public._restaurar_funcion('public.conta_impuesto_303_calcular(uuid,integer,text)', '20261113T1822_s01p_liquidacion_repetida');
select public._restaurar_funcion('public.conta_impuesto_303_contabilizar(uuid)', '20261113T1822_s01p_liquidacion_repetida');
select public._restaurar_funcion('public.conta_cierre_bloque_iva(uuid,date)', '20261113T1822_s01p_liquidacion_repetida');
drop function if exists public.conta_liquidacion_dejar_esta(uuid, uuid, text);
drop function if exists public.conta_liquidaciones_repetidas(uuid);
do $$ begin
  if not exists (select 1 from public.conta_liquidacion_repetida) then
    drop table public.conta_liquidacion_repetida;
  end if;
end $$;
