-- supabase/migrations/20261119T0110_d01_facturas_foodint.sql
--
-- D01 · Las facturas por correo · Los datos de Foodint (Julio, 16/10: es
-- obligatorio para Foodint).
--   1. Su dirección de facturas, facturas-foodint@entrada.folvy.app, ENCENDIDA
--      desde el principio: el dominio ya está dado de alta en Resend (la de
--      liquidaciones recibe desde el 16/10) y la confirmación del reenvío de
--      Gmail tiene que encontrarla encendida, o se apunta «apagada» y no se lee.
--      El identificador es el que daría conta_direccion_entrada (el nombre
--      comercial, sin tildes ni signos): «foodint», como el de liquidaciones.
--   2. Un remitente de uno de sus proveedores que manda justificantes de
--      entrega, no facturas: si llegan reenviados, no se leen como factura. Va
--      por su huella (sha256 de la dirección en minúsculas): la dirección no
--      está en el repositorio.
--
-- Solo añade dos filas, de la cuenta y la empresa de Foodint (regla 9).
-- Freno: la empresa es de esa cuenta, la empresa no tiene aún dirección de
-- facturas y nadie tiene esa dirección; si no, para sin tocar nada y dice qué
-- ha visto. Después comprueba que ha puesto exactamente una de cada.
-- En una base sin Foodint (staging), no hace nada y lo dice. La prueba de
-- staging (20261119_d01_facturas_correo_prueba.sql) la ejecuta de verdad sobre
-- la cuenta A diciéndole cuenta, empresa y dirección con d01_facturas.*; con
-- esos ajustes puestos, en una base con cuentas de producción, para.
-- Vuelta atrás: supabase/vuelta-atras/20261119T0110_d01_facturas_foodint.down.sql

do $$
declare
  acc constant uuid := coalesce(nullif(current_setting('d01_facturas.cuenta', true), ''), '51ad1792-6629-4ef7-833a-b57b09a86710')::uuid;
  emp constant uuid := coalesce(nullif(current_setting('d01_facturas.empresa', true), ''), '658728c0-fcd7-46ef-a860-d4e5e6eb21d9')::uuid;
  lp  constant text := coalesce(nullif(current_setting('d01_facturas.direccion', true), ''), 'facturas-foodint');
  -- La huella del remitente de los justificantes (sha256 de la dirección en minúsculas).
  remitente constant text := 'efb721fef32c202a4279b3b73b3111296e5359cf133edcc22ac383e6b2b2f2c8';
  n int; m int;
begin
  if coalesce(current_setting('d01_facturas.cuenta', true), '') <> ''
     and exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'FACTURAS FOODINT PARADA: d01_facturas.* es solo para la prueba de staging, y esta base tiene cuentas de producción.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.company where id = emp and account_id = acc) then
    raise notice 'Facturas por correo de Foodint: esta base no tiene esa empresa en esa cuenta; no se toca nada.';
    return;
  end if;
  select count(*) into n from public.company_inbound_address where company_id = emp and kind = 'facturas';
  select count(*) into m from public.company_inbound_address where lower(local_part) = lp and lower(domain) = 'entrada.folvy.app';
  if n <> 0 or m <> 0 then
    raise exception 'FACTURAS FOODINT PARADA: la empresa ya tiene % dirección(es) de facturas y % fila(s) tienen %@entrada.folvy.app; tiene que no haber ninguna. No se toca nada.', n, m, lp
      using errcode = 'P0001';
  end if;

  insert into public.company_inbound_address (account_id, company_id, kind, local_part, domain, active, created_by_name)
  values (acc, emp, 'facturas', lp, 'entrada.folvy.app', true, 'Tanda D01 · facturas por correo');
  insert into public.company_inbound_sender (account_id, company_id, sender_sha256, decision, reason, created_by_name)
  values (acc, emp, remitente, 'no_facturas', 'Desde esa dirección el proveedor manda sus justificantes de entrega, que no son facturas.', 'Tanda D01 · facturas por correo')
  on conflict (company_id, sender_sha256) do nothing;

  select count(*) into n from public.company_inbound_address
   where account_id = acc and company_id = emp and kind = 'facturas' and local_part = lp and active;
  select count(*) into m from public.company_inbound_sender where account_id = acc and company_id = emp and sender_sha256 = remitente;
  if n <> 1 or m <> 1 then
    raise exception 'FACTURAS FOODINT: se esperaba 1 dirección encendida y 1 remitente, y hay % y %. Se deshace todo.', n, m using errcode = 'P0001';
  end if;
end $$;
