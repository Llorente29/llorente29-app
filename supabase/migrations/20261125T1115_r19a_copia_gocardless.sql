-- supabase/migrations/20261125T1115_r19a_copia_gocardless.sql
--
-- R19 · paso 0 · La copia de GoCardless (Julio, 25/11: «antes de cambiar nada en Sumied, guarda una copia de todo lo
-- que hay en GoCardless»). Solo AÑADE: dos tablas nuevas y tres funciones nuevas. No cambia nada de lo que existe.
--
--   · conta_gc_copia: una copia por lectura de GoCardless de una empresa (cada noche, «Leer ahora» o al conectar),
--     fechada, con quién la pidió, cuántos clientes, mandatos, suscripciones y cobros guarda y su huella (md5).
--   · conta_gc_copia_fila: lo copiado, fila a fila, tal como estaba en Sumied justo después de leer GoCardless y ANTES
--     de que la lectura toque nada de Sumied (líneas, tarifas, recibos): clientes, mandatos, suscripciones con su
--     importe y su próximo cobro, y cobros.
--   · Las dos, SIN PODER CAMBIARSE: un disparador para cualquier update, delete o truncate. Solo se añaden copias.
--   · conta_gc_copia_tomar(empresa, lectura, por, quién): la toma. Solo el servidor (la lectura de GoCardless).
--   · conta_gc_contar_copia(copia, mes): LA FORMA DE CONTAR, la única (Julio, 25/11: «Q la usará también»):
--       lo que GoCardless cobrará en el mes M, por empresa, son las suscripciones en estado «active» con su próximo
--       cobro (proximo_cobro_fecha) dentro de M; sus euros, la suma de su proximo_cobro_importe; sus clientes, los
--       distintos clientes de GoCardless (gc_cliente_id) de esas suscripciones. Si no se dice M, es el mes del próximo
--       cobro más cercano desde el día de la copia. Lee la copia, no lo vivo: el mismo número para siempre.
--   · conta_gc_copias(empresa): la lista para Clientes y cuotas (y su Excel), con lo que cuenta cada una.
-- Vuelta atrás: supabase/vuelta-atras/20261125T1115_r19a_copia_gocardless.down.sql (quita las tablas y las copias).

create table if not exists public.conta_gc_copia (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null,
  company_id     uuid not null,
  tomada_at      timestamptz not null default now(),
  lectura_id     uuid,
  por            text not null check (por in ('persona', 'cada_noche', 'conexion', 'aviso')),
  quien_name     text,
  clientes       integer not null,
  mandatos       integer not null,
  suscripciones  integer not null,
  cobros         integer not null,
  huella         text not null
);
create index if not exists conta_gc_copia_empresa_idx on public.conta_gc_copia (company_id, tomada_at desc);
comment on table public.conta_gc_copia is
  'R19 · Una copia de lo que hay en GoCardless de una empresa, por lectura, fechada y sin poder cambiarse. Lo que cuenta: conta_gc_contar_copia.';

create table if not exists public.conta_gc_copia_fila (
  copia_id    uuid not null references public.conta_gc_copia(id),
  account_id  uuid not null,
  tipo        text not null check (tipo in ('cliente', 'mandato', 'suscripcion', 'cobro')),
  gc_id       text not null,
  datos       jsonb not null,
  primary key (copia_id, tipo, gc_id)
);
comment on table public.conta_gc_copia_fila is
  'R19 · Lo copiado de GoCardless, fila a fila (clientes, mandatos, suscripciones y cobros), tal como se leyó. Sin poder cambiarse.';

-- Sin poder cambiarse: ni update, ni delete, ni truncate. Solo se añaden copias (la vuelta atrás quita las tablas).
create or replace function public._conta_gc_copia_no_se_cambia()
returns trigger language plpgsql as $$
begin
  raise exception 'La copia de GoCardless no se cambia ni se borra: se guarda tal cual se leyó.' using errcode = '42501';
end $$;
drop trigger if exists conta_gc_copia_no_se_cambia on public.conta_gc_copia;
create trigger conta_gc_copia_no_se_cambia before update or delete on public.conta_gc_copia
  for each row execute function public._conta_gc_copia_no_se_cambia();
