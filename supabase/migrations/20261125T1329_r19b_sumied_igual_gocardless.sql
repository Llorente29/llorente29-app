-- supabase/migrations/20261125T1329_r19b_sumied_igual_gocardless.sql
-- cambia: public.conta_gestoria_diferencia · prueba: supabase/staging/sql/20261125_r19b_sumied_igual_gocardless_prueba.sql
-- cambia: public.conta_lista_que_hacer · prueba: supabase/staging/sql/20261125_r19b_sumied_igual_gocardless_prueba.sql
-- cambia: public.conta_pantalla_asignar · prueba: supabase/staging/sql/20261125_r19b_sumied_igual_gocardless_prueba.sql
--
-- R19 · paso 1 · Sumied igual a GoCardless (Julio, 25/11: «GoCardless es la verdad»). Lo que decide qué se iguala vive
-- en conta-gocardless-leer/igualar.ts; aquí, solo lo que necesita la base:
--
--   1 · conta_gc_igualado (AÑADE): lo que cada lectura cambia en una línea para que sea igual a GoCardless (darla de
--       baja porque GoCardless ya no la cobra, o ponerle el importe que cobra GoCardless), con cómo estaba, cómo queda,
--       por qué, de qué lectura y de qué copia de GoCardless. Solo se añade: es el registro de lo hecho.
--   2 · Tres tipos nuevos en «Pendiente de revisar» (conta_gestoria_diferencia; el CHECK SOLO AMPLÍA: todo lo que hay
--       sigue valiendo):
--         · linea_sin_atar: una línea sale de lo que GoCardless cobra a un cliente que no está atado a ninguna ficha;
--         · linea_en_otra_ficha: ese cliente de GoCardless está atado a otra ficha que la de la línea;
--         · gc_sin_atar: GoCardless cobra a un cliente que no está atado a ninguna ficha.
--       Lo no atado no se adivina: sale ahí y no para el resto.
--
--   3 · «Cobros de GoCardless sin cliente» cuenta lo que NO está atado (conta_gc_enlace en «atado»), con la forma de
--       contar de la copia (las suscripciones active con su próximo cobro en el mes del próximo cobro, y su próximo
--       importe). Antes contaba como «con cliente» lo que tenía un cliente de GoCardless apuntado en conta_cobro_cliente,
--       también lo propuesto por correo sin confirmar, y sumaba el «al mes» de todas las activas:
--         · conta_lista_que_hacer (CAMBIA, misma firma): solo la cuenta de «gocardless_sin_cliente»; lo demás, igual.
--         · conta_pantalla_asignar (CAMBIA, misma firma): además, el próximo cobro de cada suscripción, el enlace de cada
--           cliente (estado, por qué y sus fichas candidatas) y sus mandatos (banco y últimos dígitos).
--
-- No toca recibos, cobros ni facturas. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261125T1329_r19b_sumied_igual_gocardless.down.sql

-- 1 · Lo igualado, apuntado.
create table if not exists public.conta_gc_igualado (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null,
  company_id  uuid not null,
  lectura_id  uuid,
  copia_id    uuid,
  linea_id    uuid not null,
  party_id    uuid,
  que         text not null check (que in ('baja', 'importe')),
  antes       jsonb not null,
  despues     jsonb not null,
  porque      text not null,
  hecho_at    timestamptz not null default now()
);
create index if not exists conta_gc_igualado_empresa_idx on public.conta_gc_igualado (company_id, hecho_at desc);
create index if not exists conta_gc_igualado_linea_idx on public.conta_gc_igualado (linea_id);
comment on table public.conta_gc_igualado is
  'R19 · Lo que cada lectura de GoCardless cambia en una línea de Sumied para que sea igual a lo que cobra GoCardless (baja o importe), con cómo estaba, cómo queda y de qué copia.';
