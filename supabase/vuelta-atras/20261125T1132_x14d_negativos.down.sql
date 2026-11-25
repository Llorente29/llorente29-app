-- supabase/vuelta-atras/20261125T1132_x14d_negativos.down.sql
-- X14 · 2 · Devuelve journal_line a «un lado, en positivo» y las seis funciones a sus respaldos. Las restricciones de antes
-- solo vuelven si no hay ninguna línea en negativo: con alguna (lo traído de ERP10 en negativo, o un asiento a mano), para
-- y lo dice. Esas se quitan antes deshaciendo la carga o anulando el asiento.
do $$
declare v_n int; v_e int;
begin
  select count(*), count(distinct entry_id) into v_n, v_e from public.journal_line where debit < 0 or credit < 0;
  if v_n > 0 then
    raise exception 'No se puede volver atrás: hay % en negativo (en % asientos). Deshaz la carga que las trajo, o anula esos asientos, antes.',
      case when v_n = 1 then '1 línea' else v_n || ' líneas' end, v_e using errcode = '23514';
  end if;
end $$;
select public._restaurar_funcion('public.conta_apunte_pago_modelo(uuid,integer,text,text)', '20261125T1132_x14d_negativos');
select public._restaurar_funcion('public._s01p_nomina_retencion_poner(uuid,text,numeric)', '20261125T1132_x14d_negativos');
select public._restaurar_funcion('public.conta_cierre_validar(uuid,integer,text,text,text,text,integer,text)', '20261125T1132_x14d_negativos');
select public._restaurar_funcion('public.conta_motivos_para_validar(uuid)', '20261125T1132_x14d_negativos');
select public._restaurar_funcion('public.conta_asiento_modificar(uuid,jsonb,jsonb,text)', '20261125T1132_x14d_negativos');
select public._restaurar_funcion('public._conta_traer_seguir(uuid,timestamp with time zone)', '20261125T1132_x14d_negativos');
alter table public.journal_line drop constraint journal_line_debe_o_haber;
alter table public.journal_line add constraint journal_line_debe_o_haber check ((debit > 0) <> (credit > 0));
alter table public.journal_line add constraint journal_line_debit_check check (debit >= 0);
alter table public.journal_line add constraint journal_line_credit_check check (credit >= 0);
