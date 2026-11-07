-- supabase/migrations/20261107T1110_g01b_union_fichas.sql
--
-- G01b · La unión de las fichas repetidas de Bitrix24 (Julio, 07/11, tras el
-- recuento de repetidos: 21 NIF en 52 fichas). La regla vive en la función
-- (conta-bitrix-leer/clientes.ts); aquí se guarda lo que dice:
--
-- cambia: public.conta_gestoria_diferencia · prueba: supabase/staging/sql/20261107_g01b_union_fichas_prueba.sql
-- cambia: public.conta_bitrix_confirmar_mapa · prueba: supabase/staging/sql/20261107_g01b_union_fichas_prueba.sql
--
--   1. conta_gestoria_diferencia.tipo admite «fichas_repetidas» (un cliente
--      con varias fichas), «nif_no_valido» (una ficha que entra sin NIF) y
--      «ficha_no_guardada» (una ficha que ha fallado: la lectura sigue). Solo
--      amplía el CHECK.
--   2. conta_gestoria_ficha (nueva): cada ficha de Bitrix24 y el cliente de
--      Sumied del que es. Se rellena con las que ya hay.
--   3. conta_bitrix_guardar_clientes (nueva): guarda los clientes ya unidos,
--      cada uno en su propia subtransacción. Uno que falla no tumba la
--      lectura: se devuelve con su porqué y los demás se guardan.
--   4. conta_bitrix_aplicar_union (nueva): una persona administradora o
--      encargada aplica la unión después de ver el ensayo en PDF. Sin
--      aplicar, la lectura no une nada.
--   5. conta_bitrix_confirmar_mapa (la misma firma): no deja confirmar un
--      campo con una contraseña o un certificado, y conserva la unión
--      aplicada.
-- No lee ni escribe nada en Bitrix24. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261107T1110_g01b_union_fichas.down.sql

-- 1 · Los tipos de diferencia nuevos (solo amplía).
alter table public.conta_gestoria_diferencia drop constraint if exists conta_gestoria_diferencia_tipo_check;
alter table public.conta_gestoria_diferencia add constraint conta_gestoria_diferencia_tipo_check check (tipo in (
  'bitrix_sin_cobro', 'gocardless_sin_ficha', 'emisor_distinto', 'nif_repetido_en_bitrix',
  'correo_repetido_en_bitrix', 'nif_distinto', 'suscripcion_sin_convertir', 'totales_distintos',
  'mandato_por_firmar', 'falla_a_menudo', 'abono_en_otra_cuenta',
  'fichas_repetidas', 'nif_no_valido', 'ficha_no_guardada'));

-- 2 · Cada ficha de Bitrix24, con su cliente.
create table if not exists public.conta_gestoria_ficha (
  account_id    uuid not null references public.accounts(id) on delete cascade,
  bitrix_id     text not null,
  party_id      uuid not null references public.party(id) on delete cascade,
  situacion     text check (situacion is null or situacion in ('activo', 'baja', 'moroso', 'solo_renta', 'sin_clasificar')),
  ficha         jsonb,
  huella        text,
  leido_at      timestamptz,
  created_at    timestamptz not null default now(),
  primary key (account_id, bitrix_id)
);
comment on table public.conta_gestoria_ficha is
  'G01b · Cada ficha de Bitrix24 y el cliente de Sumied del que es. Un cliente puede tener varias (el mismo NIF, tras aplicar la unión); la de su situación más viva es la de conta_gestoria_cliente.';
create index if not exists conta_gestoria_ficha_party_idx on public.conta_gestoria_ficha (party_id);
alter table public.conta_gestoria_ficha enable row level security;
revoke all on table public.conta_gestoria_ficha from public, anon, authenticated;
grant select on table public.conta_gestoria_ficha to authenticated;
drop policy if exists conta_gestoria_ficha_leer on public.conta_gestoria_ficha;
create policy conta_gestoria_ficha_leer on public.conta_gestoria_ficha for select to authenticated using (public.belongs_to_account(account_id));
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then grant select on table public.conta_gestoria_ficha to conta_lectura; end if;
end $$;
insert into public.conta_gestoria_ficha (account_id, bitrix_id, party_id, situacion, ficha, huella, leido_at)
select c.account_id, c.bitrix_id, c.party_id, c.situacion, c.ficha, c.huella, c.leido_at
  from public.conta_gestoria_cliente c where c.bitrix_id is not null
