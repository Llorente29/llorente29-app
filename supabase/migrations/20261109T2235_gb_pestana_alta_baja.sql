-- supabase/migrations/20261109T2235_gb_pestana_alta_baja.sql
--
-- GB · Segunda parte (nº 9), punto 1 · Dar de alta y de baja a un trabajador
-- desde la pestaña «Sumied» de la ficha de Bitrix24.
--
-- No escribe en Sumied con lógica propia: llama, ACTUANDO COMO la persona que
-- mira (la misma comprobación que la lectura, conta_bitrix_pestana_leer), a las
-- MISMAS funciones que usa la ficha del cliente del G04:
--   · alta  → conta_gestoria_alta_empleado(empresa, cliente, servicio, nombre, desde)
--   · baja  → conta_gestoria_baja_linea(linea, mes)
-- Esas funciones comprueban que la persona puede cambiar lo que se cobra
-- (administrador o encargado de la cuenta): quien solo puede ver, ve
-- «sin_permiso» y no cambia nada. La línea de una baja tiene que ser del cliente
-- de la ficha abierta: desde la pestaña de un cliente no se toca otro.
--
-- Añade:
--   1. conta_bitrix_pestana_cambio: lo hecho desde la pestaña (quién, qué, la
--      frase que vio) y lo que pasó en Bitrix24 al guardar (lo escrito, o el
--      choque con un dato cambiado en Bitrix24, que no se pisa nunca).
--   2. conta_bitrix_pestana_hacer(portal, correo, tipo, ficha, acción, datos):
--      solo el servidor (conta-bitrix-pestana), DESPUÉS de comprobar con
--      Bitrix24 al usuario y la aplicación. Devuelve, además, lo que necesita la
--      función para actualizar Bitrix24 sin pisar nada: el campo de la cuota en
--      el mapa confirmado, lo que Sumied leyó en Bitrix24 y lo último que la
--      pestaña escribió.
--   3. conta_bitrix_pestana_bitrix(cambio, resultado): solo el servidor; apunta
--      lo que pasó en Bitrix24.
-- No toca nada del camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261109T2235_gb_pestana_alta_baja.down.sql

create table if not exists public.conta_bitrix_pestana_cambio (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  party_id      uuid not null references public.party(id) on delete cascade,
  tipo_ficha    text not null check (tipo_ficha in ('empresa', 'contacto')),
  id_externo    text not null,
  accion        text not null check (accion in ('alta', 'baja')),
  datos         jsonb not null default '{}'::jsonb,
  frase         text not null,
  resultado_id  uuid,
  hecho_por     uuid not null,
  hecho_por_nombre text,
  hecho_at      timestamptz not null default now(),
  bitrix        jsonb,
  bitrix_at     timestamptz
);
comment on table public.conta_bitrix_pestana_cambio is
  'GB · Lo hecho desde la pestaña «Sumied» de Bitrix24 (alta y baja de trabajadores), con la frase que vio la persona, y lo que pasó en Bitrix24 al guardar: lo escrito o el choque con un dato cambiado allí (que nunca se pisa).';
create index if not exists conta_bitrix_pestana_cambio_ficha_idx on public.conta_bitrix_pestana_cambio (account_id, tipo_ficha, id_externo, hecho_at desc);
alter table public.conta_bitrix_pestana_cambio enable row level security;
revoke all on table public.conta_bitrix_pestana_cambio from public, anon, authenticated;
grant select on table public.conta_bitrix_pestana_cambio to authenticated;
grant all on table public.conta_bitrix_pestana_cambio to service_role;
drop policy if exists conta_bitrix_pestana_cambio_leer on public.conta_bitrix_pestana_cambio;
create policy conta_bitrix_pestana_cambio_leer on public.conta_bitrix_pestana_cambio for select to authenticated using (public.belongs_to_account(account_id));
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then grant select on table public.conta_bitrix_pestana_cambio to conta_lectura; end if;
end $$;

