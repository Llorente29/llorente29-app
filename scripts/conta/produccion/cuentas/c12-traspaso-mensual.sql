-- scripts/conta/produccion/cuentas/c12-traspaso-mensual.sql
--
-- C12 (24/10) · LO QUE CUENTA LA TANDA DEL TRASPASO MENSUAL, antes y después.
-- SOLO LEE. Lo de Foodint, con su cuenta (regla 9); lo de tabla entera, dicho.
--
-- Después del real: la columna modo existe y nadie está en 'mensual' (0); la
-- tabla de traspasos existe y está vacía (0); las 8 funciones existen;
-- conta_diez_por_enviar mira el modo (true); y lo que Foodint tiene en Diez y
-- pendiente no cambia de número (la tanda no envía ni toca ningún envío).
select clave, valor from (
  select 1 o, 'conta_diez_envio_empresa · columna modo' clave,
         (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'conta_diez_envio_empresa' and column_name = 'modo')::text valor union all
  select 2, 'conta_diez_envio_empresa · empresas en modo mensual (tabla entera)',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_diez_envio_empresa' and column_name = 'modo')
              then (xpath('/row/n/text()', query_to_xml('select count(*) n from public.conta_diez_envio_empresa where modo = ''mensual''', false, true, '')))[1]::text
              else 'sin columna' end union all
  select 3, 'conta_diez_traspaso · traspasos (tabla entera)',
         case when to_regclass('public.conta_diez_traspaso') is null then 'no existe'
              else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.conta_diez_traspaso', false, true, '')))[1]::text end union all
  select 4, 'funciones del traspaso (de 8)',
         (select count(*) from unnest(array['public._conta_traspaso_va(uuid)', 'public._conta_traspaso_en_diez(uuid)',
            'public.conta_traspaso_lista(uuid, date)', 'public.conta_traspaso_saldos(uuid, date)', 'public.conta_traspaso_revisar(uuid, date)',
            'public.conta_traspaso_confirmar(uuid, date)', 'public.conta_traspaso_apuntar(uuid, integer, integer, jsonb)',
            'public.conta_traspaso_terminar(uuid, jsonb, boolean)']) f where to_regprocedure(f) is not null)::text union all
  select 5, 'conta_diez_por_enviar · mira el modo',
         (position('modo' in (select prosrc from pg_proc where oid = 'public.conta_diez_por_enviar(integer)'::regprocedure)) > 0)::text union all
  select 6, 'external_send · de Foodint en Diez (enviado o enlazado)',
         (select count(*) from public.external_send where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and status in ('enviado', 'enlazado'))::text union all
  select 7, 'external_send · de Foodint pendientes',
         (select count(*) from public.external_send where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and status = 'pendiente')::text union all
  select 8, 'conta_diez_envio_empresa · Foodint enviar',
         coalesce((select enviar::text from public.conta_diez_envio_empresa where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'), 'sin fila')
) t order by o;
