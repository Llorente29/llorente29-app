-- supabase/migrations/20261127T1826_r21a_facturar_el_mes.sql
--
-- R21 · «Facturar el mes», paso a paso (Julio, 27/11). Lo que decide cada paso vive en
-- supabase/functions/_shared/factura/facturarMes.ts; aquí, solo lo que hace falta guardar y no existía (lo demás —el
-- cobro, las decisiones del banco, lo mandado a Cegid, las facturas de Cegid— ya está en main y no se duplica):
--
--   1 · conta_factura_pendiente (AÑADE): lo que se deja para después («Dejar para después» del paso 2). Un caso que
--       Sumied no puede decidir solo y que la persona deja fuera de esta factura: su clave (la del caso: «mov:…»,
--       «tpv:…», «ficha:…», «cegid:…»), su tipo, el mes en que se dejó, el cliente, el importe, el motivo y quién y
--       cuándo. No se borra nunca: «Deshacer» apunta quién y cuándo (deshecho_*); resolverlo, quién, cuándo y en qué mes
--       se factura (resuelto_*). Solo uno vivo por caso. (conta_propuesta_pendiente no sirve: es de las propuestas de
--       contabilidad, borra la fila al resolverse y no guarda ni quién, ni el mes, ni el importe.)
--   2 · conta_factura_visto_bueno (AÑADE): «Coincide: mandar el listado a QBO» del paso 4. Uno vivo por empresa, mes y
--       serie, con el total y el número de facturas que dio Cegid, quién y cuándo. Uno nuevo sustituye al anterior, que
--       queda guardado (sustituido_*).
--   3 · Sus funciones, como conta_banco_decidir (solo quien puede en la gestoría, _conta_gestoria_puede): dejar,
--       deshacer y resolver un pendiente, y dar el visto bueno. Cada una devuelve su frase.
--
-- Solo añade (dos tablas y cuatro funciones nuevas; se puede pasar dos veces). No toca el cobro, las decisiones del
-- banco, lo mandado a Cegid ni las facturas. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261127T1826_r21a_facturar_el_mes.down.sql

-- 1 · Lo dejado para después
create table if not exists public.conta_factura_pendiente (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  company_id        uuid not null references public.company(id) on delete cascade,
  clave             text not null check (clave ~ '^(mov|tpv|gc|ficha|cegid):.+$' and length(clave) <= 200),
  tipo              text not null check (tipo in ('paga_factura_antes', 'paga_sin_recibo', 'no_se_sabe_quien', 'sin_unir_cegid', 'falta_dato_cegid', 'sin_datos')),
  mes               date not null check (mes = date_trunc('month', mes)::date),
  cliente           text,
  importe           numeric(14,2) not null check (importe >= 0),
  motivo            text not null check (length(trim(motivo)) > 0 and length(motivo) <= 500),
  dejado_por        text,
  dejado_por_id     uuid,
  dejado_at         timestamptz not null default now(),
  deshecho_por      text,
  deshecho_por_id   uuid,
  deshecho_at       timestamptz,
  resuelto_por      text,
  resuelto_por_id   uuid,
  resuelto_at       timestamptz,
  resuelto_mes      date check (resuelto_mes is null or resuelto_mes = date_trunc('month', resuelto_mes)::date),
  check (deshecho_at is null or resuelto_at is null),
  check ((resuelto_at is null) = (resuelto_mes is null))
);
create unique index if not exists conta_factura_pendiente_vivo on public.conta_factura_pendiente (company_id, clave) where deshecho_at is null and resuelto_at is null;
create index if not exists conta_factura_pendiente_empresa on public.conta_factura_pendiente (company_id, mes);
comment on table public.conta_factura_pendiente is
  'R21 · Lo dejado para después en «Facturar el mes»: fuera de esta factura hasta resolverlo, con quién, cuándo, el mes, el cliente, el importe y el motivo. Nunca se borra: deshacer y resolver se apuntan. Uno vivo por caso.';
alter table public.conta_factura_pendiente enable row level security;
drop policy if exists conta_factura_pendiente_leer on public.conta_factura_pendiente;
create policy conta_factura_pendiente_leer on public.conta_factura_pendiente for select to authenticated using (public.belongs_to_account(account_id));
revoke all on public.conta_factura_pendiente from anon;
grant select on public.conta_factura_pendiente to authenticated;
grant all on public.conta_factura_pendiente to service_role;

