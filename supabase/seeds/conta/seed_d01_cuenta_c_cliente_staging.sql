-- supabase/seeds/conta/seed_d01_cuenta_c_cliente_staging.sql
--
-- D01 · Regla de Julio (17/10): en una cuenta que solo usa contabilidad no
-- aparece nada de plataformas. Para probarlo en la e2e hace falta una ficha que
-- abrir en la cuenta C (la de siempre y la de cada frente), que no tiene
-- empresa, ni canales de venta, ni plataformas: un cliente inventado, sin más.
-- SOLO STAGING. Todo inventado. Solo añade: ids fijos y, si ya está, no hace nada.
--
-- No toca empresas: las pruebas del alta (c00/alta.spec.ts) borran las de la C
-- y cuentan con que no tenga ninguna; un tercero no es una empresa.

do $$
declare
  cuenta uuid;
  cliente uuid;
  puestos int := 0;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla cliente C: esta base tiene cuentas de producción. No se siembra nada.';
  end if;
  foreach cuenta in array array[
    'c01c0000-0000-4000-8000-00000000000c', 'e2e0000a-0000-4000-8000-00000000000c', 'e2e0000b-0000-4000-8000-00000000000c',
    'e2e0000c-0000-4000-8000-00000000000c', 'e2e0000d-0000-4000-8000-00000000000c']::uuid[] loop
    continue when not exists (select 1 from public.accounts where id = cuenta);
    if exists (select 1 from public.sales_channel where account_id = cuenta) then
      raise exception 'Semilla cliente C: la cuenta % tiene canales de venta; la prueba cuenta con que no tenga.', cuenta;
    end if;
    cliente := (left(cuenta::text, 30) || '0000d1')::uuid;
    continue when exists (select 1 from public.party where id = cliente);
    insert into public.party (id, account_id, name, source, created_by_name)
    values (cliente, cuenta, 'Cliente Inventado de la Cuenta C', 'manual', 'semilla cliente C');
    insert into public.party_role (account_id, party_id, role) values (cuenta, cliente, 'customer');
    puestos := puestos + 1;
  end loop;
  raise notice 'Semilla cliente C: % clientes inventados puestos.', puestos;
end $$;
