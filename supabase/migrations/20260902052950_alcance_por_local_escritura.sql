-- EL ALCANCE POR LOCAL, EN LA ESCRITURA.
--
-- Hasta hoy el modelo de autorizacion decidia por CUENTA y por ROL y no conocia
-- el concepto de local: 529 politicas RLS y solo 9 mencionaban el local. Un
-- admin de Foodint veia y tocaba los tres locales, y las funciones que aceptan
-- p_location_id lo usaban para FILTRAR, no para AUTORIZAR: nadie comprobaba que
-- ese local fuera de los tuyos. Un admin acotado que llamara a set_brand_status
-- con el id de Alcala habria cerrado Alcala.
--
-- ── SE REUTILIZA manager_locations, NO SE CREA UNA SEGUNDA TABLA ────────────
-- Ya existia `manager_locations(user_profile_id, location_id)` con 0 filas,
-- 2 funciones y 3 politicas, atada al rol `manager` que no usa nadie. Crear
-- `user_location` al lado habria dejado DOS fuentes del alcance, y dos fuentes
-- acaban discrepando (Regla 10, que ya mordio hoy con el criterio de «sin
-- decidir»). Ademas ancla mejor de lo que se iba a crear: por user_profile_id,
-- no por user_id -- un usuario puede tener perfil en varias cuentas y el
-- alcance es por perfil.
--
-- ── LA REGLA, Y POR QUE NO ES «SIN FILAS = TODOS» A SECAS ──────────────────
-- «Sin filas = todos los locales» a secas ABRE UN AGUJERO: un worker sin filas
-- pasaria a tener todos los locales y entraria por la rama de vacations a
-- editar las de cualquiera. Hoy no puede. La regla correcta es «sin filas =
-- todos, SOLO si tu rol ya te daba todos»:
--
--   platform admin        -> todos los locales que existen
--   tiene filas           -> exactamente esos
--   sin filas y admin     -> todos los de SUS cuentas     (Julio, sin tocar)
--   sin filas y no admin  -> ninguno                       (worker, como hoy)
--
-- Con esto las 3 politicas de `vacations` NO cambian para nadie: un admin ya
-- entraba por su primera rama y un worker sigue dando falso.

-- ── 1 · El criterio, en UN solo sitio ──────────────────────────────────────
create or replace function public.current_user_location_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when public.current_user_is_admin() then
      (select coalesce(array_agg(id), '{}'::uuid[]) from public.locations)
    when exists (
      select 1 from public.manager_locations ml
      join public.user_profiles up on up.id = ml.user_profile_id
      where up.user_id = auth.uid() and up.active = true
    ) then
      (select coalesce(array_agg(distinct ml.location_id), '{}'::uuid[])
         from public.manager_locations ml
         join public.user_profiles up on up.id = ml.user_profile_id
        where up.user_id = auth.uid() and up.active = true)
    when exists (
      select 1 from public.user_profiles up
      where up.user_id = auth.uid() and up.active = true and up.role = 'admin'
    ) then
      (select coalesce(array_agg(l.id), '{}'::uuid[]) from public.locations l
        where l.account_id = any(public.current_user_account_ids()))
    else '{}'::uuid[]
  end;
$$;

revoke all on function public.current_user_location_ids() from public, anon;
grant execute on function public.current_user_location_ids() to authenticated, service_role;

