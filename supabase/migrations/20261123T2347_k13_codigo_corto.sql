-- supabase/migrations/20261123T2347_k13_codigo_corto.sql
--
-- K13 · El código corto de cada local, marca y plataforma (Julio, 24/11: «decidido»; maqueta 17b, c2-1, c2-3 y c2-5).
-- En la recibida, la analítica de cada tramo se escribe por su código corto (003, MIL, GLO) y la lupa busca por código y
-- por nombre, como en ERP10.
--
-- SOLO AÑADE: una tabla nueva, sus filas y tres funciones nuevas. No toca locations, brand ni sales_channel (la última
-- es del camino del pedido): el código vive aparte, en conta_codigo_corto, y así la base garantiza que no se repite.
--
--   1. conta_codigo_corto(cuenta, tabla, id, código, origen): uno por local, marca o plataforma; único dentro de la
--      cuenta y la tabla (Julio, 24/11: por cuenta, que es como están guardados). Origen «propuesto» (sale del nombre),
--      «a_mano» (lo cambió alguien) o «erp10» (lo traerá la lista de ERP10: una tanda futura cambiará solo los
--      «propuesto», sin tocar los puestos a mano).
--   2. _conta_codigo_corto_propuesto(tabla, cuenta, nombre): el que se propone, sin repetir en la cuenta: los locales,
--      un número de tres cifras (001, 002…, el siguiente libre); las marcas y las plataformas, tres letras del nombre
--      sin acentos (MIL, GLO) y, si ya está, las dos primeras y una cifra (MI2…), y si no, la primera y dos cifras.
--   3. conta_codigos_cortos(): los códigos de tu cuenta, y antes pone el propuesto a lo que aún no tiene (lo dado de
--      alta después de esta tanda): así nada se queda sin código y nadie tiene que acordarse.
--   4. conta_codigo_corto_poner(tabla, id, código): lo cambia a mano («a_mano»), de tu cuenta, sin repetir; vacío
--      vuelve al propuesto.
--   5. El relleno: el propuesto de lo que ya existe, por cuenta, en el orden en que se creó (el primer local, 001).
--      Escribe solo en la tabla nueva. Lo cuenta k13-recibida-calcada.sql.
--
-- Hoy no hay en la base ningún código de la analítica de ERP10 (medido: ni en locations, brand, sales_channel,
-- conta_eje_analitico ni en las tablas conta_erp10_*), así que todos salen del nombre.

create table if not exists public.conta_codigo_corto (
  account_id uuid not null references public.accounts(id) on delete cascade,
  tabla text not null check (tabla in ('locations', 'brand', 'sales_channel')),
  entity_id uuid not null,
  code text not null check (code ~ '^[A-Z0-9]{1,8}$'),
  origen text not null default 'propuesto' check (origen in ('propuesto', 'a_mano', 'erp10')),
  updated_at timestamptz not null default now(),
  primary key (tabla, entity_id),
  unique (account_id, tabla, code)
);
comment on table public.conta_codigo_corto is
  'K13 · El código corto de cada local, marca y plataforma (003, MIL, GLO), único en la cuenta: se escribe en la analítica de la recibida. Origen: propuesto (del nombre), a_mano o erp10.';
alter table public.conta_codigo_corto enable row level security;
revoke all on table public.conta_codigo_corto from public, anon, authenticated;
grant select on table public.conta_codigo_corto to authenticated;
drop policy if exists conta_codigo_corto_leer on public.conta_codigo_corto;
create policy conta_codigo_corto_leer on public.conta_codigo_corto for select to authenticated
  using (public.belongs_to_account(account_id));

-- El código que se propone a partir del nombre, sin repetir en la cuenta.
create or replace function public._conta_codigo_corto_propuesto(p_tabla text, p_cuenta uuid, p_nombre text)
returns text language plpgsql stable set search_path = public as $$
declare
  v_usados text[];
  v_letras text;
  v_cand text;
  i int;
begin
  if p_tabla not in ('locations', 'brand', 'sales_channel') then raise exception 'K13: no sé la tabla «%».', p_tabla; end if;
  select coalesce(array_agg(code), '{}') into v_usados from public.conta_codigo_corto where account_id = p_cuenta and tabla = p_tabla;
  if p_tabla = 'locations' then
    for i in 1 .. 999 loop
      v_cand := lpad(i::text, 3, '0');
      if not (v_cand = any (v_usados)) then return v_cand; end if;
    end loop;
    return null;
  end if;
  -- Las letras del nombre, sin acentos ni lo que no es letra o cifra.
  v_letras := upper(regexp_replace(translate(coalesce(p_nombre, ''), 'áéíóúüñçÁÉÍÓÚÜÑÇàèìòùÀÈÌÒÙ', 'aeiouuncAEIOUUNCaeiouAEIOU'), '[^A-Za-z0-9]', '', 'g'));
  if v_letras = '' then v_letras := 'X'; end if;
  v_cand := left(v_letras || 'XX', 3);
  if not (v_cand = any (v_usados)) then return v_cand; end if;
  for i in 2 .. 9 loop
    v_cand := left(v_letras || 'XX', 2) || i::text;
    if not (v_cand = any (v_usados)) then return v_cand; end if;
  end loop;
  for i in 10 .. 99 loop
    v_cand := left(v_letras, 1) || i::text;
    if not (v_cand = any (v_usados)) then return v_cand; end if;
  end loop;
  return null;
end $$;
revoke all on function public._conta_codigo_corto_propuesto(text, uuid, text) from public, anon, authenticated;

