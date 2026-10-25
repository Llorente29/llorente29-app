-- supabase/migrations/20261024T2031_v01_tiendas_local.sql
--
-- cambia: public.platform_store · prueba: supabase/staging/sql/20261024_v01_tiendas_local_prueba.sql
--
-- V01 · Entrega 3 · El local de cada tienda de plataforma sale de su dirección
-- (Julio, 24/10). Las liquidaciones de Uber traen la tienda con su dirección
-- («Meraki Pita (Calle de Florencio Llorente 29, Madrid, ES, 28027)») y nadie
-- tiene que asignarle el local a mano:
--
--   1. conta_clave_direccion: la calle y el número, sin tildes, sin «calle de»
--      ni signos («Florencio Llorente, 29» y «Calle de Florencio Llorente 29»
--      dan los dos «florenciollorente29»).
--   2. conta_local_de_tienda: el local de la cuenta cuya dirección da la misma
--      clave que la de la tienda (la que va entre los últimos paréntesis). Solo
--      si es UNO: con dos, o ninguno, no se adivina (null).
--   3. Un disparador en platform_store: la tienda que llega sin local (o cambia
--      de dirección sin tenerlo) se lo pone sola por su dirección; quitarle el
--      local a mano sigue valiendo; si no casa con ninguno, se queda sin local y
--      se avisa (encolar_alerta, «tienda_sin_local»). El aviso nunca impide que
--      entre la liquidación: si falla, se sigue.
--   4. Las que ya existen sin local: se les pone, con copia previa en
--      conta_tienda_local_antes (cuál y qué tenía). Medido el 24/10 en
--      producción (solo lectura): 9 tiendas de Uber de Foodint, 9 casan, 7 con
--      Foodint Alcalá y 2 con Foodint Carabanchel.
--
-- Destruye (update de lo que existe): va con «autorizo». No está en el camino
-- del pedido: platform_store la escriben solo las liquidaciones
-- (conta_liquidacion_registrar) y Sus tiendas.
--
-- Vuelta atrás: supabase/vuelta-atras/20261024T2031_v01_tiendas_local.down.sql
-- (quita el disparador y las dos funciones, y devuelve a cada tienda el local
-- que tenía, desde la copia).

-- 1 · La clave de una dirección -----------------------------------------------------------------
create or replace function public.conta_clave_direccion(p_texto text)
returns text
language sql
stable
set search_path to 'public'
as $$
  select nullif(regexp_replace(
           regexp_replace(lower(public.unaccent(coalesce(p_texto, ''))),
                          '\m(calle|c|avenida|avda|av|paseo|plaza|pza|camino|carretera|ctra|de|del|la|el|los|las)\M', ' ', 'g'),
           '[^a-z0-9]+', '', 'g'), '')
$$;

comment on function public.conta_clave_direccion(text) is
  'V01 · La calle y el número de una dirección, para compararlas: sin tildes, sin «calle de» y sin signos.';

-- 2 · El local de una tienda, por su dirección --------------------------------------------------
create or replace function public.conta_local_de_tienda(p_account uuid, p_texto text)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_dir text;
  v_clave text;
  v_ids uuid[];
begin
  if p_account is null or p_texto is null then return null; end if;
  -- La dirección va entre los últimos paréntesis: «Marca (Calle …, Madrid, ES, 28027)».
  -- Sin paréntesis, el texto entero. De la dirección, lo de antes de la primera coma.
  v_dir := coalesce(substring(p_texto from '\(([^()]*)\)\s*$'), p_texto);
  v_clave := public.conta_clave_direccion(split_part(v_dir, ',', 1));
  if v_clave is null then return null; end if;
  select array_agg(l.id) into v_ids
    from public.locations l
   where l.account_id = p_account
     and public.conta_clave_direccion(l.address) = v_clave;
  if coalesce(array_length(v_ids, 1), 0) <> 1 then return null; end if;
  return v_ids[1];
end $$;

comment on function public.conta_local_de_tienda(uuid, text) is
  'V01 · El local de la cuenta cuya dirección es la de la tienda (entre los últimos paréntesis). Null si no casa con ninguno o casa con más de uno.';

revoke all on function public.conta_local_de_tienda(uuid, text) from public;
grant execute on function public.conta_local_de_tienda(uuid, text) to authenticated, service_role;

-- 3 · La tienda que llega sin local se lo pone sola ------------------------------------------------
create or replace function public._conta_tienda_local_por_direccion()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.location_id is not null or new.external_text is null then return new; end if;
  new.location_id := public.conta_local_de_tienda(new.account_id, new.external_text);
  if new.location_id is null then
    -- Avisa, pero nunca impide que entre la liquidación.
    begin
      perform public.encolar_alerta(
        p_kind            => 'tienda_sin_local',
        p_subject         => 'Una tienda de plataforma no casa con ningún local',
        p_message         => format('La tienda «%s» (%s) ha llegado con una dirección que no es la de ningún local de la cuenta. Sus liquidaciones salen sin local en Ventas › Liquidaciones hasta que se le ponga.',
                                    new.external_text, coalesce(new.provider, 'plataforma')),
        p_debounce_kind   => 'tienda_sin_local:' || new.account_id::text || ':' || md5(new.external_text),
        p_debounce_window => interval '7 days',
        p_account_id      => new.account_id,
        p_severity        => 'aviso');
    exception when others then
      raise notice 'tienda_sin_local: no se pudo encolar el aviso (%)', sqlerrm;
    end;
  end if;
  return new;
end $$;

drop trigger if exists conta_tienda_local_por_direccion on public.platform_store;
create trigger conta_tienda_local_por_direccion
  before insert or update of external_text on public.platform_store
  for each row execute function public._conta_tienda_local_por_direccion();

-- 4 · Las que ya existen: copia previa y su local -------------------------------------------------
create table if not exists public.conta_tienda_local_antes (
  store_id        uuid primary key,
  account_id      uuid not null,
  external_text   text,
  location_antes  uuid,
  location_puesto uuid not null,
  copiado_at      timestamptz not null default now()
);

comment on table public.conta_tienda_local_antes is
  'V01 · Copia previa de 20261024T2031: el local que tenía cada tienda antes de ponérselo por su dirección. La lee la vuelta atrás.';

alter table public.conta_tienda_local_antes enable row level security;

insert into public.conta_tienda_local_antes (store_id, account_id, external_text, location_antes, location_puesto)
select ps.id, ps.account_id, ps.external_text, ps.location_id, public.conta_local_de_tienda(ps.account_id, ps.external_text)
  from public.platform_store ps
 where ps.location_id is null
   and public.conta_local_de_tienda(ps.account_id, ps.external_text) is not null
on conflict (store_id) do nothing;

update public.platform_store ps
   set location_id = c.location_puesto,
       updated_at = now(),
       updated_by_name = 'V01 · local por su dirección'
  from public.conta_tienda_local_antes c
 where c.store_id = ps.id
   and ps.location_id is null;