alter table public.conta_gc_igualado enable row level security;
revoke all on table public.conta_gc_igualado from public, anon, authenticated;
grant select on table public.conta_gc_igualado to authenticated;
grant select, insert on table public.conta_gc_igualado to service_role;
drop policy if exists conta_gc_igualado_leer on public.conta_gc_igualado;
create policy conta_gc_igualado_leer on public.conta_gc_igualado for select to authenticated using (public.belongs_to_account(account_id));
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then grant select on public.conta_gc_igualado to conta_lectura; end if;
end $$;

-- 2 · «Pendiente de revisar»: tres tipos más (los de antes, todos, siguen).
alter table public.conta_gestoria_diferencia drop constraint if exists conta_gestoria_diferencia_tipo_check;
alter table public.conta_gestoria_diferencia add constraint conta_gestoria_diferencia_tipo_check check (tipo = any (array[
  'crm_sin_cobro', 'gocardless_sin_ficha', 'emisor_distinto', 'nif_repetido_en_crm', 'correo_repetido_en_crm', 'nif_distinto',
  'suscripcion_sin_convertir', 'totales_distintos', 'mandato_por_firmar', 'falla_a_menudo', 'abono_en_otra_cuenta', 'fichas_repetidas',
  'nif_no_valido', 'ficha_no_guardada', 'contacto_solo_negociacion', 'contacto_empresa_con_datos', 'ya_no_es_cliente_en_crm',
  'falta_codigo_cliente', 'cliente_no_de_acuerdo', 'falta_cuenta_stripe', 'bitrix_cambiado',
  'linea_sin_atar', 'linea_en_otra_ficha', 'gc_sin_atar']::text[]));

-- 3 · Lo que no está atado, con la forma de contar de la copia.
select public._respaldar_funcion('public.conta_lista_que_hacer(uuid)', '20261125T1329_r19b_sumied_igual_gocardless');
select public._respaldar_funcion('public.conta_pantalla_asignar(uuid)', '20261125T1329_r19b_sumied_igual_gocardless');
create or replace function public.conta_lista_que_hacer(p_cuenta uuid)
returns table(cuenta_id uuid, empresa_id uuid, tipo text, n bigint, euros numeric)
language sql stable security definer set search_path = public as $$
  with permiso as (
    select p_cuenta as cuenta where public.belongs_to_account(p_cuenta)
  ), mes_que_cuenta as (
    -- R19 · El mes del próximo cobro de cada empresa (la forma de contar de la copia, conta_gc_contar_copia).
    select s.company_id, date_trunc('month', min(s.proximo_cobro_fecha))::date as mes from public.conta_gc_suscripcion s
     where s.account_id = (select cuenta from permiso) and s.estado = 'active' and s.proximo_cobro_fecha >= (now() at time zone 'Europe/Madrid')::date
     group by s.company_id
  ), gc_sin_cliente as (
    -- R19 · Sin cliente = sin ATAR (conta_gc_enlace en «atado»): lo propuesto por correo sin confirmar, también.
    select s.account_id, s.company_id, count(*) as n, sum(s.proximo_cobro_importe) as eur from public.conta_gc_suscripcion s
      join mes_que_cuenta m on m.company_id = s.company_id
     where s.account_id = (select cuenta from permiso) and s.estado = 'active' and date_trunc('month', s.proximo_cobro_fecha)::date = m.mes
       and not exists (select 1 from public.conta_gc_enlace e where e.company_id = s.company_id and e.gc_cliente_id = s.gc_cliente_id and e.estado = 'atado')
     group by s.account_id, s.company_id
  ), gc_varios as (
    select cc.account_id, cc.company_id, count(*) as n from (
      select k.account_id, k.company_id, k.gc_cliente_id from public.conta_cobro_cliente k
       where k.account_id = (select cuenta from permiso) and k.gc_cliente_id is not null
       group by k.account_id, k.company_id, k.gc_cliente_id having count(*) > 1) cc
     group by cc.account_id, cc.company_id
  ), devueltos as (
    select b.account_id, b.company_id, count(*) as n, sum(b.importe) as eur from public.conta_gc_cobro b
     where b.account_id = (select cuenta from permiso) and b.estado in ('failed', 'charged_back') and b.fecha >= date_trunc('month', current_date)::date
     group by b.account_id, b.company_id
  ), por_firmar as (
    -- nº 90 · Por firmar, solo el que espera la aprobación del cliente: en pending_submission o submitted ya está firmado.
    select m.account_id, m.company_id, count(*) as n,
           sum((select sum(s.al_mes) from public.conta_gc_suscripcion s where s.company_id = m.company_id and s.mandato_gc_id = m.gc_id and s.estado = 'active')) as eur
      from public.conta_gc_mandato m
     where m.account_id = (select cuenta from permiso) and m.estado = 'pending_customer_approval'
     group by m.account_id, m.company_id
  ), difs as (
    select d.account_id, d.company_id, d.tipo, count(*) as n from public.conta_gestoria_diferencia d
     where d.account_id = (select cuenta from permiso) and d.vigente
     group by d.account_id, d.company_id, d.tipo
  )
  select account_id, company_id, 'gocardless_sin_cliente', n, eur from gc_sin_cliente
  union all select account_id, company_id, 'gocardless_varios_clientes', n, null::numeric from gc_varios
  union all select account_id, company_id, 'recibos_devueltos', n, eur from devueltos
  union all select account_id, company_id, 'mandatos_por_firmar', n, eur from por_firmar
  union all select account_id, company_id, 'diferencia:' || tipo, n, null::numeric from difs