-- 2 · El visto bueno de QBO
create table if not exists public.conta_factura_visto_bueno (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  company_id         uuid not null references public.company(id) on delete cascade,
  mes                date not null check (mes = date_trunc('month', mes)::date),
  serie              text not null check (serie ~ '^[0-9A-Z]{1,5}$'),
  total              numeric(14,2) not null,
  facturas           int not null check (facturas >= 0),
  quien              text,
  quien_id           uuid,
  at                 timestamptz not null default now(),
  sustituido_por     text,
  sustituido_por_id  uuid,
  sustituido_at      timestamptz
);
create unique index if not exists conta_factura_visto_bueno_vivo on public.conta_factura_visto_bueno (company_id, mes, serie) where sustituido_at is null;
comment on table public.conta_factura_visto_bueno is
  'R21 · «Coincide: mandar el listado a QBO» de «Facturar el mes»: el total y el número de facturas que dio Cegid al precalcular, quién y cuándo. Uno vivo por empresa, mes y serie; uno nuevo sustituye al anterior, que queda guardado.';
alter table public.conta_factura_visto_bueno enable row level security;
drop policy if exists conta_factura_visto_bueno_leer on public.conta_factura_visto_bueno;
create policy conta_factura_visto_bueno_leer on public.conta_factura_visto_bueno for select to authenticated using (public.belongs_to_account(account_id));
revoke all on public.conta_factura_visto_bueno from anon;
grant select on public.conta_factura_visto_bueno to authenticated;
grant all on public.conta_factura_visto_bueno to service_role;

