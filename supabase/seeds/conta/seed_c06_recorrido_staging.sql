-- ============================================================================
-- C06 · Tarea 6 · El recorrido entero de la cuenta del frente C. SOLO STAGING.
-- ----------------------------------------------------------------------------
-- El recorrido (tests/e2e/conta/c06/recorrido.spec.ts) hace lo que haría el
-- cliente, desde cero y en su orden: la invitación (conta-crear-cuenta, como
-- administrador de plataforma de prueba c06.plataforma@c06-prueba.test), la
-- entrada, el alta con su plan y su banco, traer de Diez desde la C0009 (solo
-- leyendo) y el Inicio, los libros y el balance. Cada ejecución da de alta una
-- cuenta nueva «Recorrido de Prueba C06 …» (ordenador y móvil, una cada uno).
--
-- Registrar la base de Diez de una empresa lo hace Folvy (conta_diez_base_poner,
-- solo service_role): en producción, a mano y con registro. Aquí lo necesita la
-- prueba, sin la clave de servicio, así que esta función —que SOLO existe en
-- staging, por esta semilla, y no está en ninguna migración— se lo deja hacer
-- al administrador de plataforma de prueba (el de la plantilla o el de su
-- carril) y a nadie más, y solo para una
-- empresa de una cuenta del recorrido. Pasa la C0009 (que es una, única) de la
-- empresa que la tenga a la del recorrido, con su registro.
--
-- Guardas: aborta si al otro lado hay cuentas de producción, o si falta el
-- administrador de plataforma de prueba (seed_c06_staging.sql).
-- Se puede volver a aplicar.
-- ============================================================================

do $$
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla del recorrido C06 ABORTADA: esta base tiene cuentas de producción. ¿Es staging-conta?';
  end if;
  if not exists (select 1 from public.platform_admins where user_id = 'c0600000-0000-4000-8000-0000000000f0' and active) then
    raise exception 'Semilla del recorrido C06: falta el administrador de plataforma de prueba (seed_c06_staging.sql).';
  end if;
end $$;

create or replace function public.e2e_c06_recorrido_base(p_company uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- W02 (carriles): cada e2e entra con su copia del administrador de plataforma
  -- de prueba, con el segundo grupo del id cambiado por el número de su carril
  -- (scripts/e2e/carril/comun.sql, en_carril). Vale el de la plantilla y el de
  -- cualquier carril, siempre que sea administrador de plataforma activo.
  if auth.uid() is null
     or overlay(auth.uid()::text placing '0000' from 10 for 4) <> 'c0600000-0000-4000-8000-0000000000f0'
     or not exists (select 1 from public.platform_admins where user_id = auth.uid() and active) then
    raise exception 'Solo el administrador de plataforma de prueba del C06.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.company c join public.accounts a on a.id = c.account_id
                  where c.id = p_company and a.name like 'Recorrido de Prueba C06 %' and a.product_brand = 'contabilidad') then
    raise exception 'Esa empresa no es de una cuenta del recorrido del C06.' using errcode = '42501';
  end if;
  delete from public.conta_diez_base where nombre_bd = 'C0009' and company_id <> p_company;
  if not exists (select 1 from public.conta_diez_base where company_id = p_company) then
    perform public.conta_diez_base_poner(p_company, 'C0009',
      'Recorrido e2e del C06 (staging): traer de Diez leyendo la C0009.', 'e2e C06 · c06.plataforma');
  end if;
  return 'C0009';
end;
$$;

revoke all on function public.e2e_c06_recorrido_base(uuid) from public, anon;
grant execute on function public.e2e_c06_recorrido_base(uuid) to authenticated;
comment on function public.e2e_c06_recorrido_base(uuid) is
  'SOLO STAGING (seed_c06_recorrido_staging.sql). El recorrido e2e del C06 registra la C0009 para su empresa. Solo el administrador de plataforma de prueba (el de la plantilla o el de su carril).';

-- Comprobación: existe y la ve quien tiene que verla.
do $$
begin
  if not has_function_privilege('authenticated', 'public.e2e_c06_recorrido_base(uuid)', 'execute') then
    raise exception 'Semilla del recorrido C06: authenticated no puede ejecutar e2e_c06_recorrido_base.';
  end if;
  raise notice 'Semilla del recorrido C06 OK: e2e_c06_recorrido_base lista (solo c06.plataforma, solo cuentas «Recorrido de Prueba C06 …»).';
end $$;
