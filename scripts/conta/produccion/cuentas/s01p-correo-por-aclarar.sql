-- scripts/conta/produccion/cuentas/s01p-correo-por-aclarar.sql
--
-- S01p·20 · punto 1 · El lector de correos no descarta en silencio (1504 y 1511) · LO QUE CUENTA LA
-- TANDA, antes y después. SOLO LEE.
--   1. Los 11 correos de Just Eat del 01/11 en el registro de entrada de Foodint: iguales antes y
--      después (la tanda no relee ninguno; siguen «sin_facturas» hasta que alguien pulse «Volver a leer»).
--   2. Las liquidaciones y facturas de Foodint: iguales (la tanda no crea ninguna).
--   3. Las filas «por aclarar» de correos sin factura de Foodint: 0 antes, 8 después (los 3 de octubre, no).
select clave, valor from (
  -- quieta: la tanda no relee ningún correo
  select 1 o, 'Foodint · los 11 de Just Eat del 01/11 en el registro (n · huella)' clave,
    (select count(*) || ' · ' || md5(coalesce(string_agg(l.email_id || ':' || l.outcome, '|' order by l.email_id), ''))
       from public.inbound_email_log l
      where l.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and l.subject ~* 'just-?eat invoice'
        and l.subject ~ '(3972671|3985628|3994650|3994688|4018942|4019492|4040922|4060895|4126341|4126364|4126424)') valor
  union all
  -- quieta: la tanda no crea ninguna liquidación
  select 2, 'Foodint · liquidaciones (n · huella)',
    (select count(*) || ' · ' || md5(coalesce(string_agg(cs.id::text, '|' order by cs.id), ''))
       from public.channel_settlement cs where cs.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')
  union all
  -- quieta: la tanda no crea ninguna factura
  select 3, 'Foodint · facturas recibidas (n · huella)',
    (select count(*) || ' · ' || md5(coalesce(string_agg(si.id::text, '|' order by si.id), ''))
       from public.supplier_invoice si where si.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')
  union all
  -- corte: antes 0, después 8 (los de junio a septiembre; los 3 de octubre, no)
  select 4, 'Foodint · correos sin factura en «Por aclarar» (n · de los 3 de octubre)',
    (select count(*) || ' · ' || count(*) filter (where d.email_id in ('5abb6562-4b2c-403c-952f-71f545065d03', '8dc333c9-02f2-4eed-8a01-b10e2fcd0231', '19669671-98d1-4290-b111-e294e91705a7'))
       from public.document_inbox d
      where d.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and d.status = 'error' and d.file_path is null and d.link_url is null and d.email_id is not null)
) t order by o;
