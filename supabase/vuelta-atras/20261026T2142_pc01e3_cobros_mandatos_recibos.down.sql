-- supabase/vuelta-atras/20261026T2142_pc01e3_cobros_mandatos_recibos.down.sql
--
-- Vuelta atrás de la 2142 (PC01 · E3), que solo añade: se quita todo lo que
-- crea, en orden inverso. Las tablas se van con sus filas (mandatos y remesas
-- de recibos). Lo que ya está en otras tablas se queda, porque es correcto con
-- o sin la 2142:
--   · los casados del banco y sus asientos (bank_match, journal_entry), y los
--     cobros que apuntaron (customer_invoice_payment, del E1), también el cobro
--     en negativo de un recibo devuelto: se deshacen en Bancos, como cualquier casado;
--   · la ficha de un cliente que firmó un mandato (customer_fiscal: IBAN,
--     referencia, fecha y «domiciliación»), que ya admitía un mandato en papel.
-- Se puede pasar dos veces (todo «if exists»).

drop function if exists public.conta_mandato_firmar(text, text, text, text, boolean);
drop function if exists public.conta_mandato_para_firmar(text);
drop function if exists public.conta_mandato_enviado(uuid, text);
drop function if exists public.conta_mandato_preparar(uuid, uuid, text);
drop function if exists public.conta_remesa_cobros_ficha(uuid);
drop function if exists public.conta_remesas_cobros_lista(uuid);
drop function if exists public.conta_cobros_para_casar(uuid);
drop function if exists public.conta_recibo_devuelto(uuid, uuid, text);
drop function if exists public.conta_remesa_cobros_casar(uuid, uuid, uuid[]);
drop function if exists public.conta_remesa_cobros_descargada(uuid, text, integer);
drop function if exists public.conta_remesa_cobros_fichero_datos(uuid);
drop function if exists public.conta_remesa_cobros_linea_sacar(uuid);
drop function if exists public.conta_remesa_cobros_crear(uuid, uuid, date, jsonb);
drop function if exists public.conta_cobros_lista(uuid, date);
drop function if exists public._pc01e3_mandato(uuid);
drop function if exists public._pc01e3_identificador_acreedor(text, text);
drop function if exists public._pc01e3_en_remesa(uuid);
drop function if exists public._pc01e3_forma(uuid);
drop function if exists public._pc01e3_cuenta_gastos(uuid);
drop function if exists public._pc01e3_cuenta_cliente(uuid, uuid);
drop function if exists public._pc01e3_ref_mandato(uuid);
drop function if exists public._pc01e3_codigo(uuid, date);
drop function if exists public._pc01e3_evento(uuid, uuid, uuid, text);
drop function if exists public._pc01e3_empresa(uuid);
drop view if exists public.conta_cobro_remesa_estado;
drop view if exists public.conta_cobro_remesa_linea_estado;
drop table if exists public.conta_cobro_remesa_evento;
drop table if exists public.conta_cobro_remesa_linea;
drop table if exists public.conta_cobro_remesa;
drop table if exists public.conta_mandato;