drop trigger if exists conta_gc_copia_no_se_vacia on public.conta_gc_copia;
create trigger conta_gc_copia_no_se_vacia before truncate on public.conta_gc_copia
  for each statement execute function public._conta_gc_copia_no_se_cambia();
drop trigger if exists conta_gc_copia_fila_no_se_cambia on public.conta_gc_copia_fila;
create trigger conta_gc_copia_fila_no_se_cambia before update or delete on public.conta_gc_copia_fila
  for each row execute function public._conta_gc_copia_no_se_cambia();
drop trigger if exists conta_gc_copia_fila_no_se_vacia on public.conta_gc_copia_fila;
create trigger conta_gc_copia_fila_no_se_vacia before truncate on public.conta_gc_copia_fila
  for each statement execute function public._conta_gc_copia_no_se_cambia();

alter table public.conta_gc_copia enable row level security;
alter table public.conta_gc_copia_fila enable row level security;
revoke all on table public.conta_gc_copia, public.conta_gc_copia_fila from public, anon, authenticated;
grant select on table public.conta_gc_copia, public.conta_gc_copia_fila to authenticated;
grant select, insert on table public.conta_gc_copia, public.conta_gc_copia_fila to service_role;
drop policy if exists conta_gc_copia_leer on public.conta_gc_copia;
create policy conta_gc_copia_leer on public.conta_gc_copia for select to authenticated using (public.belongs_to_account(account_id));
drop policy if exists conta_gc_copia_fila_leer on public.conta_gc_copia_fila;
create policy conta_gc_copia_fila_leer on public.conta_gc_copia_fila for select to authenticated using (public.belongs_to_account(account_id));
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on public.conta_gc_copia, public.conta_gc_copia_fila to conta_lectura;
  end if;
end $$;