-- 3 · Las funciones
create or replace function public.conta_factura_dejar(p_company uuid, p_clave text, p_tipo text, p_mes date, p_cliente text, p_importe numeric, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $dejar$
declare
  v_cuenta uuid := public._conta_gestoria_puede(p_company);
  v_id uuid;
begin
  if p_mes is null or p_mes <> date_trunc('month', p_mes)::date then raise exception 'El mes va como el día 1 del mes.' using errcode = '22023'; end if;
  if coalesce(p_importe, -1) < 0 then raise exception 'Falta el importe.' using errcode = '22023'; end if;
  if nullif(trim(coalesce(p_motivo, '')), '') is null then raise exception 'Falta por qué se deja para después.' using errcode = '22023'; end if;
  if exists (select 1 from public.conta_factura_pendiente where company_id = p_company and clave = p_clave and deshecho_at is null and resuelto_at is null) then
    raise exception 'Este caso ya está en Pendientes.' using errcode = '55000';
  end if;
  insert into public.conta_factura_pendiente (account_id, company_id, clave, tipo, mes, cliente, importe, motivo, dejado_por, dejado_por_id)
  values (v_cuenta, p_company, p_clave, p_tipo, p_mes, nullif(trim(coalesce(p_cliente, '')), ''), p_importe, trim(p_motivo), public.conta_nombre_actor(), auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'frase', format('Dejado para después: %s € quedan en Pendientes, fuera de esta factura. Cuando se resuelva, se factura en el mes en que se resuelva, con su mes en la descripción.',
    translate(to_char(p_importe, 'FM999G999G990D00'), ',.', '.,')));
end $dejar$;
comment on function public.conta_factura_dejar(uuid, text, text, date, text, numeric, text) is
  'R21 · «Dejar para después»: el caso queda en Pendientes, fuera de esta factura, con quién, cuándo, el mes, el cliente, el importe y el motivo. Solo quien puede en la gestoría.';

create or replace function public.conta_factura_deshacer_pendiente(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $deshacer$
declare v_p public.conta_factura_pendiente;
begin
  select * into v_p from public.conta_factura_pendiente where id = p_id;
  if v_p.id is null then raise exception 'Ese pendiente no existe.' using errcode = 'P0002'; end if;
  perform public._conta_gestoria_puede(v_p.company_id);
  if v_p.deshecho_at is not null or v_p.resuelto_at is not null then raise exception 'Ese pendiente ya no está en Pendientes.' using errcode = '55000'; end if;
  update public.conta_factura_pendiente set deshecho_por = public.conta_nombre_actor(), deshecho_por_id = auth.uid(), deshecho_at = now() where id = p_id;
  return jsonb_build_object('id', p_id, 'frase', 'Deshecho: el caso vuelve a estar por resolver.');
end $deshacer$;
comment on function public.conta_factura_deshacer_pendiente(uuid) is
  'R21 · «Deshacer» de «Dejar para después»: apunta quién y cuándo; no borra. El caso vuelve a estar por resolver.';

create or replace function public.conta_factura_resolver_pendiente(p_id uuid, p_mes date)
returns jsonb language plpgsql security definer set search_path = public as $resolver$
declare v_p public.conta_factura_pendiente;
begin
  select * into v_p from public.conta_factura_pendiente where id = p_id;
  if v_p.id is null then raise exception 'Ese pendiente no existe.' using errcode = 'P0002'; end if;
  perform public._conta_gestoria_puede(v_p.company_id);
  if v_p.deshecho_at is not null or v_p.resuelto_at is not null then raise exception 'Ese pendiente ya no está en Pendientes.' using errcode = '55000'; end if;
  if p_mes is null or p_mes <> date_trunc('month', p_mes)::date or p_mes < v_p.mes then raise exception 'Se factura en el mes en que se resuelve, no antes del que se dejó.' using errcode = '22023'; end if;
  update public.conta_factura_pendiente set resuelto_por = public.conta_nombre_actor(), resuelto_por_id = auth.uid(), resuelto_at = now(), resuelto_mes = p_mes where id = p_id;
  return jsonb_build_object('id', p_id, 'frase', format('Resuelto: sale de Pendientes y se factura en %s%s.', public._conta_gestoria_mes(p_mes),
    case when p_mes > v_p.mes then format(', con «%s» en la descripción', public._conta_gestoria_mes(v_p.mes)) else '' end));
end $resolver$;
comment on function public.conta_factura_resolver_pendiente(uuid, date) is
  'R21 · Un pendiente resuelto: sale de Pendientes y se factura en el mes en que se resuelve (con su mes en la descripción si es otro). Apunta quién y cuándo; no borra.';

create or replace function public.conta_factura_visto_bueno_dar(p_company uuid, p_mes date, p_serie text, p_total numeric, p_facturas int)
returns jsonb language plpgsql security definer set search_path = public as $visto$
declare
  v_cuenta uuid := public._conta_gestoria_puede(p_company);
  v_s text := nullif(upper(trim(coalesce(p_serie, ''))), '');
  v_id uuid;
begin
  if p_mes is null or p_mes <> date_trunc('month', p_mes)::date then raise exception 'El mes va como el día 1 del mes.' using errcode = '22023'; end if;
  if v_s is null or v_s !~ '^[0-9A-Z]{1,5}$' then raise exception 'Falta la serie de Cegid.' using errcode = '22023'; end if;
  if p_total is null or coalesce(p_facturas, -1) < 0 then raise exception 'Faltan el total y el número de facturas que da Cegid.' using errcode = '22023'; end if;
  update public.conta_factura_visto_bueno set sustituido_por = public.conta_nombre_actor(), sustituido_por_id = auth.uid(), sustituido_at = now()
   where company_id = p_company and mes = p_mes and serie = v_s and sustituido_at is null;
  insert into public.conta_factura_visto_bueno (account_id, company_id, mes, serie, total, facturas, quien, quien_id)
  values (v_cuenta, p_company, p_mes, v_s, p_total, p_facturas, public.conta_nombre_actor(), auth.uid()) returning id into v_id;
  return jsonb_build_object('id', v_id, 'frase', format('Apuntado: Cegid da %s € en %s facturas de la serie %s de %s. Listado para QBO.',
    translate(to_char(p_total, 'FM999G999G990D00'), ',.', '.,'), p_facturas, v_s, public._conta_gestoria_mes(p_mes)));
end $visto$;
comment on function public.conta_factura_visto_bueno_dar(uuid, date, text, numeric, int) is
  'R21 · «Coincide: mandar el listado a QBO»: apunta el total y el número de facturas que dio Cegid, quién y cuándo. Uno vivo por empresa, mes y serie; el anterior queda sustituido.';

revoke all on function public.conta_factura_dejar(uuid, text, text, date, text, numeric, text) from public, anon;
revoke all on function public.conta_factura_deshacer_pendiente(uuid) from public, anon;
revoke all on function public.conta_factura_resolver_pendiente(uuid, date) from public, anon;
revoke all on function public.conta_factura_visto_bueno_dar(uuid, date, text, numeric, int) from public, anon;
grant execute on function public.conta_factura_dejar(uuid, text, text, date, text, numeric, text) to authenticated;
grant execute on function public.conta_factura_deshacer_pendiente(uuid) to authenticated;
grant execute on function public.conta_factura_resolver_pendiente(uuid, date) to authenticated;
grant execute on function public.conta_factura_visto_bueno_dar(uuid, date, text, numeric, int) to authenticated;
