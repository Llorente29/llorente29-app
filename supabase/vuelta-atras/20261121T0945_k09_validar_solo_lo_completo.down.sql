-- K09 · vuelta atrás de 20261121T0945: conta_motivos_para_validar desde su respaldo (sin los motivos de
-- la factura) y fuera las funciones nuevas. La tabla de «No es la misma» solo se quita si está vacía: si
-- ya guardó alguna, es el historial de por qué se validó (y lo dice también supplier_invoice_change).
select public._restaurar_funcion('public.conta_motivos_para_validar(uuid)', '20261121T0945_k09_validar_solo_lo_completo');
drop function if exists public.conta_recibida_motivos(uuid, uuid);
drop function if exists public.conta_recibida_no_es_la_misma(uuid, uuid, text, text);
drop function if exists public.conta_recibida_repetida(uuid);
drop function if exists public._conta_numero_clave(text);
do $$
begin
  if to_regclass('public.supplier_invoice_no_es_la_misma') is not null
     and not exists (select 1 from public.supplier_invoice_no_es_la_misma) then
    drop table public.supplier_invoice_no_es_la_misma;
  end if;
end $$;
do $$
begin
  if not exists (select 1 from public.supplier_invoice_change where what = 'no_es_la_misma') then
    alter table public.supplier_invoice_change drop constraint if exists supplier_invoice_change_what_check;
    alter table public.supplier_invoice_change add constraint supplier_invoice_change_what_check
      check (what = any (array['guardar', 'papel', 'sin_papel']));
  end if;
end $$;