-- La forma de contar: la única. Lee la copia, no lo vivo.
create or replace function public.conta_gc_contar_copia(p_copia uuid, p_mes date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_dia date; v_mes date; v_r jsonb;
begin
  select (c.tomada_at at time zone 'Europe/Madrid')::date into v_dia from public.conta_gc_copia c
   where c.id = p_copia and (coalesce(auth.role(), '') = 'service_role' or public.belongs_to_account(c.account_id));
  if v_dia is null then return null; end if;
  v_mes := date_trunc('month', coalesce(p_mes, (
    select min((f.datos->>'proximo_cobro_fecha')::date) from public.conta_gc_copia_fila f
     where f.copia_id = p_copia and f.tipo = 'suscripcion' and f.datos->>'estado' = 'active'
       and (f.datos->>'proximo_cobro_fecha')::date >= v_dia)))::date;
  if v_mes is null then
    return jsonb_build_object('regla', 'suscripciones active con su próximo cobro en el mes', 'mes', null, 'suscripciones', 0, 'clientes', 0, 'euros', 0);
  end if;
  select jsonb_build_object(
    'regla', 'suscripciones active con su próximo cobro en el mes; euros = su próximo importe; clientes = los distintos clientes de GoCardless',
    'mes', to_char(v_mes, 'YYYY-MM'),
    'suscripciones', count(*),
    'clientes', count(distinct f.datos->>'gc_cliente_id'),
    'euros', coalesce(round(sum((f.datos->>'proximo_cobro_importe')::numeric), 2), 0),
    'dias', coalesce((select jsonb_object_agg(d, n) from (
        select g.datos->>'proximo_cobro_fecha' d, count(*) n from public.conta_gc_copia_fila g
         where g.copia_id = p_copia and g.tipo = 'suscripcion' and g.datos->>'estado' = 'active'
           and date_trunc('month', (g.datos->>'proximo_cobro_fecha')::date) = v_mes group by 1) x), '{}'::jsonb))
    into v_r
    from public.conta_gc_copia_fila f
   where f.copia_id = p_copia and f.tipo = 'suscripcion' and f.datos->>'estado' = 'active'
     and date_trunc('month', (f.datos->>'proximo_cobro_fecha')::date) = v_mes;
  return v_r;
end $$;
comment on function public.conta_gc_contar_copia(uuid, date) is
  'R19 · LA forma de contar lo que GoCardless cobrará en un mes (la única: la usan la copia, el paso 1 y Q). Suscripciones en estado active con su próximo cobro dentro del mes; euros = la suma de su próximo importe; clientes = los distintos gc_cliente_id. Sin mes: el del próximo cobro más cercano desde el día de la copia.';
revoke all on function public.conta_gc_contar_copia(uuid, date) from public, anon;
grant execute on function public.conta_gc_contar_copia(uuid, date) to authenticated, service_role;

-- Tomar la copia de una empresa: lo que hay en Sumied de su GoCardless, justo después de leerlo. Solo el servidor.
-- Lo leído se junta primero en una tabla temporal (una sola foto), se sacan de ella los totales y la huella, se escribe
-- la cabecera y después las filas: la cabecera se escribe una sola vez y nunca hay que tocarla.
create or replace function public.conta_gc_copia_tomar(p_company uuid, p_lectura uuid, p_por text, p_quien text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_cuenta uuid; v_id uuid := gen_random_uuid(); v_n record;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then raise exception 'Esa empresa no existe.' using errcode = 'P0002'; end if;
  create temp table if not exists _conta_gc_copia_foto (tipo text, gc_id text, datos jsonb) on commit drop;
  truncate _conta_gc_copia_foto;
  insert into _conta_gc_copia_foto (tipo, gc_id, datos)
  select 'cliente', x.gc_id, to_jsonb(x) - 'account_id' - 'company_id' from public.conta_gc_cliente x where x.company_id = p_company
  union all
  select 'mandato', x.gc_id, to_jsonb(x) - 'account_id' - 'company_id' from public.conta_gc_mandato x where x.company_id = p_company
  union all
  select 'suscripcion', x.gc_id, to_jsonb(x) - 'account_id' - 'company_id' from public.conta_gc_suscripcion x where x.company_id = p_company
  union all
  select 'cobro', x.gc_id, to_jsonb(x) - 'account_id' - 'company_id' from public.conta_gc_cobro x where x.company_id = p_company;
  select count(*) filter (where tipo = 'cliente') cl, count(*) filter (where tipo = 'mandato') ma,
         count(*) filter (where tipo = 'suscripcion') su, count(*) filter (where tipo = 'cobro') co,
         md5(coalesce(string_agg(tipo || '|' || gc_id || '|' || datos::text, E'\n' order by tipo, gc_id), '')) h
    into v_n from _conta_gc_copia_foto;
  insert into public.conta_gc_copia (id, account_id, company_id, lectura_id, por, quien_name, clientes, mandatos, suscripciones, cobros, huella)
  values (v_id, v_cuenta, p_company, p_lectura, p_por, nullif(trim(coalesce(p_quien, '')), ''), v_n.cl, v_n.ma, v_n.su, v_n.co, v_n.h);
  insert into public.conta_gc_copia_fila (copia_id, account_id, tipo, gc_id, datos)
  select v_id, v_cuenta, tipo, gc_id, datos from _conta_gc_copia_foto;
  truncate _conta_gc_copia_foto;
  return jsonb_build_object('copia', v_id, 'clientes', v_n.cl, 'mandatos', v_n.ma, 'suscripciones', v_n.su, 'cobros', v_n.co, 'huella', v_n.h);
end $$;
comment on function public.conta_gc_copia_tomar(uuid, uuid, text, text) is
  'R19 · Toma la copia de lo que hay de GoCardless de una empresa (la llama la lectura, antes de tocar Sumied). Solo el servidor.';
revoke all on function public.conta_gc_copia_tomar(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.conta_gc_copia_tomar(uuid, uuid, text, text) to service_role;

-- Las copias de una empresa, de la más nueva a la más vieja, con lo que cuenta cada una (para la lista y su Excel).
create or replace function public.conta_gc_copias(p_company uuid)
returns table (id uuid, tomada_at timestamptz, por text, quien_name text, clientes integer, mandatos integer, suscripciones integer, cobros integer, huella text, cuenta jsonb)
language sql stable security definer set search_path = public as $$
  select c.id, c.tomada_at, c.por, c.quien_name, c.clientes, c.mandatos, c.suscripciones, c.cobros, c.huella, public.conta_gc_contar_copia(c.id)
    from public.conta_gc_copia c
   where c.company_id = p_company and public.belongs_to_account(c.account_id)
   order by c.tomada_at desc
   limit 400
$$;
revoke all on function public.conta_gc_copias(uuid) from public, anon;
grant execute on function public.conta_gc_copias(uuid) to authenticated, service_role;
