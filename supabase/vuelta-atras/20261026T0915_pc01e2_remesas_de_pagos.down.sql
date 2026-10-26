-- supabase/vuelta-atras/20261026T0915_pc01e2_remesas_de_pagos.down.sql
--
-- Vuelta atrás de la 0915 (PC01 · E2), que solo añade: se quita todo lo que
-- crea, en orden inverso. Las tablas se van con sus filas (las remesas
-- preparadas); los pagos ya casados en Bancos NO se tocan: viven en
-- supplier_invoice_payment y bank_match_item, que son del E1, con su asiento.
-- Las columnas iban_previous / iban_changed_* de supplier son del C01b y se
-- quedan; solo se va el disparador que las rellenaba al cambiar la ficha.
-- La columna del sufijo del banco (treasury_account.sepa_suffix) se va con su
-- CHECK: antes de la 0915 no existía (los sufijos puestos se pierden).
-- Se puede pasar dos veces (todo «if exists»).

drop function if exists public.conta_remesas_lista(uuid);
drop function if exists public.conta_remesa_ficha(uuid);
drop function if exists public.conta_pagos_lista(uuid, date);
drop function if exists public.conta_recibidas_poner_vencimiento(uuid, jsonb);
drop function if exists public.conta_remesas_para_casar(uuid);
drop function if exists public.conta_remesa_casar(uuid, uuid, uuid[]);
drop function if exists public.conta_remesa_descargada(uuid, text, integer);
drop function if exists public.conta_remesa_fichero_datos(uuid);
drop function if exists public.conta_remesa_linea_rechazada(uuid, text);
drop function if exists public.conta_remesa_linea_sacar(uuid);
drop function if exists public.conta_remesa_iban_confirmar(uuid);
drop function if exists public._pc01e2_linea(uuid);
drop function if exists public.conta_pago_a_mano(uuid, uuid, uuid, date, numeric);
drop function if exists public.conta_remesa_pagos_crear(uuid, uuid, date, jsonb);
drop function if exists public._pc01e2_iban_como_esta(uuid, text);
drop function if exists public._pc01e2_en_remesa(uuid);
drop function if exists public._pc01e2_cuenta_proveedor(uuid, uuid);
drop function if exists public._pc01e2_codigo(uuid, date);
drop function if exists public._pc01e2_evento(uuid, uuid, uuid, text);
drop function if exists public._pc01e2_iban(text);
drop function if exists public._pc01e2_empresa(uuid);
drop view if exists public.conta_pago_remesa_estado;
drop view if exists public.conta_pago_remesa_linea_estado;
drop table if exists public.conta_pago_remesa_evento;
drop table if exists public.conta_pago_remesa_linea;
drop table if exists public.conta_pago_remesa;
-- El disparador de supplier, al final y solo si está: «drop trigger if exists»
-- coge el cerrojo exclusivo de supplier aunque no exista, y retenido toda la
-- transacción se cruza con quien la esté escribiendo (ensayo 40299056909:
-- deadlock en staging con una e2e).
do $$ begin
  if exists (select 1 from pg_trigger where tgname = 'pc01e2_proveedor_iban_cambiado' and tgrelid = 'public.supplier'::regclass) then
    drop trigger pc01e2_proveedor_iban_cambiado on public.supplier;
  end if;
end $$;
drop function if exists public._pc01e2_proveedor_iban_cambiado();
-- El sufijo del banco, igual: solo si está, para no coger el cerrojo de treasury_account en balde.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'treasury_account' and column_name = 'sepa_suffix') then
    alter table public.treasury_account drop constraint if exists treasury_account_sepa_suffix_check;
    alter table public.treasury_account drop column sepa_suffix;
  end if;
end $$;
