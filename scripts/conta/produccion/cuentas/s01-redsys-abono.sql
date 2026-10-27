-- scripts/conta/produccion/cuentas/s01-redsys-abono.sql
--
-- S01 · PR 1 (27/10) · LO QUE CUENTA LA TANDA DE REDSYS Y DEL ABONO CASADO
-- (2030 y 2031), antes y después. SOLO LEE.
--   · La 2030 solo añade: antes de la tanda y después de deshacerla, sus tres
--     tablas, sus cuatro columnas y sus funciones «no existe» o 0; con ella,
--     todo existe y las tablas nacen vacías.
--   · La 2031 cambia cuatro funciones con la misma firma: la huella (md5 del
--     cuerpo) cambia con la tanda y vuelve a la de antes al deshacerla
--     (conta_enlace_pago_para 6f8e0215…, _ver 84a2d513…, _datos 5bc6c477…,
--     _cobrado 39479a1c…). Una sola firma de cada una (regla 2).
--   · Lo que la tanda NO toca, igual a los dos lados: los enlaces de pago y los
--     cobros con tarjeta (hoy 0 y 0, tabla entera) y las claves de Redsys en
--     Vault (0).
--   · La 2238: con 0 cobros, 0 asientos de cobro y 0 cuentas de pasarela antes
--     y después; su copia previa nace con 0 filas («no existe» al deshacerla).
--     Los dos CHECK: «false» antes, «true» con la 2031.
-- Todo es del catálogo o de tablas que crea la propia tanda (miradas con
-- to_regclass): nada que otro proceso escriba a mitad del ensayo (W06).
select clave, valor from (
  select 1 o, 'tablas de Redsys y del abono (de 3)' clave,
    ((to_regclass('public.conta_cobro_redsys') is not null)::int + (to_regclass('public.conta_enlace_pago_intento') is not null)::int
     + (to_regclass('public.conta_redsys_aviso') is not null)::int)::text valor union all
  select 2, 'filas en las tablas de Redsys',
    case when to_regclass('public.conta_cobro_redsys') is null then 'no existe'
         else (xpath('/row/n/text()', query_to_xml('select (select count(*) from public.conta_cobro_redsys) + (select count(*) from public.conta_enlace_pago_intento)
                                                    + (select count(*) from public.conta_redsys_aviso) n', false, true, '')))[1]::text end union all
  select 3, 'columnas nuevas del enlace de pago (de 4)',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'conta_enlace_pago'
       and column_name in ('proveedor', 'comision', 'neto', 'abono_match_id'))::text union all
  select 4, 'funciones nuevas (_s01_*, conta_cobro_redsys_*, conta_redsys_*, abono)',
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
       and (p.proname like '\_s01\_%' or p.proname like 'conta\_cobro\_redsys\_%' or p.proname like 'conta\_redsys\_%'
            or p.proname in ('conta_enlace_pago_pedido', 'conta_enlace_pago_cobrado_redsys', 'conta_enlace_pago_comision',
                             'conta_abonos_pasarela_pendientes', 'conta_abono_pasarela_casar', 'conta_cobros_abonos')))::text union all
  select 5, 'huella de las cuatro funciones del enlace (md5 de los cuerpos)',
    (select md5(string_agg(p.proname || ':' || md5(p.prosrc), ',' order by p.proname)) from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('conta_enlace_pago_para', 'conta_enlace_pago_ver', 'conta_enlace_pago_datos', 'conta_enlace_pago_cobrado')) union all
  select 6, 'firmas de las cuatro funciones del enlace (una de cada: 4)',
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('conta_enlace_pago_para', 'conta_enlace_pago_ver', 'conta_enlace_pago_datos', 'conta_enlace_pago_cobrado'))::text union all
  select 7, 'claves de Redsys en Vault',
    (select count(*) from vault.secrets where name like 'conta\_redsys:%')::text union all
  select 8, 'cobros por el enlace (tabla entera)',
    (select count(*) from public.conta_enlace_pago where status = 'pagado')::text union all
  select 9, 'asientos de cobro por el enlace (customer_payment, tabla entera)',
    (select count(*) from public.journal_entry where source_type = 'customer_payment')::text union all
  select 10, 'cuentas de pasarela (tesorería «pasarela», tabla entera)',
    (select count(*) from public.treasury_account where kind = 'pasarela')::text union all
  select 11, 'copia previa de la 2238 (conta_s01_cobros_antes)',
    case when to_regclass('public.conta_s01_cobros_antes') is null then 'no existe'
         else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.conta_s01_cobros_antes', false, true, '')))[1]::text end union all
  select 12, 'CHECK de journal_entry.source_type admite customer_payment',
    (select (pg_get_constraintdef(oid) like '%customer_payment%')::text from pg_constraint where conname = 'journal_entry_source_type_check') union all
  select 13, 'CHECK de treasury_account.kind admite pasarela',
    (select (pg_get_constraintdef(oid) like '%pasarela%')::text from pg_constraint where conname = 'treasury_account_kind_check')
) x order by o;
