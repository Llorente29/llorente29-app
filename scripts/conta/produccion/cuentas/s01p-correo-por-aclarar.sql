-- scripts/conta/produccion/cuentas/s01p-correo-por-aclarar.sql
--
-- S01p·20 · punto 1 · El lector de correos no descarta en silencio (1504 y 1511) · LO QUE CUENTA LA
-- TANDA, antes y después. SOLO LEE. Todo acotado a los 11 correos de Just Eat del 01/11 (por su id de
-- correo o por su número): nada más escribe esas filas, así que no crecen solas a mitad del ensayo.
--   1. Su registro de entrada: igual antes y después (la tanda no relee ninguno).
--   2. Sus liquidaciones y sus facturas: 0 antes y 0 después (la tanda no crea ninguna).
--   3. Sus filas «por aclarar»: 0 antes, 8 después (los 3 de octubre, no).
select clave, valor from (
  -- quieta: la tanda no relee ningún correo
  select 1 o, 'Foodint · los 11 de Just Eat del 01/11 en el registro (n · huella)' clave,
    (select count(*) || ' · ' || md5(coalesce(string_agg(l.email_id || ':' || l.outcome, '|' order by l.email_id), ''))
       from public.inbound_email_log l
      where l.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
        and l.email_id in ('36ccc167-ad37-44d1-97fa-37af5473b673', '855e42e1-a7dd-4f9d-aa3f-ace64f0219b9', '95d4117e-1938-4d84-9eef-63e386a7b0d8',
                           'a5364aee-8f47-41a2-bd34-e05fc211a93b', '398151b2-ac78-4f70-a9e5-620fcaab9649', '6026529c-f1f4-46e5-91c5-1383674e3b6c',
                           'f9bc4e4d-95df-4115-92fe-c5e128a2d61f', 'e4e99e89-d808-434c-81ed-cdb996c1b4e8', '5abb6562-4b2c-403c-952f-71f545065d03',
                           '8dc333c9-02f2-4eed-8a01-b10e2fcd0231', '19669671-98d1-4290-b111-e294e91705a7')) valor
  union all
  -- quieta: la tanda no crea ninguna liquidación ni factura de esos 11 (solo entran si alguien pulsa «Volver a leer»)
  select 2, 'Foodint · liquidaciones y facturas de los 11 (liquidaciones · facturas)',
    (select count(*) from public.channel_settlement cs
      where cs.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and cs.inbound_email_id in ('36ccc167-ad37-44d1-97fa-37af5473b673', '855e42e1-a7dd-4f9d-aa3f-ace64f0219b9', '95d4117e-1938-4d84-9eef-63e386a7b0d8',
                                    'a5364aee-8f47-41a2-bd34-e05fc211a93b', '398151b2-ac78-4f70-a9e5-620fcaab9649', '6026529c-f1f4-46e5-91c5-1383674e3b6c',
                                    'f9bc4e4d-95df-4115-92fe-c5e128a2d61f', 'e4e99e89-d808-434c-81ed-cdb996c1b4e8', '5abb6562-4b2c-403c-952f-71f545065d03',
                                    '8dc333c9-02f2-4eed-8a01-b10e2fcd0231', '19669671-98d1-4290-b111-e294e91705a7'))
    || ' · ' ||
    (select count(*) from public.supplier_invoice si
      where si.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and si.invoice_number in ('3972671', '3985628', '3994650', '3994688', '4018942', '4019492', '4040922', '4060895', '4126341', '4126364', '4126424'))
  union all
  -- corte: antes 0, después 8 (los de junio a septiembre; los 3 de octubre, no)
  select 3, 'Foodint · los 11 en «Por aclarar» (n · de los 3 de octubre)',
    (select
      -- quieta: solo las filas de esos 11 correos, por su id; la entrada solo las crea si alguien los vuelve a leer
      count(*) || ' · ' || count(*) filter (where d.email_id in ('5abb6562-4b2c-403c-952f-71f545065d03', '8dc333c9-02f2-4eed-8a01-b10e2fcd0231', '19669671-98d1-4290-b111-e294e91705a7'))
       from public.document_inbox d
      where d.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and d.status = 'error' and d.file_path is null and d.link_url is null
        and d.email_id in ('36ccc167-ad37-44d1-97fa-37af5473b673', '855e42e1-a7dd-4f9d-aa3f-ace64f0219b9', '95d4117e-1938-4d84-9eef-63e386a7b0d8',
                           'a5364aee-8f47-41a2-bd34-e05fc211a93b', '398151b2-ac78-4f70-a9e5-620fcaab9649', '6026529c-f1f4-46e5-91c5-1383674e3b6c',
                           'f9bc4e4d-95df-4115-92fe-c5e128a2d61f', 'e4e99e89-d808-434c-81ed-cdb996c1b4e8', '5abb6562-4b2c-403c-952f-71f545065d03',
                           '8dc333c9-02f2-4eed-8a01-b10e2fcd0231', '19669671-98d1-4290-b111-e294e91705a7'))
) t order by o;
