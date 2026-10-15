-- supabase/staging/sql/20261111_c06b_diez_autorizo_recibidas_prueba.sql
--
-- SOLO STAGING. Prueba de 20261111T0740 (C06b, respuesta 8, tarea 1): la
-- columna incluye_recibidas de public.conta_diez_autorizo. Todo en una
-- transacción con ROLLBACK: no cambia staging.
--   0. La columna existe, es boolean, no admite vacío y por defecto es false.
--   1. Lo que ya había queda en false (ninguna fila abre las recibidas).
--   2. Una de empresa sin decirlo entra con false; diciéndolo, con true.
--   3. No admite vacío.
--   4. Un usuario sigue sin leerla.
-- Base inventada C0099: no se habla con Diez.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA C06b recibidas: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_emp uuid; v_falla text; v_x boolean;
begin
  -- 0
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_diez_autorizo'
                  and column_name = 'incluye_recibidas' and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false') then
    raise exception 'PRUEBA C06b recibidas · 0: falta incluye_recibidas (boolean, not null, default false).';
  end if;
  raise notice 'PRUEBA C06b recibidas · 0: columna boolean, not null, por defecto false: ok.';
  -- 1
  if exists (select 1 from public.conta_diez_autorizo where incluye_recibidas) then
    raise exception 'PRUEBA C06b recibidas · 1: alguna autorización que ya había abre las recibidas.';
  end if;
  raise notice 'PRUEBA C06b recibidas · 1: lo que ya había (% filas), todo en false.', (select count(*) from public.conta_diez_autorizo);
  -- 2
  select id into v_emp from public.company where account_id = v_acc order by created_at limit 1;
  delete from public.conta_diez_autorizo where company_id = v_emp and nombre_bd = 'C0099';
  insert into public.conta_diez_autorizo (account_id, company_id, alcance, entry_id, nombre_bd, autorizado_por, motivo, desde)
  values (v_acc, v_emp, 'empresa', null, 'C0099', 'Prueba C06b', 'Empresa desde el 01/10, solo ventas (prueba)', '2026-10-01')
  returning incluye_recibidas into v_x;
  if v_x is distinct from false then raise exception 'PRUEBA C06b recibidas · 2: sin decirlo no ha entrado en false (%).', v_x; end if;
  update public.conta_diez_autorizo set incluye_recibidas = true where company_id = v_emp and nombre_bd = 'C0099' returning incluye_recibidas into v_x;
  if v_x is distinct from true then raise exception 'PRUEBA C06b recibidas · 2: no ha quedado en true.'; end if;
  raise notice 'PRUEBA C06b recibidas · 2: sin decirlo, false; diciéndolo, true.';
  -- 3
  begin
    update public.conta_diez_autorizo set incluye_recibidas = null where company_id = v_emp and nombre_bd = 'C0099';
    v_falla := null;
  exception when not_null_violation then v_falla := sqlerrm; end;
  if v_falla is null then raise exception 'PRUEBA C06b recibidas · 3: ha admitido vacío.'; end if;
  raise notice 'PRUEBA C06b recibidas · 3: no admite vacío (%).', left(v_falla, 90);
end $$;

-- 4
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_falla text;
begin
  begin perform count(*) from public.conta_diez_autorizo; v_falla := null;
  exception when insufficient_privilege then v_falla := sqlerrm; end;
  if v_falla is null then raise exception 'PRUEBA C06b recibidas · 4: un usuario lee conta_diez_autorizo.'; end if;
  raise notice 'PRUEBA C06b recibidas · 4: un usuario no la lee (%).', left(v_falla, 80);
end $$;
reset role;

rollback;