on conflict (account_id, bitrix_id) do nothing;

-- ¿Un campo de Bitrix24 guarda una contraseña o un certificado? Por su tipo o su etiqueta (como clientes.ts · esCampoSensible).
create or replace function public._conta_bitrix_campo_sensible(p_campo jsonb)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_campo->>'type', '') in ('file', 'password')
      or exists (select 1 from unnest(array[p_campo->>'formLabel', p_campo->>'listLabel', p_campo->>'title']) t
                  where t is not null and translate(upper(t), 'ÁÉÍÓÚÜÑ', 'AEIOUUN')
                    ~ '(^|[^A-Z0-9])(CLAVE|CLAVES|CONTRASENA|CONTRASENAS|PASSWORD|PASSWD|PASS|PIN|USUARIO|USER|LOGIN|CREDENCIAL|CREDENCIALES|TOKEN|SECRETO|CL@VE)($|[^A-Z0-9])')
$$;
revoke all on function public._conta_bitrix_campo_sensible(jsonb) from public, anon;

-- 3 · Los clientes ya unidos (clientes.ts · agrupar), cada uno en su subtransacción.
-- Cada cliente: { clave, nif, situacion, motivo, principal: ficha, fichas: [ficha…] }.
create or replace function public.conta_bitrix_guardar_clientes(p_account uuid, p_clientes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c jsonb; f jsonb; v_p jsonb; v_ids text[]; v_partes uuid[]; v_party uuid; v_huella text; v_antes text; v_nif text; v_nif_bitrix text;
        v_motivo text; v_nuevos int := 0; v_cambiados int := 0; v_iguales int := 0; v_errores jsonb := '[]'::jsonb; v_otras jsonb; v_porque text;
begin
  if not exists (select 1 from public.accounts where id = p_account) then raise exception 'La cuenta no existe.' using errcode = 'P0002'; end if;
  for c in select * from jsonb_array_elements(coalesce(p_clientes, '[]'::jsonb)) loop
    v_p := c->'principal';
    v_ids := array(select x->>'bitrixId' from jsonb_array_elements(coalesce(c->'fichas', '[]'::jsonb)) x where coalesce(x->>'bitrixId', '') <> '');
    if coalesce(v_p->>'bitrixId', '') = '' or cardinality(v_ids) = 0 then continue; end if;
    begin
      v_huella := md5(c::text);
      v_motivo := nullif(c->>'motivo', '');
      v_nif := nullif(public.party_nif(nullif(c->>'nif', '')), '');
      v_nif_bitrix := nullif(public.party_nif(nullif(v_p->>'nif', '')), '');
      -- El cliente: el de sus fichas (si ya estaban) o, si no, el de su NIF.
      select coalesce(array_agg(distinct x.party_id), '{}') into v_partes from (
        select party_id from public.conta_gestoria_ficha where account_id = p_account and bitrix_id = any(v_ids)
        union select party_id from public.conta_gestoria_cliente where account_id = p_account and bitrix_id = any(v_ids)) x;
      if cardinality(v_partes) > 1 then
        raise exception 'sus % fichas de Bitrix24 ya son % clientes distintos en Sumied', cardinality(v_ids), cardinality(v_partes) using errcode = 'P0001';
      end if;
      v_party := v_partes[1];
      -- Por su NIF, solo con la unión aplicada (clave «nif:…»): sin aplicar no se une nada, ni a escondidas.
      if v_party is null and v_nif is not null and c->>'clave' like 'nif:%' then
        select id into v_party from public.party where account_id = p_account and tax_id = v_nif;
        if exists (select 1 from public.conta_gestoria_cliente g where g.party_id = v_party and g.bitrix_id <> all(v_ids)) then
          raise exception 'su NIF ya es de otro cliente de Sumied, con otra ficha de Bitrix24' using errcode = 'P0001';
        end if;
      end if;
      select g.huella into v_antes from public.conta_gestoria_cliente g where g.party_id = v_party;
      if v_party is null then
        insert into public.party (account_id, name, tax_id, source, created_by_name)
        values (p_account, coalesce(nullif(trim(v_p->>'nombre'), ''), 'Empresa ' || (v_p->>'bitrixId') || ' de Bitrix24'), v_nif, 'crm', 'Bitrix24')
        returning id into v_party;
        v_nuevos := v_nuevos + 1;
      elsif v_antes is distinct from v_huella then
        -- Un NIF que no se usa (sin formato o en 10 fichas o más) se quita si era el que se le puso antes.
        update public.party set name = coalesce(nullif(trim(v_p->>'nombre'), ''), name),
               tax_id = case when v_motivo in ('nif_no_valido', 'nif_en_muchas') and tax_id is not distinct from v_nif_bitrix then null else coalesce(v_nif, tax_id) end,
               updated_at = now()
         where id = v_party and account_id = p_account;
        v_cambiados := v_cambiados + 1;
      else
        v_iguales := v_iguales + 1;
        update public.conta_gestoria_cliente set leido_at = now() where party_id = v_party;
        update public.conta_gestoria_ficha set leido_at = now() where account_id = p_account and bitrix_id = any(v_ids);
        continue;
      end if;
      insert into public.customer_fiscal (party_id, account_id, legal_name, fiscal_street, fiscal_postal_code, fiscal_city, fiscal_province)
      values (v_party, p_account, nullif(trim(v_p->>'nombre'), ''), nullif(v_p->>'calle', ''), nullif(v_p->>'cp', ''), nullif(v_p->>'poblacion', ''), nullif(v_p->>'provincia', ''))
      on conflict (party_id) do update set legal_name = coalesce(excluded.legal_name, customer_fiscal.legal_name),
        fiscal_street = excluded.fiscal_street, fiscal_postal_code = excluded.fiscal_postal_code, fiscal_city = excluded.fiscal_city,
        fiscal_province = excluded.fiscal_province, updated_at = now();
      -- Las otras fichas del cliente, para la ficha («Lo que dice Bitrix24»).
      select coalesce(jsonb_agg(jsonb_build_object('bitrixId', x->>'bitrixId', 'nombre', x->>'nombre', 'situacion', x->'situacion', 'situacionTexto', x->'situacionTexto')), '[]'::jsonb)
        into v_otras from jsonb_array_elements(c->'fichas') x where x->>'bitrixId' <> v_p->>'bitrixId';
      insert into public.conta_gestoria_cliente (party_id, account_id, bitrix_id, situacion, servicios, forma_pago_bitrix, emisor_segun_bitrix, ficha, huella, leido_at)
      values (v_party, p_account, v_p->>'bitrixId', nullif(c->>'situacion', ''),
              coalesce(array(select jsonb_array_elements_text(v_p->'servicios')), '{}'), nullif(v_p->>'formaPago', ''),
              (select id from public.company where id::text = v_p->>'emisorSegunBitrix' and account_id = p_account),
              v_p || jsonb_build_object('otrasFichas', v_otras, 'motivo', v_motivo), v_huella, now())
      on conflict (party_id) do update set bitrix_id = excluded.bitrix_id, situacion = excluded.situacion, servicios = excluded.servicios,
        forma_pago_bitrix = excluded.forma_pago_bitrix, emisor_segun_bitrix = excluded.emisor_segun_bitrix, ficha = excluded.ficha,
        huella = excluded.huella, leido_at = now();
      for f in select * from jsonb_array_elements(c->'fichas') loop
        insert into public.conta_gestoria_ficha (account_id, bitrix_id, party_id, situacion, ficha, huella, leido_at)
        values (p_account, f->>'bitrixId', v_party, nullif(f->>'situacion', ''), f, md5(f::text), now())
        on conflict (account_id, bitrix_id) do update set party_id = excluded.party_id, situacion = excluded.situacion,
          ficha = excluded.ficha, huella = excluded.huella, leido_at = now();
      end loop;
      -- Una ficha que ya no es de este cliente deja de colgar de él (la recoge el suyo).
      delete from public.conta_gestoria_ficha where account_id = p_account and party_id = v_party and bitrix_id <> all(v_ids);
    exception when others then
      v_porque := case when sqlstate = '23505' and sqlerrm like '%ux_party_nif%' then 'su NIF ya es de otro cliente de Sumied'
                       when sqlstate = '23505' then 'choca con otro cliente de Sumied (' || sqlerrm || ')'
                       else sqlerrm end;
      v_errores := v_errores || jsonb_build_array(jsonb_build_object('bitrixIds', to_jsonb(v_ids), 'nombre', v_p->>'nombre',
        'emisor', v_p->>'emisorSegunBitrix', 'codigo', sqlstate, 'porque', v_porque));
    end;
  end loop;
  return jsonb_build_object('nuevos', v_nuevos, 'cambiados', v_cambiados, 'iguales', v_iguales, 'errores', v_errores);
end $$;
revoke all on function public.conta_bitrix_guardar_clientes(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conta_bitrix_guardar_clientes(uuid, jsonb) to service_role;

-- 4 · Aplicar la unión (después de ver el ensayo).
create or replace function public.conta_bitrix_aplicar_union(p_account uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_b public.conta_crm_bitrix; v_quien text := public.conta_nombre_actor(); v_union jsonb;
begin
  if not public.current_user_is_admin_or_manager_of(p_account) then
    raise exception 'Solo un administrador o un encargado de la cuenta aplica la unión de las fichas de Bitrix24.' using errcode = '42501';
  end if;
  select * into v_b from public.conta_crm_bitrix where account_id = p_account for update;
  if v_b.account_id is null then raise exception 'Esta cuenta no tiene conectado Bitrix24.' using errcode = 'P0002'; end if;
  if v_b.mapa->'confirmado' is null or v_b.mapa->'confirmado' = 'null'::jsonb then
    raise exception 'Primero hay que confirmar el mapa en «Qué es cada campo».' using errcode = '22023';
  end if;
  v_union := jsonb_build_object('quien', v_quien, 'cuando', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  update public.conta_crm_bitrix set mapa = mapa || jsonb_build_object('union', v_union), updated_at = now() where account_id = p_account;
  return jsonb_build_object('frase', format('Unión aplicada por %s: la próxima lectura une las fichas de Bitrix24 con el mismo NIF en un solo cliente.',
    coalesce(v_quien, 'una persona de la cuenta')), 'union', v_union);
end $$;
comment on function public.conta_bitrix_aplicar_union(uuid) is
  'G01b · Aplica la unión de las fichas repetidas de Bitrix24 (mismo NIF = un cliente), después de ver el ensayo en PDF. Sin aplicar, la lectura no une nada.';
revoke all on function public.conta_bitrix_aplicar_union(uuid) from public, anon;
grant execute on function public.conta_bitrix_aplicar_union(uuid) to authenticated, service_role;

-- 5 · Confirmar el mapa: sin campos con contraseñas o certificados, y sin perder la unión.
-- La de antes se guarda (_respaldar_funcion): la vuelta atrás la devuelve byte a byte.
select public._respaldar_funcion('public.conta_bitrix_confirmar_mapa(uuid,jsonb)', '20261107T1110_g01b_union_fichas');
create or replace function public.conta_bitrix_confirmar_mapa(p_account uuid, p_mapa jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_b public.conta_crm_bitrix; v_c jsonb; v_cod text; v_faltan text[] := '{}'; v_sit jsonb; v_it jsonb; v_op text;
        v_sin_op text[] := '{}'; v_quien text := public.conta_nombre_actor(); v_mapa jsonb; v_n int; v_frase text;
        v_validas constant text[] := array['activo', 'baja', 'moroso', 'solo_renta', 'sin_clasificar'];
begin
  if not public.current_user_is_admin_or_manager_of(p_account) then
    raise exception 'Solo un administrador o un encargado de la cuenta confirma el mapa de Bitrix24.' using errcode = '42501';
  end if;
  select * into v_b from public.conta_crm_bitrix where account_id = p_account for update;
  if v_b.account_id is null then raise exception 'Esta cuenta no tiene conectado Bitrix24.' using errcode = 'P0002'; end if;
  if v_b.campos_medidos is null then raise exception 'Faltan los campos medidos del portal: vuelve a conectar Bitrix24.' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_mapa) is distinct from 'object' or jsonb_typeof(p_mapa->'campos') is distinct from 'array' then
    raise exception 'El mapa no trae sus campos.' using errcode = '22023';
  end if;

  -- Cada código del mapa (campos y fuentes de la dirección) tiene que existir en lo medido del portal.
  for v_cod in
    select c->>'codigo' from jsonb_array_elements(p_mapa->'campos') c where coalesce(c->>'codigo', '') <> ''
    union all
    select x from jsonb_array_elements(coalesce(p_mapa->'direcciones', '[]'::jsonb)) d,
           lateral (values (d->>'calle'), (d->>'cp'), (d->>'poblacion'), (d->>'provincia')) v(x) where coalesce(x, '') <> ''
  loop
    if not (v_b.campos_medidos ? v_cod) then v_faltan := v_faltan || v_cod; end if;
  end loop;
  if cardinality(v_faltan) > 0 then
    raise exception 'Este Bitrix24 no tiene estos campos: %.', array_to_string(v_faltan, ', ') using errcode = '22023';
  end if;

  -- G01b · Un campo con una contraseña o un certificado no se lee nunca, aunque se elija por error (por su tipo o su etiqueta).
  select coalesce(array_agg(x order by x), '{}') into v_faltan from (
    select distinct coalesce(nullif(trim(m->>'formLabel'), ''), nullif(trim(m->>'listLabel'), ''), m->>'title', k) x
      from jsonb_each(v_b.campos_medidos) e(k, m)
     where k in (select c->>'codigo' from jsonb_array_elements(p_mapa->'campos') c
                 union all
                 select y from jsonb_array_elements(coalesce(p_mapa->'direcciones', '[]'::jsonb)) d,
                   lateral (values (d->>'calle'), (d->>'cp'), (d->>'poblacion'), (d->>'provincia')) v(y))
       and public._conta_bitrix_campo_sensible(m)) s;
  if cardinality(v_faltan) > 0 then
    raise exception 'Estos campos guardan contraseñas o certificados y no se leen nunca: %.', array_to_string(v_faltan, ', ') using errcode = '22023';
  end if;

  -- La situación: un solo campo, y cada opción suya dice qué es en Sumied.
  select count(*) into v_n from jsonb_array_elements(p_mapa->'campos') c where c->>'campo' = 'situacion' and coalesce(c->>'codigo', '') <> '';
  if v_n <> 1 then raise exception 'Falta decir qué campo de Bitrix24 es la situación del cliente.' using errcode = '22023'; end if;
  select c into v_sit from jsonb_array_elements(p_mapa->'campos') c where c->>'campo' = 'situacion' and coalesce(c->>'codigo', '') <> '';
  for v_it in select * from jsonb_array_elements(coalesce(v_b.campos_medidos->(v_sit->>'codigo')->'items', '[]'::jsonb)) loop
    v_op := v_sit->'opciones'->>(v_it->>'ID');
    if v_op is null or not (v_op = any (v_validas)) then v_sin_op := v_sin_op || (v_it->>'VALUE'); end if;
  end loop;
  if cardinality(v_sin_op) > 0 then
    raise exception 'Falta decir qué es en Sumied: %.', array_to_string(v_sin_op, ', ') using errcode = '22023';
  end if;

  -- G01b · La unión aplicada se conserva al volver a confirmar.
  v_mapa := (p_mapa - 'dudas' - 'union') || jsonb_build_object('union', v_b.mapa->'union') || jsonb_build_object('dudas', '[]'::jsonb,
    'confirmado', jsonb_build_object('quien', v_quien, 'cuando', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  update public.conta_crm_bitrix set mapa = v_mapa, updated_at = now() where account_id = p_account;

  select count(*) into v_n from jsonb_array_elements(p_mapa->'campos') c where coalesce(c->>'codigo', '') <> '';
  v_frase := format('Mapa de Bitrix24 confirmado por %s: %s campos y %s fuentes de la dirección. La situación se guarda desde la próxima lectura.',
    coalesce(v_quien, 'una persona de la cuenta'), v_n, jsonb_array_length(coalesce(p_mapa->'direcciones', '[]'::jsonb)));
  return jsonb_build_object('frase', v_frase, 'confirmado', v_mapa->'confirmado');
end $$;
