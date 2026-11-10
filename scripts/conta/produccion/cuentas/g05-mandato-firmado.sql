-- scripts/conta/produccion/cuentas/g05-mandato-firmado.sql
--
-- G05 · Un mandato en pending_submission ya está firmado (nº 90) · LO QUE CUENTA
-- LA TANDA, antes y después. SOLO LEE. La misma vara a los dos lados (regla 31).
-- Medido antes el 10/11 a las 16:34 UTC. No se cuentan mandatos: cambian con cada
-- lectura de GoCardless. Lo que tiene que pasar:
--   1. «Por firmar» cuenta solo pending_customer_approval: false → true.
--   2. conta_cobro_para_enviar, sin tocar (huella 71cd3245…): true → true.
select clave, valor from (
  select 1 o, '«Por firmar» cuenta solo pending_customer_approval' clave,
    (pg_get_functiondef('public.conta_lista_que_hacer(uuid)'::regprocedure) ~ 'm\.estado = ''pending_customer_approval''')::text valor union all
  select 2, 'conta_cobro_para_enviar, sin tocar',
    (md5(pg_get_functiondef('public.conta_cobro_para_enviar(uuid,text)'::regprocedure)) = '71cd3245c798bafa43613202bffa6497')::text
) q order by o;