$$;

create or replace function public.conta_pantalla_asignar(p_cuenta uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  with permiso as (
    select p_cuenta as cuenta where public.belongs_to_account(p_cuenta)
  ), activas as (
    select s.company_id, s.gc_id, s.gc_cliente_id, s.nombre, s.al_mes, s.estado, s.mandato_gc_id, s.intervalo, s.proximo_cobro_fecha, s.proximo_cobro_importe
      from public.conta_gc_suscripcion s
     where s.account_id = (select cuenta from permiso) and s.estado = 'active'
  ), mes_que_cuenta as (
    select a.company_id, date_trunc('month', min(a.proximo_cobro_fecha))::date as mes from activas a
     where a.proximo_cobro_fecha >= (now() at time zone 'Europe/Madrid')::date group by a.company_id
  )
  select jsonb_build_object(
    'suscripciones', coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object('cobra_en_el_mes', date_trunc('month', a.proximo_cobro_fecha)::date = m.mes) order by a.company_id, a.gc_id)
        from activas a left join mes_que_cuenta m on m.company_id = a.company_id), '[]'::jsonb),
    'meses', coalesce((select jsonb_agg(jsonb_build_object('company_id', m.company_id, 'mes', to_char(m.mes, 'YYYY-MM')) order by m.company_id) from mes_que_cuenta m), '[]'::jsonb),
    'gc_clientes', coalesce((select jsonb_agg(jsonb_build_object('company_id', g.company_id, 'gc_id', g.gc_id, 'nombre', g.nombre, 'correo', g.correo, 'nif', g.nif,
          'enlace', (select jsonb_build_object('estado', e.estado, 'por', e.por, 'party_id', e.party_id, 'candidatas', to_jsonb(e.candidatas), 'porque', e.porque)
                       from public.conta_gc_enlace e where e.company_id = g.company_id and e.gc_cliente_id = g.gc_id),
          'mandatos', coalesce((select jsonb_agg(jsonb_build_object('estado', md.estado, 'banco', md.banco, 'cuenta_final', md.cuenta_final) order by md.gc_id)
                       from public.conta_gc_mandato md where md.company_id = g.company_id and md.gc_cliente_id = g.gc_id), '[]'::jsonb))
        order by g.company_id, g.gc_id)
        from public.conta_gc_cliente g
       where g.account_id = (select cuenta from permiso) and (g.company_id, g.gc_id) in (select company_id, gc_cliente_id from activas)), '[]'::jsonb))
$$;
revoke all on function public.conta_pantalla_asignar(uuid) from public, anon;
grant execute on function public.conta_pantalla_asignar(uuid) to authenticated, service_role;
revoke all on function public.conta_lista_que_hacer(uuid) from public, anon;
grant execute on function public.conta_lista_que_hacer(uuid) to authenticated, service_role;