create or replace function public.conta_bitrix_pestana_hacer(p_portal text, p_correo text, p_tipo text, p_id text, p_accion text, p_datos jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_portal text := lower(trim(coalesce(p_portal, '')));
  v_correo text := lower(trim(coalesce(p_correo, '')));
  v_id text := trim(coalesce(p_id, ''));
  v_d jsonb := coalesce(p_datos, '{}'::jsonb);
  v_cuenta uuid; v_usuario uuid; v_quien text; v_n int;
  v_cliente uuid; v_empresa uuid; v_r jsonb; v_linea public.conta_linea; v_cambio uuid;
  v_campo text; v_conocida text; v_escrita text;
begin
  if p_tipo is null or p_tipo not in ('empresa', 'contacto') or v_id !~ '^[0-9]{1,18}$' then
    return jsonb_build_object('estado', 'ficha_rara');
  end if;
  if p_accion is null or p_accion not in ('alta', 'baja') then
    return jsonb_build_object('estado', 'no_se_pudo', 'frase', 'Esa acción no se puede hacer desde la pestaña.');
  end if;
  if v_portal = '' or v_correo = '' then return jsonb_build_object('estado', 'sin_acceso'); end if;

  -- La persona, igual que en la lectura: de una cuenta con ese portal conectado, activa, con ese correo.
  select count(*), min(c.account_id::text)::uuid into v_n, v_cuenta
    from public.conta_crm c
    join public.user_profiles up on up.account_id = c.account_id and up.active
    join auth.users u on u.id = up.user_id and lower(u.email) = v_correo
   where c.crm = 'bitrix24' and lower(c.portal) = v_portal;
  if v_n = 0 then return jsonb_build_object('estado', 'sin_acceso'); end if;
  if v_n > 1 then return jsonb_build_object('estado', 'varias_cuentas'); end if;
  select up.user_id, up.display_name into v_usuario, v_quien
    from public.user_profiles up join auth.users u on u.id = up.user_id
   where up.account_id = v_cuenta and up.active and lower(u.email) = v_correo limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_usuario, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', v_usuario::text || ':' || v_cuenta::text, true);

  -- El cliente de la ficha abierta: solo se cambia lo suyo.
  select f.party_id into v_cliente from public.conta_gestoria_ficha f
   where f.account_id = v_cuenta and f.crm = 'bitrix24' and f.tipo_ficha = p_tipo and f.id_externo = v_id
   order by (f.de_empresa = '') desc, f.de_empresa limit 1;
  if v_cliente is null then
    select g.party_id into v_cliente from public.conta_gestoria_cliente g
     where g.account_id = v_cuenta and g.crm = 'bitrix24' and g.tipo_ficha = p_tipo and g.id_externo = v_id;
  end if;
  if v_cliente is null then return jsonb_build_object('estado', 'sin_enlazar'); end if;

  begin
    if p_accion = 'alta' then
      v_empresa := nullif(v_d->>'empresa', '')::uuid;
      v_r := public.conta_gestoria_alta_empleado(v_empresa, v_cliente, nullif(v_d->>'servicio', '')::uuid, v_d->>'nombre', nullif(v_d->>'desde', '')::date);
    else
      select * into v_linea from public.conta_linea where id = nullif(v_d->>'linea', '')::uuid;
      if v_linea.id is null or v_linea.account_id <> v_cuenta or v_linea.party_id <> v_cliente then
        return jsonb_build_object('estado', 'no_se_pudo', 'frase', 'Ese trabajador no es de este cliente.');
      end if;
      v_empresa := v_linea.company_id;
      v_r := public.conta_gestoria_baja_linea(v_linea.id, nullif(v_d->>'mes', '')::date);
    end if;
  exception
    when insufficient_privilege then
      return jsonb_build_object('estado', 'sin_permiso', 'frase', 'Puedes ver, pero no cambiar lo que se cobra: pídeselo a un administrador o a un encargado de la cuenta.');
    when others then
      return jsonb_build_object('estado', 'no_se_pudo', 'frase', sqlerrm);
  end;

  insert into public.conta_bitrix_pestana_cambio (account_id, party_id, tipo_ficha, id_externo, accion, datos, frase, resultado_id, hecho_por, hecho_por_nombre)
  values (v_cuenta, v_cliente, p_tipo, v_id, p_accion, v_d, coalesce(v_r->>'frase', ''), nullif(v_r->>'id', '')::uuid, v_usuario, v_quien)
  returning id into v_cambio;

  -- Para actualizar Bitrix24 sin pisar nada: el campo de la cuota en el mapa
  -- confirmado, lo que Sumied leyó allí y lo último que escribió la pestaña.
  select x->>'codigo' into v_campo from public.conta_crm c, jsonb_array_elements(coalesce(c.mapa->'campos', '[]'::jsonb)) x
   where c.account_id = v_cuenta and c.crm = 'bitrix24' and x->>'campo' = 'cuota_referencia' and x->>'etiqueta' = 'Cuota mensual'
     and coalesce(x->>'codigo', '') <> '' limit 1;
  select q->>'texto' into v_conocida from public.conta_gestoria_ficha f, jsonb_array_elements(coalesce(f.ficha->'cuotasReferencia', '[]'::jsonb)) q
   where f.account_id = v_cuenta and f.crm = 'bitrix24' and f.tipo_ficha = p_tipo and f.id_externo = v_id and q->>'etiqueta' = 'Cuota mensual' limit 1;
  select b.bitrix->>'escrito' into v_escrita from public.conta_bitrix_pestana_cambio b
   where b.account_id = v_cuenta and b.tipo_ficha = p_tipo and b.id_externo = v_id and b.bitrix ? 'escrito'
   order by b.bitrix_at desc nulls last limit 1;

  return jsonb_build_object('estado', 'ok', 'frase', v_r->>'frase', 'cambio', v_cambio, 'id', v_r->>'id', 'empresa', v_empresa, 'cliente', v_cliente,
    'bitrix', jsonb_build_object('campo', v_campo, 'conocida', v_conocida, 'escrita', v_escrita));
end $$;

create or replace function public.conta_bitrix_pestana_bitrix(p_cambio uuid, p_resultado jsonb)
returns void
language sql volatile security definer set search_path = public as $$
  update public.conta_bitrix_pestana_cambio set bitrix = p_resultado, bitrix_at = now() where id = p_cambio
$$;

revoke all on function public.conta_bitrix_pestana_hacer(text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.conta_bitrix_pestana_bitrix(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conta_bitrix_pestana_hacer(text, text, text, text, text, jsonb) to service_role;
grant execute on function public.conta_bitrix_pestana_bitrix(uuid, jsonb) to service_role;

comment on function public.conta_bitrix_pestana_hacer(text, text, text, text, text, jsonb) is
  'GB · Alta y baja de un trabajador desde la pestaña de Bitrix24. Solo el servidor (conta-bitrix-pestana), DESPUÉS de comprobar con Bitrix24 al usuario y la aplicación. Actúa como la persona («usuario:cuenta») y llama a las funciones de la ficha del G04 (conta_gestoria_alta_empleado y conta_gestoria_baja_linea), que comprueban su permiso. Solo sobre el cliente de la ficha abierta. Estados: ok, sin_permiso, no_se_pudo, sin_acceso, sin_enlazar, varias_cuentas, ficha_rara.';
comment on function public.conta_bitrix_pestana_bitrix(uuid, jsonb) is
  'GB · Apunta lo que pasó en Bitrix24 al guardar un cambio de la pestaña: lo escrito, o el choque con un dato cambiado allí (no se pisa).';
