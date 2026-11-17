-- supabase/vuelta-atras/20261117T1656_n05c_sin_historico_validar.down.sql
--
-- N05c · la vuelta atrás de lo que cambia: conta_motivos_para_validar desde su respaldo (vuelve a
-- parar con «falta_historico» para todo, con el texto de antes).
select public._restaurar_funcion('public.conta_motivos_para_validar(uuid)', '20261117T1656_n05c_sin_historico_validar');
