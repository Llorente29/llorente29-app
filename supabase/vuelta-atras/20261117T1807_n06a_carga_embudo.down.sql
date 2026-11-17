-- supabase/vuelta-atras/20261117T1807_n06a_carga_embudo.down.sql
--
-- N06a · la vuelta atrás de lo que cambia: las cinco funciones desde su respaldo y el CHECK de
-- import_run.kind sin «carga». Si ya hay alguna carga, para: primero se deshacen (o se quedan, y
-- entonces no hay vuelta atrás de esta pieza).
do $$ begin
  if exists (select 1 from public.import_run where kind = 'carga') then
    raise exception 'N06a: hay cargas de otro programa en la base; la vuelta atrás del embudo no se hace con ellas dentro.';
  end if;
end $$;
select public._restaurar_funcion('public.customer_invoice_inalterable()', '20261117T1807_n06a_carga_embudo');
select public._restaurar_funcion('public.tg_s01o2_iva_no_deducible()', '20261117T1807_n06a_carga_embudo');
select public._restaurar_funcion('public._conta_facturas_apuntar(uuid)', '20261117T1807_n06a_carga_embudo');
select public._restaurar_funcion('public.conta_motivos_para_validar(uuid)', '20261117T1807_n06a_carga_embudo');
select public._restaurar_funcion('public._journal_entry_proponer(uuid,jsonb,jsonb,jsonb,text,uuid)', '20261117T1807_n06a_carga_embudo');
alter table public.import_run drop constraint if exists import_run_kind_check;
alter table public.import_run add constraint import_run_kind_check check (kind = any (array[
  'historico', 'al_dia', 'documentos', 'sumas_saldos', 'plan_cuentas', 'terceros', 'inmovilizado', 'diario', 'recibidas',
  'emitidas', 'declaraciones']));
