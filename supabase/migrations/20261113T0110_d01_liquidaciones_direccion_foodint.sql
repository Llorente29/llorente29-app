-- supabase/migrations/20261113T0110_d01_liquidaciones_direccion_foodint.sql
--
-- D01 · Liquidaciones por correo · Los datos de Foodint: su dirección de
-- liquidaciones, liquidaciones-foodint@entrada.folvy.app, APAGADA. No se
-- enciende hasta que Julio configure Resend (el dominio y el webhook): hasta
-- entonces no llega nada, y aunque llegara, una dirección apagada se apunta y no
-- se lee. Hace falta ya para preparar el filtro de reenvío de Gmail.
-- El identificador es el que daría conta_direccion_entrada (el nombre comercial
-- de la empresa, sin tildes ni signos): medido en producción, solo lectura,
-- «foodint»; y la tabla, vacía (0 direcciones).
-- Solo añade una fila (de Foodint, regla 9); si ya está, no hace nada.
-- Vuelta atrás: supabase/vuelta-atras/20261113T0110_d01_liquidaciones_direccion_foodint.down.sql

insert into public.company_inbound_address (account_id, company_id, kind, local_part, domain, active, created_by_name)
select c.account_id, c.id, 'liquidaciones', 'liquidaciones-foodint', 'entrada.folvy.app', false, 'Tanda D01 · liquidaciones'
  from public.company c
 where c.id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and c.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
   and not exists (select 1 from public.company_inbound_address x
                    where (x.company_id = c.id and x.kind = 'liquidaciones') or (lower(x.local_part) = 'liquidaciones-foodint' and lower(x.domain) = 'entrada.folvy.app'));