-- Pone el propuesto a lo de una cuenta que aún no tiene código (por tabla, en el orden en que se creó). Devuelve cuántos.
create or replace function public._conta_codigo_corto_rellenar(p_cuenta uuid)
returns int language plpgsql security definer set search_path = public as $$
declare r record; v text; n int := 0;
begin
  for r in
    select 'locations' t, l.id, l.name, l.created_at from public.locations l
     where l.account_id = p_cuenta and not exists (select 1 from public.conta_codigo_corto k where k.tabla = 'locations' and k.entity_id = l.id)
    union all
    select 'brand', b.id, b.name, b.created_at from public.brand b
     where b.account_id = p_cuenta and not exists (select 1 from public.conta_codigo_corto k where k.tabla = 'brand' and k.entity_id = b.id)
    union all
    select 'sales_channel', c.id, c.name, c.created_at from public.sales_channel c
     where c.account_id = p_cuenta and not exists (select 1 from public.conta_codigo_corto k where k.tabla = 'sales_channel' and k.entity_id = c.id)
    order by 1, 4, 2
  loop
    v := public._conta_codigo_corto_propuesto(r.t, p_cuenta, r.name);
    if v is not null then
      insert into public.conta_codigo_corto (account_id, tabla, entity_id, code, origen) values (p_cuenta, r.t, r.id, v, 'propuesto')
      on conflict do nothing;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public._conta_codigo_corto_rellenar(uuid) from public, anon, authenticated;

-- Los códigos de tu cuenta (y antes, el propuesto a lo que no lo tiene).
create or replace function public.conta_codigos_cortos(p_cuenta uuid)
returns table (tabla text, id uuid, codigo text, origen text) language plpgsql security definer set search_path = public as $$
begin
  if p_cuenta is null or not public.belongs_to_account(p_cuenta) then
    raise exception 'No es de tu cuenta.' using errcode = '42501';
  end if;
  perform public._conta_codigo_corto_rellenar(p_cuenta);
  return query select k.tabla, k.entity_id, k.code, k.origen from public.conta_codigo_corto k where k.account_id = p_cuenta order by k.tabla, k.code;
end $$;
revoke all on function public.conta_codigos_cortos(uuid) from public, anon;
grant execute on function public.conta_codigos_cortos(uuid) to authenticated;
comment on function public.conta_codigos_cortos(uuid) is
  'K13 · Los códigos cortos de los locales, marcas y plataformas de tu cuenta; antes pone el propuesto (del nombre) a lo que aún no lo tiene.';

-- Cambiarlo a mano: de tu cuenta, sin repetir; queda «a_mano» (la lista de ERP10 ya no lo pisará). Vacío: el propuesto.
create or replace function public.conta_codigo_corto_poner(p_tabla text, p_id uuid, p_codigo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid;
  v_nombre text;
  v_codigo text := nullif(upper(trim(p_codigo)), '');
  v_otro text;
begin
  if p_tabla not in ('locations', 'brand', 'sales_channel') then raise exception 'No sé qué es «%».', p_tabla using errcode = '22023'; end if;
  if p_tabla = 'locations' then select account_id, name into v_cuenta, v_nombre from public.locations where id = p_id;
  elsif p_tabla = 'brand' then select account_id, name into v_cuenta, v_nombre from public.brand where id = p_id;
  else select account_id, name into v_cuenta, v_nombre from public.sales_channel where id = p_id;
  end if;
  if v_cuenta is null or not public.belongs_to_account(v_cuenta) then
    raise exception 'No es de tu cuenta.' using errcode = '42501';
  end if;
  if v_codigo is not null and v_codigo !~ '^[A-Z0-9]{1,8}$' then
    raise exception 'El código corto, de 1 a 8 letras o cifras (es «%»).', v_codigo using errcode = '22023';
  end if;
  delete from public.conta_codigo_corto where tabla = p_tabla and entity_id = p_id;
  if v_codigo is null then
    perform public._conta_codigo_corto_rellenar(v_cuenta);
    select code into v_codigo from public.conta_codigo_corto where tabla = p_tabla and entity_id = p_id;
    return jsonb_build_object('codigo', v_codigo, 'origen', 'propuesto', 'texto', format('Código corto de «%s»: %s (el propuesto).', v_nombre, coalesce(v_codigo, 'ninguno')));
  end if;
  select case k.tabla when 'locations' then (select name from public.locations where id = k.entity_id)
                      when 'brand' then (select name from public.brand where id = k.entity_id)
                      else (select name from public.sales_channel where id = k.entity_id) end
    into v_otro from public.conta_codigo_corto k where k.account_id = v_cuenta and k.tabla = p_tabla and k.code = v_codigo;
  if found then raise exception 'El código % ya es de «%».', v_codigo, v_otro using errcode = '23505'; end if;
  insert into public.conta_codigo_corto (account_id, tabla, entity_id, code, origen) values (v_cuenta, p_tabla, p_id, v_codigo, 'a_mano');
  return jsonb_build_object('codigo', v_codigo, 'origen', 'a_mano', 'texto', format('Código corto de «%s»: %s.', v_nombre, v_codigo));
end $$;
revoke all on function public.conta_codigo_corto_poner(text, uuid, text) from public, anon;
grant execute on function public.conta_codigo_corto_poner(text, uuid, text) to authenticated;
comment on function public.conta_codigo_corto_poner(text, uuid, text) is
  'K13 · Cambia a mano el código corto de un local, una marca o una plataforma de tu cuenta (sin repetir en la cuenta; queda «a_mano»). Vacío: vuelve al propuesto.';

-- El relleno de lo que ya existe, cuenta a cuenta.
do $$
declare r record;
begin
  for r in select id from public.accounts order by id loop
    perform public._conta_codigo_corto_rellenar(r.id);
  end loop;
end $$;
