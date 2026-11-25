-- scripts/conta/produccion/cuentas/v05.sql
--
-- V05 (25/11) · LO QUE CUENTA LA TANDA DE «VERIFACTU EN PRUEBAS CON EL
-- CERTIFICADO DE LA EMPRESA», antes y después. SOLO LEE. Todo es de la base
-- entera, y se dice: Verifactu es por empresa y la tanda no toca datos de
-- nadie.
-- Lo que tiene que cambiar: las funciones de la 1830 (0 → 5 de 5). Lo demás,
-- igual: ninguna empresa en real, ningún registro ni envío en real, las
-- autorizaciones del certificado y las pruebas de conexión (las escribe una
-- persona o conta-verifactu, no la tanda), y las funciones de la V03 que la
-- 1830 usa al lado, sin tocar.
select clave, valor from (
  select 1 o, 'funciones de la 1830 (base entera)' clave,
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('verifactu_cert_abrir_pruebas', 'verifactu_cert_abrir_pruebas_envio', 'verifactu_despertar_empresa',
                          'verifactu_conexion_ultima', 'verifactu_pruebas_resumen')) || ' de 5' valor union all
  select 2, 'empresas con Verifactu en real (base entera)',
    -- quieta: el real está cerrado en el programa (V05)
    (select count(*) from public.verifactu_empresa where modo = 'real')::text union all
  select 3, 'registros y envíos de Verifactu en real (base entera)',
    -- quieta: sin ninguna empresa en real no se escribe ninguno
    (select count(*) from public.verifactu_registro where entorno = 'real') || ' / ' || (select count(*) from public.verifactu_envio where entorno = 'real') union all
  select 4, 'autorizaciones del certificado para Verifactu (base entera)',
    -- quieta: las da una persona en Ajustes › Verifactu, no la tanda
    (select count(*) from public.verifactu_autorizacion)::text union all
  select 5, 'pruebas de conexión apuntadas (base entera)',
    -- quieta: las apunta conta-verifactu cuando alguien pulsa «Probar la conexión»
    (select count(*) from public.verifactu_conexion)::text union all
  select 6, 'huella de las funciones de la V03 que la 1830 usa al lado',
    -- quieta: la 1830 solo añade
    (select string_agg(p.proname || ' ' || left(md5(p.prosrc), 8), ', ' order by p.proname) from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('verifactu_cert_abrir', 'verifactu_cert_abrir_cuadre', 'verifactu_conexion_apuntar', 'verifactu_conexion_probada', 'verifactu_modo'))
) t order by o;