-- ── 2 · La vieja pasa a ser un envoltorio del criterio unico ───────────────
-- Se le quita la atadura a `role = 'manager'`. No queda una tabla vieja viva y
-- vacia al lado de una nueva: hay UNA tabla y UN criterio.
create or replace function public.current_user_manages_location(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_location_id = any(public.current_user_location_ids());
$$;

comment on table public.manager_locations is
  'Alcance por local de un perfil. SIN FILAS = todos los locales, pero solo si el rol ya los daba (admin); un rol sin gestion sin filas no tiene ninguno. El criterio vive en current_user_location_ids() y en ningun sitio mas.';

-- ── 3 · El guard, para no repetir la condicion en cada funcion ─────────────
create or replace function public._assert_location_in_scope(p_location_id uuid, p_fn text)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if p_location_id is null then
    return;  -- cada funcion decide si el local es obligatorio
  end if;
  if not (p_location_id = any(public.current_user_location_ids())) then
    raise exception '%: sin acceso al local %. Tu usuario no tiene ese local en su alcance.',
      p_fn, p_location_id;
  end if;
end;
$$;

revoke all on function public._assert_location_in_scope(uuid, text) from public, anon;
grant execute on function public._assert_location_in_scope(uuid, text) to authenticated, service_role;

-- ── 4 · Las tres que hacen dano desde el local equivocado ──────────────────
-- Se inserta el guard con pg_get_functiondef + replace, no retranscribiendo:
-- retranscribir a mano una funcion que ya esta bien es como se cuela un cambio
-- que nadie pidio. Cada sustitucion se verifica.
do $inserta$
declare
  v_src  text;
  v_new  text;
  v_anclas text[] := array[
    'set_brand_status:' ||
      $a$    raise exception 'set_brand_status: sin acceso a la cuenta %', v_account_id;
  end if;$a$,
    'set_product_availability:' ||
      $a$    raise exception 'set_product_availability: sin acceso a la cuenta %', v_account_id;
  end if;$a$
  ];
  v_par text; v_fn text; v_ancla text; v_oid regprocedure;
begin
  foreach v_par in array v_anclas loop
    v_fn    := split_part(v_par, ':', 1);
    v_ancla := substring(v_par from position(':' in v_par) + 1);

    v_oid := case v_fn
      when 'set_brand_status' then 'public.set_brand_status(uuid,text,uuid,timestamptz,text,text)'::regprocedure
      when 'set_product_availability' then 'public.set_product_availability(uuid,boolean,uuid,text,timestamptz,text)'::regprocedure
    end;

    v_src := pg_get_functiondef(v_oid);
    if position(v_ancla in v_src) = 0 then
      raise exception 'no se encuentra el ancla en %: la funcion ha cambiado y hay que revisar esta migracion', v_fn;
    end if;
    if position('_assert_location_in_scope' in v_src) > 0 then
      raise notice '% ya tenia el guard, se salta', v_fn;
      continue;
    end if;

    v_new := replace(v_src, v_ancla,
      v_ancla || E'\n\n  -- (02/09) ALCANCE POR LOCAL. Hasta hoy el local era un filtro, no una\n'
              || '  -- autorizacion: un admin acotado podia operar sobre cualquier local de' || E'\n'
              || '  -- su cuenta. El criterio sale de current_user_location_ids().' || E'\n'
              || '  perform public._assert_location_in_scope(p_location_id, ''' || v_fn || ''');');
    execute v_new;

    v_src := pg_get_functiondef(v_oid);
    if position('_assert_location_in_scope' in v_src) = 0 then
      raise exception 'la insercion en % no quedo aplicada', v_fn;
    end if;
    raise notice 'guard insertado en %', v_fn;
  end loop;
end;
$inserta$;

-- set_modifier_option_availability: ancla propia (la escribi hoy, tiene otra forma)
do $inserta2$
declare
  v_src text;
  v_ancla constant text := $a$    raise exception 'set_modifier_option_availability: el local % no es de esta cuenta', p_location_id;
  end if;$a$;
begin
  v_src := pg_get_functiondef('public.set_modifier_option_availability(uuid,boolean,uuid,text,timestamptz,text)'::regprocedure);
  if position('_assert_location_in_scope' in v_src) > 0 then
    raise notice 'set_modifier_option_availability ya tenia el guard';
    return;
  end if;
  if position(v_ancla in v_src) = 0 then
    raise exception 'no se encuentra el ancla en set_modifier_option_availability';
  end if;
  execute replace(v_src, v_ancla,
    v_ancla || E'\n\n  -- (02/09) ALCANCE POR LOCAL, ver current_user_location_ids().\n'
            || '  perform public._assert_location_in_scope(p_location_id, ''set_modifier_option_availability'');');
  v_src := pg_get_functiondef('public.set_modifier_option_availability(uuid,boolean,uuid,text,timestamptz,text)'::regprocedure);
  if position('_assert_location_in_scope' in v_src) = 0 then
    raise exception 'la insercion en set_modifier_option_availability no quedo aplicada';
  end if;
  raise notice 'guard insertado en set_modifier_option_availability';
end;
$inserta2$;

-- ── 5 · Verificacion ───────────────────────────────────────────────────────
do $verif$
declare
  v_n int; v_locs int;
begin
  if to_regprocedure('public.current_user_location_ids()') is null then
    raise exception 'current_user_location_ids no quedo creada';
  end if;

  -- Las tres tienen el guard.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prosrc ilike '%_assert_location_in_scope%'
     and p.proname in ('set_brand_status','set_product_availability','set_modifier_option_availability');
  if v_n < 3 then
    raise exception 'solo % de 3 funciones tienen el guard de alcance', v_n;
  end if;

  -- La vieja ya no mira el rol.
  if pg_get_functiondef('public.current_user_manages_location(uuid)'::regprocedure) ilike '%manager%' then
    raise exception 'current_user_manages_location sigue atada al rol manager';
  end if;

  -- manager_locations sigue existiendo y sigue vacia: no se ha inventado alcance
  -- a nadie. Julio sigue viendo todo por la rama «sin filas y admin».
  select count(*) into v_n from manager_locations;
  if v_n <> 0 then
    raise exception 'manager_locations deberia seguir vacia y tiene % filas', v_n;
  end if;

  select count(*) into v_locs from locations;
  raise notice 'VERIFICACION OK: guard en 3 funciones, criterio unico, manager_locations vacia (% locales en total)', v_locs;
end;
$verif$;