-- R07 · la vuelta atrás de 0900: las cinco funciones vuelven, byte a byte, a como estaban (del respaldo que dejó la 0900);
-- se quitan el disparador, las funciones nuevas, el enlace y la columna «desde»; y el origen «sales_day_payment»,
-- solo si ningún asiento lo usa (si alguno lo usa, para: esos cobros del día tienen que deshacerse antes).
do $$ begin
  if exists (select 1 from public.journal_entry where source_type = 'sales_day_payment') then
    raise exception 'Vuelta atrás de la 0900 PARADA: hay cobros del día (sales_day_payment) en el diario; anúlalos o quítalos antes.';
  end if;
end $$;
select public._restaurar_funcion('public._conta_tpv_propuesta(uuid)', '20261120T0900_r07_factura_y_cobro_del_dia');
select public._restaurar_funcion('public.conta_tpv_dia_para_validar(uuid)', '20261120T0900_r07_factura_y_cobro_del_dia');
select public._restaurar_funcion('public.conta_tpv_dia_validar(uuid,uuid,integer,text,text,text,integer,text)', '20261120T0900_r07_factura_y_cobro_del_dia');
select public._restaurar_funcion('public.conta_proponer_dias(uuid,timestamptz,text)', '20261120T0900_r07_factura_y_cobro_del_dia');
select public._restaurar_funcion('public.conta_erp10_dias_tpv_por_salir(uuid,date)', '20261120T0900_r07_factura_y_cobro_del_dia');
drop trigger if exists trg_journal_entry_dia_cobro_junto on public.journal_entry;
drop function if exists public._conta_dia_cobro_junto();
drop function if exists public._conta_dia_proponer(uuid, jsonb, text);
drop function if exists public._conta_dia_partir(jsonb, text);
drop function if exists public._conta_dia_concepto(text, text);
drop function if exists public.conta_tpv_factura_de(uuid);
drop function if exists public.conta_tpv_factura_guardar(uuid, text, text);
drop table if exists public.conta_dia_cobro;
alter table public.conta_tpv_factura_cuenta drop column if exists desde;
alter table public.journal_entry drop constraint journal_entry_source_type_check;
alter table public.journal_entry add constraint journal_entry_source_type_check check (source_type = any (array['sales_day', 'sales_adjustment', 'supplier_invoice',
  'supplier_payment', 'channel_settlement', 'licensed_settlement', 'payroll', 'bank', 'vat_settlement', 'manual', 'template', 'reversal', 'opening', 'closing',
  'migrated', 'purchase_accrual', 'purchase_accrual_reversal', 'customer_invoice', 'customer_payment']));
