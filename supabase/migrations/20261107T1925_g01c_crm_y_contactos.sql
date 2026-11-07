-- supabase/migrations/20261107T1925_g01c_crm_y_contactos.sql
--
-- G01c · Los contactos del CRM y una clave neutra (Julio, 07/11): Sumied sirve
-- para cualquier gestoría y cualquier CRM, no solo Bitrix24. Primera de dos
-- tandas: esta AÑADE y COPIA, no quita nada; la siguiente (G01c, tarea 6) quita
-- bitrix_id, las columnas de antes, la tabla conta_crm_bitrix (con sus espejos)
-- y las funciones de paso, cuando el front y las funciones nuevas estén publicados.
--
-- cambia: public.conta_bitrix_guardar_clientes · prueba: supabase/staging/sql/20261107_g01c_crm_y_contactos_prueba.sql
-- cambia: public.conta_bitrix_confirmar_mapa · prueba: supabase/staging/sql/20261107_g01c_crm_y_contactos_prueba.sql
-- cambia: public.conta_bitrix_aplicar_union · prueba: supabase/staging/sql/20261107_g01c_crm_y_contactos_prueba.sql
-- cambia: public.conta_bitrix_guardar_conexion · prueba: supabase/staging/sql/20261107_g01c_crm_y_contactos_prueba.sql
-- cambia: public.conta_bitrix_secreto · prueba: supabase/staging/sql/20261107_g01c_crm_y_contactos_prueba.sql
-- cambia: public.conta_gestoria_despertar · prueba: supabase/staging/sql/20261107_g01c_crm_y_contactos_prueba.sql
-- cambia: public.conta_consulta_clientes · prueba: supabase/staging/sql/20261107_g01c_crm_y_contactos_prueba.sql
-- cambia: public.conta_consulta_diferencias · prueba: supabase/staging/sql/20261107_g01c_crm_y_contactos_prueba.sql
-- cambia: public.conta_gestoria_ficha · prueba: supabase/staging/sql/20261107_g01c_crm_y_contactos_prueba.sql
-- cambia: public.conta_gestoria_cliente · prueba: supabase/staging/sql/20261107_g01c_crm_y_contactos_prueba.sql
-- cambia: public.conta_crm_bitrix · prueba: supabase/staging/sql/20261107_g01c_crm_y_contactos_prueba.sql
-- cambia: public.conta_gestoria_diferencia · prueba: supabase/staging/sql/20261107_g01c_crm_y_contactos_prueba.sql
--
--   1. conta_crm (nueva): la conexión con el CRM de cada cuenta, una fila por
--      cuenta y CRM (hoy, «bitrix24»), con la fila de conta_crm_bitrix copiada
--      y, por cada tipo de ficha, su mapa, lo medido y lo leído (empresas: mapa
--      y campos_medidos, como antes; contactos: mapa_contactos,
--      campos_medidos_contactos y contactos_leidos). Con su RLS.
--      conta_crm_bitrix se queda como espejo de la fila de Bitrix24 (lo que se
--      escribe en una se copia a la otra): lo publicado sigue leyendo y
--      escribiendo en ella sin enterarse. Se quita en la tanda siguiente, que
--      es cuando ya nadie la lee (borrar va en su propia tanda).
--   2. Fichas, clientes y diferencias: la clave neutra, crm + tipo_ficha
--      ('empresa' | 'contacto') + id_externo, copiada de bitrix_id. En las
--      fichas, de_empresa: una persona de contacto es la ficha de un contacto
--      colgando del cliente de su empresa (una por empresa). En los clientes,
--      forma_pago_crm y emisor_segun_crm, copiadas. bitrix_id se queda (las
--      funciones lo siguen escribiendo en las fichas de empresa de Bitrix24)
--      hasta la tanda siguiente.
--   3. Las vistas de consulta añaden sus columnas neutras al final.
--   4. «Pendiente de revisar» admite los dos porqués de los contactos.
--   5. Las funciones neutras, que reciben el CRM: conta_crm_guardar_clientes
--      (con el identificador fiscal extranjero: el RIF de Venezuela con tipo
--      «foreign» y país VE), conta_crm_guardar_personas, conta_crm_confirmar_mapa
--      (empresas o contactos) y conta_crm_aplicar_union. Las conta_bitrix_* de
--      siempre pasan a las neutras con 'bitrix24'; las de la conexión de
--      Bitrix24 (guardar_conexion y secreto) son del adaptador y leen conta_crm.
--   6. conta_gestoria_despertar lee conta_crm (cada CRM, con su función).
-- No lee ni escribe nada en el CRM. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261107T1925_g01c_crm_y_contactos.down.sql

-- 0 · El nombre de cada CRM en las frases (lo único que sabe la base de cada uno).
create or replace function public._conta_crm_nombre(p_crm text) returns text language sql immutable set search_path = public as $$
  select case p_crm when 'bitrix24' then 'Bitrix24' else p_crm end
$$;
comment on function public._conta_crm_nombre(text) is 'G01c · El nombre de un CRM para las frases («bitrix24» → «Bitrix24»).';

-- 1 · conta_crm: la conexión con el CRM, una fila por cuenta y CRM, con la de Bitrix24 copiada.
create table if not exists public.conta_crm (
  account_id               uuid not null references public.accounts(id) on delete cascade,
  crm                      text not null check (crm ~ '^[a-z0-9_]+$'),
  entorno                  text not null check (entorno in ('real', 'pruebas')),
  url_ref                  uuid,
  portal                   text,
  mapa                     jsonb,
  campos_medidos           jsonb,
  mapa_contactos           jsonb,
  campos_medidos_contactos jsonb,
  contactos_leidos         jsonb,
  conectada_at             timestamptz,
  conectada_por_name       text,
  ultima_lectura_at        timestamptz,
  empresas_leidas          integer,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  primary key (account_id, crm)
);
comment on table public.conta_crm is
  'G01c · La conexión con el CRM de cada cuenta (una fila por cuenta y CRM): entorno, portal, la dirección en Vault (url_ref, sin clave aquí), y por cada tipo de ficha su mapa, lo medido del portal y lo leído. Hasta el G01c, conta_crm_bitrix.';
comment on column public.conta_crm.crm is 'G01c · Qué CRM es («bitrix24»).';
comment on column public.conta_crm.mapa is 'El mapa de las EMPRESAS del CRM (qué es cada campo), confirmado por una persona.';
comment on column public.conta_crm.campos_medidos is 'Los campos de las EMPRESAS del portal, medidos.';
comment on column public.conta_crm.mapa_contactos is 'G01c · El mapa de los CONTACTOS (NIF, dirección, cuota de referencia, «Tipo de cliente»), confirmado por una persona. Sin confirmar no entra ningún contacto.';
comment on column public.conta_crm.campos_medidos_contactos is 'G01c · Los campos de los CONTACTOS del portal, medidos en cada lectura.';
comment on column public.conta_crm.contactos_leidos is
  'G01c · De la última lectura: cuántos contactos hay de cada (resumen) y cuáles se quedan fuera o van a «Pendiente de revisar», con su porqué (para «Ver cuáles»).';
alter table public.conta_crm enable row level security;
revoke all on table public.conta_crm from public, anon, authenticated;
grant select on table public.conta_crm to authenticated;
grant all on table public.conta_crm to service_role;
drop policy if exists conta_crm_leer on public.conta_crm;
create policy conta_crm_leer on public.conta_crm for select to authenticated using (public.belongs_to_account(account_id));
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then grant select on table public.conta_crm to conta_lectura; end if;
end $$;

insert into public.conta_crm (account_id, crm, entorno, url_ref, portal, mapa, campos_medidos, conectada_at, conectada_por_name, ultima_lectura_at, empresas_leidas, created_at, updated_at)
select account_id, 'bitrix24', entorno, url_ref, portal, mapa, campos_medidos, conectada_at, conectada_por_name, ultima_lectura_at, empresas_leidas, created_at, updated_at
  from public.conta_crm_bitrix
on conflict (account_id, crm) do nothing;

-- Mientras dura el cambio, conta_crm_bitrix es el espejo de la fila de Bitrix24: lo que se escribe en una se copia a la otra
-- (lo publicado escribe en la de antes; lo nuevo, en conta_crm). La tanda siguiente quita la de antes y los dos espejos.
create or replace function public._conta_crm_a_bitrix() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'DELETE' then
    if old.crm = 'bitrix24' then delete from public.conta_crm_bitrix where account_id = old.account_id; end if;
    return null;
  end if;
  if new.crm <> 'bitrix24' then return null; end if;
  insert into public.conta_crm_bitrix (account_id, entorno, url_ref, portal, mapa, campos_medidos, conectada_at, conectada_por_name, ultima_lectura_at, empresas_leidas, created_at, updated_at)
  values (new.account_id, new.entorno, new.url_ref, new.portal, new.mapa, new.campos_medidos, new.conectada_at, new.conectada_por_name, new.ultima_lectura_at, new.empresas_leidas,
          new.created_at, new.updated_at)
  on conflict (account_id) do update set entorno = excluded.entorno, url_ref = excluded.url_ref, portal = excluded.portal, mapa = excluded.mapa,
    campos_medidos = excluded.campos_medidos, conectada_at = excluded.conectada_at, conectada_por_name = excluded.conectada_por_name,
    ultima_lectura_at = excluded.ultima_lectura_at, empresas_leidas = excluded.empresas_leidas, updated_at = excluded.updated_at;
  return null;
end $$;
create or replace function public._conta_crm_desde_bitrix() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'DELETE' then delete from public.conta_crm where account_id = old.account_id and crm = 'bitrix24'; return null; end if;
  insert into public.conta_crm (account_id, crm, entorno, url_ref, portal, mapa, campos_medidos, conectada_at, conectada_por_name, ultima_lectura_at, empresas_leidas, created_at, updated_at)
  values (new.account_id, 'bitrix24', new.entorno, new.url_ref, new.portal, new.mapa, new.campos_medidos, new.conectada_at, new.conectada_por_name, new.ultima_lectura_at,
          new.empresas_leidas, new.created_at, new.updated_at)
  on conflict (account_id, crm) do update set entorno = excluded.entorno, url_ref = excluded.url_ref, portal = excluded.portal, mapa = excluded.mapa,
    campos_medidos = excluded.campos_medidos, conectada_at = excluded.conectada_at, conectada_por_name = excluded.conectada_por_name,
    ultima_lectura_at = excluded.ultima_lectura_at, empresas_leidas = excluded.empresas_leidas, updated_at = excluded.updated_at;
  return null;
end $$;
revoke all on function public._conta_crm_a_bitrix() from public, anon, authenticated;
revoke all on function public._conta_crm_desde_bitrix() from public, anon, authenticated;
drop trigger if exists conta_crm_a_bitrix on public.conta_crm;
create trigger conta_crm_a_bitrix after insert or update or delete on public.conta_crm for each row execute function public._conta_crm_a_bitrix();
drop trigger if exists conta_crm_bitrix_a_crm on public.conta_crm_bitrix;
create trigger conta_crm_bitrix_a_crm after insert or update or delete on public.conta_crm_bitrix for each row execute function public._conta_crm_desde_bitrix();
comment on table public.conta_crm_bitrix is
  'G01c · Mientras dura el cambio: el espejo de conta_crm de Bitrix24 (lo que se escribe en una se copia a la otra). La quita la tanda siguiente. G01 · El Bitrix24 de una cuenta (uno para todos sus emisores). La dirección con su clave, en Vault (url_ref, «conta_bitrix:<cuenta>»); portal: solo el nombre del portal, sin clave. mapa: el de campos (UF_CRM_… → Sumied), propuesto con crm.company.fields; campos_medidos: lo que devolvió.';

-- 2 · La clave neutra de las fichas.
alter table public.conta_gestoria_ficha add column if not exists crm text not null default 'bitrix24';
alter table public.conta_gestoria_ficha add column if not exists tipo_ficha text not null default 'empresa';
alter table public.conta_gestoria_ficha add column if not exists id_externo text;
alter table public.conta_gestoria_ficha add column if not exists de_empresa text not null default '';
update public.conta_gestoria_ficha set id_externo = bitrix_id where id_externo is null;
alter table public.conta_gestoria_ficha alter column id_externo set not null;
alter table public.conta_gestoria_ficha drop constraint if exists conta_gestoria_ficha_tipo_check;
alter table public.conta_gestoria_ficha add constraint conta_gestoria_ficha_tipo_check
  check (tipo_ficha in ('empresa', 'contacto') and (de_empresa = '' or tipo_ficha = 'contacto'));
alter table public.conta_gestoria_ficha drop constraint if exists conta_gestoria_ficha_pkey;
alter table public.conta_gestoria_ficha add constraint conta_gestoria_ficha_pkey primary key (account_id, crm, tipo_ficha, id_externo, de_empresa);
alter table public.conta_gestoria_ficha alter column bitrix_id drop not null;
comment on column public.conta_gestoria_ficha.crm is 'G01c · De qué CRM es la ficha («bitrix24»).';
comment on column public.conta_gestoria_ficha.tipo_ficha is 'G01c · Una empresa o un contacto del CRM (sus ids son numeraciones distintas).';
comment on column public.conta_gestoria_ficha.id_externo is 'G01c · El id de la ficha en su CRM.';
comment on column public.conta_gestoria_ficha.de_empresa is
  'G01c · En una persona de contacto, el id externo de su empresa (cuelga del cliente de esa empresa); vacío en las fichas de un cliente.';
comment on column public.conta_gestoria_ficha.bitrix_id is 'Hasta el G01c: el id de Bitrix24. Sustituida por crm + tipo_ficha + id_externo; la quita la tanda siguiente.';

-- Y la de los clientes.
alter table public.conta_gestoria_cliente add column if not exists crm text;
alter table public.conta_gestoria_cliente add column if not exists tipo_ficha text;
alter table public.conta_gestoria_cliente add column if not exists id_externo text;
alter table public.conta_gestoria_cliente add column if not exists forma_pago_crm text;
alter table public.conta_gestoria_cliente add column if not exists emisor_segun_crm uuid references public.company(id) on delete set null;
update public.conta_gestoria_cliente set crm = 'bitrix24', tipo_ficha = 'empresa', id_externo = bitrix_id, forma_pago_crm = forma_pago_bitrix, emisor_segun_crm = emisor_segun_bitrix
 where bitrix_id is not null and id_externo is null;
alter table public.conta_gestoria_cliente drop constraint if exists conta_gestoria_cliente_tipo_check;
alter table public.conta_gestoria_cliente add constraint conta_gestoria_cliente_tipo_check
  check ((id_externo is null and crm is null and tipo_ficha is null) or (id_externo is not null and crm is not null and tipo_ficha in ('empresa', 'contacto')));
alter table public.conta_gestoria_cliente drop constraint if exists conta_gestoria_cliente_ficha_key;
alter table public.conta_gestoria_cliente add constraint conta_gestoria_cliente_ficha_key unique (account_id, crm, tipo_ficha, id_externo);
comment on column public.conta_gestoria_cliente.id_externo is 'G01c · El id de su ficha principal en su CRM (con crm y tipo_ficha).';
comment on column public.conta_gestoria_cliente.forma_pago_crm is 'G01c · La «Forma de pago» que dice su CRM (de referencia).';
comment on column public.conta_gestoria_cliente.emisor_segun_crm is 'G01c · El emisor que dice su CRM.';

-- Y la de las diferencias (la tanda siguiente quita bitrix_id).
alter table public.conta_gestoria_diferencia add column if not exists crm text;
alter table public.conta_gestoria_diferencia add column if not exists tipo_ficha text;
alter table public.conta_gestoria_diferencia add column if not exists id_externo text;
update public.conta_gestoria_diferencia set crm = 'bitrix24', tipo_ficha = 'empresa', id_externo = bitrix_id where bitrix_id is not null and id_externo is null;
alter table public.conta_gestoria_diferencia drop constraint if exists conta_gestoria_diferencia_ficha_check;
alter table public.conta_gestoria_diferencia add constraint conta_gestoria_diferencia_ficha_check
  check ((id_externo is null and tipo_ficha is null) or (id_externo is not null and crm is not null and tipo_ficha in ('empresa', 'contacto')));

-- 4 · Los dos porqués nuevos de «Pendiente de revisar» (solo amplía).
alter table public.conta_gestoria_diferencia drop constraint if exists conta_gestoria_diferencia_tipo_check;
alter table public.conta_gestoria_diferencia add constraint conta_gestoria_diferencia_tipo_check check (tipo = any (array[
  'bitrix_sin_cobro', 'gocardless_sin_ficha', 'emisor_distinto', 'nif_repetido_en_bitrix', 'correo_repetido_en_bitrix', 'nif_distinto',
  'suscripcion_sin_convertir', 'totales_distintos', 'mandato_por_firmar', 'falla_a_menudo', 'abono_en_otra_cuenta',
  'fichas_repetidas', 'nif_no_valido', 'ficha_no_guardada', 'contacto_solo_negociacion', 'contacto_empresa_con_datos']));

-- 3 · Las vistas de consulta: sus columnas neutras, al final (las de antes las quita la tanda siguiente).
create or replace view public.conta_consulta_clientes with (security_invoker = true) as
 SELECT c.account_id AS cuenta_id,
    c.party_id AS cliente_id,
    p.name AS cliente,
    p.tax_id AS nif,
    c.situacion,
    c.servicios,
    c.forma_pago_bitrix AS forma_de_pago_en_bitrix,
    e.id AS emisor_id,
    COALESCE(e.trade_name, e.legal_name) AS emisor,
    cc.forma_cobro AS forma_de_cobro,
    cc.gc_cliente_id AS cliente_en_gocardless,
    ( SELECT m.estado
           FROM conta_gc_mandato m
          WHERE m.company_id = e.id AND m.gc_cliente_id = cc.gc_cliente_id
          ORDER BY m.creado DESC NULLS LAST
         LIMIT 1) AS mandato,
    ( SELECT count(*) AS count
           FROM conta_linea l
          WHERE l.party_id = c.party_id AND l.company_id = e.id AND l.tipo = 'cuota'::text AND l.desde <= date_trunc('month'::text, CURRENT_DATE::timestamp with time zone)::date AND (l.hasta IS NULL OR l.hasta >= date_trunc('month'::text, CURRENT_DATE::timestamp with time zone)::date)) AS lineas_de_alta,
    ( SELECT sum(conta_linea_al_mes(l.id, date_trunc('month'::text, CURRENT_DATE::timestamp with time zone)::date)) AS sum
           FROM conta_linea l
          WHERE l.party_id = c.party_id AND l.company_id = e.id) AS al_mes_en_sumied,
    ( SELECT sum(s.al_mes) AS sum
           FROM conta_gc_suscripcion s
             JOIN conta_gc_cliente g ON g.company_id = s.company_id AND g.gc_id = s.gc_cliente_id
          WHERE g.party_id = c.party_id AND s.company_id = e.id AND s.estado = 'active'::text) AS al_mes_en_gocardless,
    ( SELECT max(b.fecha) AS max
           FROM conta_gc_cobro b
             JOIN conta_gc_mandato m ON m.company_id = b.company_id AND m.gc_id = b.mandato_gc_id
          WHERE m.gc_cliente_id = cc.gc_cliente_id AND b.company_id = e.id) AS ultimo_cobro,
    ( SELECT count(*) AS count
           FROM conta_gestoria_diferencia d
          WHERE d.party_id = c.party_id AND d.vigente) AS diferencias,
    c.cuenta_propia_account_id AS cuenta_propia_id,
    c.leido_at AS leido_de_bitrix,
    c.crm,
    c.tipo_ficha,
    c.id_externo AS ficha_en_el_crm,
    c.forma_pago_crm AS forma_de_pago_en_el_crm,
    c.leido_at AS leido_del_crm
   FROM conta_gestoria_cliente c
     JOIN party p ON p.id = c.party_id
     LEFT JOIN company e ON e.account_id = c.account_id
     LEFT JOIN conta_cobro_cliente cc ON cc.party_id = c.party_id AND cc.company_id = e.id;

create or replace view public.conta_consulta_diferencias with (security_invoker = true) as
 SELECT d.account_id AS cuenta_id,
    d.id AS diferencia_id,
    d.tipo,
    d.porque_codigo,
    d.porque,
    d.datos,
    d.party_id AS cliente_id,
    p.name AS cliente,
    COALESCE(e.trade_name, e.legal_name) AS emisor,
    d.bitrix_id AS ficha_en_bitrix,
    d.gc_cliente_id AS cliente_en_gocardless,
    l.empezada_at AS leida_el,
    d.crm,
    d.tipo_ficha,
    d.id_externo AS ficha_en_el_crm
   FROM conta_gestoria_diferencia d
     JOIN conta_gestoria_lectura l ON l.id = d.lectura_id
     LEFT JOIN party p ON p.id = d.party_id
     LEFT JOIN company e ON e.id = d.company_id
  WHERE d.vigente;

-- 5 · Las funciones neutras. Las de antes, guardadas (_respaldar_funcion) y pasando a las nuevas con 'bitrix24'.
select public._respaldar_funcion('public.conta_bitrix_guardar_clientes(uuid,jsonb)', '20261107T1925_g01c_crm_y_contactos');
select public._respaldar_funcion('public.conta_bitrix_confirmar_mapa(uuid,jsonb)', '20261107T1925_g01c_crm_y_contactos');
select public._respaldar_funcion('public.conta_bitrix_aplicar_union(uuid)', '20261107T1925_g01c_crm_y_contactos');
select public._respaldar_funcion('public.conta_bitrix_guardar_conexion(uuid,text,text,text,text)', '20261107T1925_g01c_crm_y_contactos');
select public._respaldar_funcion('public.conta_bitrix_secreto(uuid)', '20261107T1925_g01c_crm_y_contactos');
select public._respaldar_funcion('public.conta_gestoria_despertar()', '20261107T1925_g01c_crm_y_contactos');

-- 5a · Guardar los clientes de un CRM. Cada ficha: { idExterno (o bitrixId, lo de antes), tipoFicha (empresa si no lo dice), … }.
create or replace function public.conta_crm_guardar_clientes(p_account uuid, p_crm text, p_clientes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c jsonb; f jsonb; v_p jsonb; v_claves text[]; v_ids text[]; v_clave_p text; v_tipo_p text; v_id_p text; v_partes uuid[]; v_party uuid; v_huella text; v_antes text;
        v_nif text; v_nif_crm text; v_motivo text; v_otro uuid; v_ext jsonb; v_juntados int := 0; v_nuevos int := 0; v_cambiados int := 0; v_iguales int := 0;
        v_errores jsonb := '[]'::jsonb; v_otras jsonb; v_porque text; v_emisor uuid; v_es_bitrix boolean := p_crm = 'bitrix24';
begin
  if not exists (select 1 from public.accounts where id = p_account) then raise exception 'La cuenta no existe.' using errcode = 'P0002'; end if;
  if coalesce(p_crm, '') !~ '^[a-z0-9_]+$' then raise exception 'Falta el CRM.' using errcode = '22023'; end if;
  for c in select * from jsonb_array_elements(coalesce(p_clientes, '[]'::jsonb)) loop
    v_p := c->'principal';
    -- La clave de cada ficha: su tipo y su id externo.
    v_claves := array(select coalesce(nullif(x->>'tipoFicha', ''), 'empresa') || ':' || coalesce(nullif(x->>'idExterno', ''), x->>'bitrixId')
                        from jsonb_array_elements(coalesce(c->'fichas', '[]'::jsonb)) x where coalesce(nullif(x->>'idExterno', ''), x->>'bitrixId', '') <> '');
    v_ids := array(select coalesce(nullif(x->>'idExterno', ''), x->>'bitrixId') from jsonb_array_elements(coalesce(c->'fichas', '[]'::jsonb)) x
                    where coalesce(nullif(x->>'idExterno', ''), x->>'bitrixId', '') <> '');
    v_tipo_p := coalesce(nullif(v_p->>'tipoFicha', ''), 'empresa');
    v_id_p := coalesce(nullif(v_p->>'idExterno', ''), v_p->>'bitrixId');
    v_clave_p := v_tipo_p || ':' || v_id_p;
    if coalesce(v_id_p, '') = '' or cardinality(v_claves) = 0 then continue; end if;
    begin
      v_huella := md5(c::text);
      v_motivo := nullif(c->>'motivo', '');
      v_nif := nullif(public.party_nif(nullif(c->>'nif', '')), '');
      v_nif_crm := nullif(public.party_nif(nullif(v_p->>'nif', '')), '');
      v_ext := case when jsonb_typeof(c->'idExtranjero') = 'object' then c->'idExtranjero' end;
      v_emisor := (select id from public.company where id::text = coalesce(v_p->>'emisorSegunCrm', v_p->>'emisorSegunBitrix') and account_id = p_account);
      -- El cliente: el de sus fichas (si ya estaban) o, si no, el de su NIF.
      select coalesce(array_agg(distinct x.party_id), '{}') into v_partes from (
        select party_id from public.conta_gestoria_ficha where account_id = p_account and crm = p_crm and de_empresa = '' and (tipo_ficha || ':' || id_externo) = any(v_claves)
        union select party_id from public.conta_gestoria_cliente where account_id = p_account and crm = p_crm and (tipo_ficha || ':' || id_externo) = any(v_claves)) x;
      if cardinality(v_partes) > 1 then
        -- G01b (07/11) · Sin la unión aplicada, no se junta nada.
        if c->>'clave' not like 'nif:%' then
          raise exception 'sus % fichas de % ya son % clientes distintos en Sumied', cardinality(v_claves), public._conta_crm_nombre(p_crm), cardinality(v_partes) using errcode = 'P0001';
        end if;
        -- Con ella, los clientes ya creados por separado se juntan en uno: el que ya tenía la ficha principal; si no, el que
        -- más tiene colgado de la gestoría (líneas, mandatos, GoCardless); si no, el más antiguo. Los otros, retirados.
        select x into v_party from unnest(v_partes) x
         order by (exists (select 1 from public.conta_gestoria_cliente g where g.party_id = x and g.crm = p_crm and (g.tipo_ficha || ':' || g.id_externo) = v_clave_p))::int desc,
                  ((select count(*) from public.conta_linea l where l.party_id = x) + (select count(*) from public.conta_mandato m where m.party_id = x)
                   + (select count(*) from public.conta_gc_cliente k where k.party_id = x)) desc,
                  (select p.created_at from public.party p where p.id = x), x
         limit 1;
        foreach v_otro in array v_partes loop
          if v_otro <> v_party then
            perform public._conta_gestoria_juntar(p_account, v_party, v_otro,
              'el mismo NIF en ' || public._conta_crm_nombre(p_crm) || ' (fichas ' || array_to_string(v_ids, ', ') || ')');
            v_juntados := v_juntados + 1;
          end if;
        end loop;
        v_partes := array[v_party];
      end if;
      v_party := v_partes[1];
      -- Por su NIF, solo con la unión aplicada (clave «nif:…»): sin aplicar no se une nada, ni a escondidas.
      if v_party is null and v_nif is not null and c->>'clave' like 'nif:%' then
        select id into v_party from public.party where account_id = p_account and tax_id = v_nif;
        if exists (select 1 from public.conta_gestoria_cliente g where g.party_id = v_party and g.id_externo is not null
                    and (g.crm <> p_crm or (g.tipo_ficha || ':' || g.id_externo) <> all(v_claves))) then
          raise exception 'su NIF ya es de otro cliente de Sumied, con otra ficha de %', public._conta_crm_nombre(p_crm) using errcode = 'P0001';
        end if;
      end if;
      select g.huella into v_antes from public.conta_gestoria_cliente g where g.party_id = v_party;
      if v_party is null then
        insert into public.party (account_id, name, tax_id, source, created_by_name)
        values (p_account, coalesce(nullif(trim(v_p->>'nombre'), ''),
                  case when v_tipo_p = 'contacto' then 'Contacto ' else 'Empresa ' end || v_id_p || ' de ' || public._conta_crm_nombre(p_crm)), v_nif, 'crm', public._conta_crm_nombre(p_crm))
        returning id into v_party;
        v_nuevos := v_nuevos + 1;
      elsif v_antes is distinct from v_huella then
        -- Un NIF que no se usa (sin formato o en 10 fichas o más) se quita si era el que se le puso antes.
        update public.party set name = coalesce(nullif(trim(v_p->>'nombre'), ''), name),
               tax_id = case when v_motivo in ('nif_no_valido', 'nif_en_muchas') and tax_id is not distinct from v_nif_crm then null else coalesce(v_nif, tax_id) end,
               updated_at = now()
         where id = v_party and account_id = p_account;
        v_cambiados := v_cambiados + 1;
      else
        v_iguales := v_iguales + 1;
        update public.conta_gestoria_cliente set leido_at = now() where party_id = v_party;
        update public.conta_gestoria_ficha set leido_at = now()
         where account_id = p_account and crm = p_crm and de_empresa = '' and (tipo_ficha || ':' || id_externo) = any(v_claves);
        continue;
      end if;
      -- G01c · Un identificador fiscal extranjero (el RIF de Venezuela): su tipo y su país. Lo demás, como estaba.
      insert into public.customer_fiscal (party_id, account_id, legal_name, fiscal_street, fiscal_postal_code, fiscal_city, fiscal_province, tax_id_type, country_code)
      values (v_party, p_account, nullif(trim(v_p->>'nombre'), ''), nullif(v_p->>'calle', ''), nullif(v_p->>'cp', ''), nullif(v_p->>'poblacion', ''), nullif(v_p->>'provincia', ''),
              v_ext->>'tipo', coalesce(v_ext->>'pais', 'ES'))
      on conflict (party_id) do update set legal_name = coalesce(excluded.legal_name, customer_fiscal.legal_name),
        fiscal_street = excluded.fiscal_street, fiscal_postal_code = excluded.fiscal_postal_code, fiscal_city = excluded.fiscal_city,
        fiscal_province = excluded.fiscal_province,
        tax_id_type = case when v_ext is not null then excluded.tax_id_type else customer_fiscal.tax_id_type end,
        country_code = case when v_ext is not null then excluded.country_code else customer_fiscal.country_code end,
        updated_at = now();
      -- Las otras fichas del cliente, para la ficha («Lo que dice tu CRM»).
      select coalesce(jsonb_agg(jsonb_build_object('idExterno', coalesce(nullif(x->>'idExterno', ''), x->>'bitrixId'), 'tipoFicha', coalesce(nullif(x->>'tipoFicha', ''), 'empresa'),
               'nombre', x->>'nombre', 'situacion', x->'situacion', 'situacionTexto', x->'situacionTexto')), '[]'::jsonb)
        into v_otras from jsonb_array_elements(c->'fichas') x
       where coalesce(nullif(x->>'tipoFicha', ''), 'empresa') || ':' || coalesce(nullif(x->>'idExterno', ''), x->>'bitrixId') <> v_clave_p;
      -- bitrix_id, solo mientras dura el cambio y en las empresas de Bitrix24 (lo que lee lo publicado).
      insert into public.conta_gestoria_cliente (party_id, account_id, crm, tipo_ficha, id_externo, bitrix_id, situacion, servicios, forma_pago_crm, forma_pago_bitrix,
                                                 emisor_segun_crm, emisor_segun_bitrix, ficha, huella, leido_at)
      values (v_party, p_account, p_crm, v_tipo_p, v_id_p, case when v_es_bitrix and v_tipo_p = 'empresa' then v_id_p end, nullif(c->>'situacion', ''),
              coalesce(array(select jsonb_array_elements_text(coalesce(v_p->'servicios', '[]'::jsonb))), '{}'), nullif(v_p->>'formaPago', ''), nullif(v_p->>'formaPago', ''),
              v_emisor, v_emisor, v_p || jsonb_build_object('otrasFichas', v_otras, 'motivo', v_motivo), v_huella, now())
      on conflict (party_id) do update set crm = excluded.crm, tipo_ficha = excluded.tipo_ficha, id_externo = excluded.id_externo, bitrix_id = excluded.bitrix_id,
        situacion = excluded.situacion, servicios = excluded.servicios, forma_pago_crm = excluded.forma_pago_crm, forma_pago_bitrix = excluded.forma_pago_bitrix,
        emisor_segun_crm = excluded.emisor_segun_crm, emisor_segun_bitrix = excluded.emisor_segun_bitrix, ficha = excluded.ficha, huella = excluded.huella, leido_at = now();
      for f in select * from jsonb_array_elements(c->'fichas') loop
        insert into public.conta_gestoria_ficha (account_id, crm, tipo_ficha, id_externo, de_empresa, bitrix_id, party_id, situacion, ficha, huella, leido_at)
        values (p_account, p_crm, coalesce(nullif(f->>'tipoFicha', ''), 'empresa'), coalesce(nullif(f->>'idExterno', ''), f->>'bitrixId'), '',
                case when v_es_bitrix and coalesce(nullif(f->>'tipoFicha', ''), 'empresa') = 'empresa' then coalesce(nullif(f->>'idExterno', ''), f->>'bitrixId') end,
                v_party, nullif(f->>'situacion', ''), f, md5(f::text), now())
        on conflict (account_id, crm, tipo_ficha, id_externo, de_empresa) do update set party_id = excluded.party_id, situacion = excluded.situacion,
          ficha = excluded.ficha, huella = excluded.huella, leido_at = now();
      end loop;
      -- Una ficha que ya no es de este cliente deja de colgar de él (la recoge el suyo). Sus personas de contacto, no: las guarda guardar_personas.
      delete from public.conta_gestoria_ficha
       where account_id = p_account and party_id = v_party and crm = p_crm and de_empresa = '' and (tipo_ficha || ':' || id_externo) <> all(v_claves);
    exception when others then
      v_porque := case when sqlstate = '23505' and sqlerrm like '%ux_party_nif%' then 'su NIF ya es de otro cliente de Sumied'
                       when sqlstate = '23505' then 'choca con otro cliente de Sumied (' || sqlerrm || ')'
                       else sqlerrm end;
      v_errores := v_errores || jsonb_build_array(jsonb_build_object('idsExternos', to_jsonb(v_ids), 'bitrixIds', to_jsonb(v_ids), 'tipoFicha', v_tipo_p, 'principal', v_clave_p,
        'nombre', v_p->>'nombre', 'emisor', coalesce(v_p->>'emisorSegunCrm', v_p->>'emisorSegunBitrix'), 'codigo', sqlstate, 'porque', v_porque));
    end;
  end loop;
  return jsonb_build_object('nuevos', v_nuevos, 'cambiados', v_cambiados, 'iguales', v_iguales, 'juntados', v_juntados, 'errores', v_errores);
end $$;
comment on function public.conta_crm_guardar_clientes(uuid, text, jsonb) is
  'G01c · Guarda los clientes leídos de un CRM (cada uno con sus fichas: empresas y contactos), con la unión por NIF si está aplicada y el identificador fiscal extranjero. Solo el servidor.';
revoke all on function public.conta_crm_guardar_clientes(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.conta_crm_guardar_clientes(uuid, text, jsonb) to service_role;

create or replace function public.conta_bitrix_guardar_clientes(p_account uuid, p_clientes jsonb)
returns jsonb language sql security definer set search_path = public as $$
  select public.conta_crm_guardar_clientes(p_account, 'bitrix24', p_clientes)
$$;
comment on function public.conta_bitrix_guardar_clientes(uuid, jsonb) is 'G01c · De paso, mientras dura el cambio: conta_crm_guardar_clientes con «bitrix24». La quita la tanda siguiente.';
revoke all on function public.conta_bitrix_guardar_clientes(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conta_bitrix_guardar_clientes(uuid, jsonb) to service_role;

-- 5b · Las personas de contacto: cada contacto con empresa, colgando del cliente de cada una de sus empresas.
create or replace function public.conta_crm_guardar_personas(p_account uuid, p_crm text, p_personas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x jsonb; v_party uuid; v_guardadas int := 0; v_sin_cliente int := 0; v_quitadas int := 0; v_claves text[] := '{}';
begin
  if not exists (select 1 from public.accounts where id = p_account) then raise exception 'La cuenta no existe.' using errcode = 'P0002'; end if;
  if coalesce(p_crm, '') !~ '^[a-z0-9_]+$' then raise exception 'Falta el CRM.' using errcode = '22023'; end if;
  -- Cada persona: { empresa: id externo de la empresa, contacto: { idExterno, nombre, correos, telefonos } }. Todas a la vez: las que no vienen, se quitan.
  for x in select * from jsonb_array_elements(coalesce(p_personas, '[]'::jsonb)) loop
    if coalesce(x->>'empresa', '') = '' or coalesce(x->'contacto'->>'idExterno', '') = '' then continue; end if;
    v_party := null;
    select party_id into v_party from public.conta_gestoria_ficha
     where account_id = p_account and crm = p_crm and tipo_ficha = 'empresa' and id_externo = x->>'empresa' and de_empresa = '';
    if v_party is null then v_sin_cliente := v_sin_cliente + 1; continue; end if;
    insert into public.conta_gestoria_ficha (account_id, crm, tipo_ficha, id_externo, de_empresa, party_id, situacion, ficha, huella, leido_at)
    values (p_account, p_crm, 'contacto', x->'contacto'->>'idExterno', x->>'empresa', v_party, null, x->'contacto', md5((x->'contacto')::text), now())
    on conflict (account_id, crm, tipo_ficha, id_externo, de_empresa) do update set party_id = excluded.party_id, ficha = excluded.ficha, huella = excluded.huella, leido_at = now();
    v_claves := v_claves || ((x->'contacto'->>'idExterno') || '@' || (x->>'empresa'));
    v_guardadas := v_guardadas + 1;
  end loop;
  -- Las que ya no lo son (el contacto dejó la empresa en el CRM) dejan de estar.
  delete from public.conta_gestoria_ficha
   where account_id = p_account and crm = p_crm and tipo_ficha = 'contacto' and de_empresa <> '' and (id_externo || '@' || de_empresa) <> all(v_claves);
  get diagnostics v_quitadas = row_count;
  return jsonb_build_object('guardadas', v_guardadas, 'sinCliente', v_sin_cliente, 'quitadas', v_quitadas);
end $$;
comment on function public.conta_crm_guardar_personas(uuid, text, jsonb) is
  'G01c · Las personas de contacto de un CRM (los contactos con empresa): una ficha por contacto y empresa, colgando del cliente de esa empresa. Las que ya no lo son se quitan. Solo el servidor.';
revoke all on function public.conta_crm_guardar_personas(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.conta_crm_guardar_personas(uuid, text, jsonb) to service_role;

-- 5c · Confirmar el mapa de las empresas o de los contactos de un CRM.
create or replace function public.conta_crm_confirmar_mapa(p_account uuid, p_crm text, p_tipo_ficha text, p_mapa jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_b public.conta_crm; v_medidos jsonb; v_cod text; v_faltan text[] := '{}'; v_sit jsonb; v_it jsonb; v_op text; v_sin_op text[] := '{}';
        v_quien text := public.conta_nombre_actor(); v_mapa jsonb; v_n int; v_frase text; v_nombre text := public._conta_crm_nombre(p_crm);
        v_validas constant text[] := array['activo', 'baja', 'moroso', 'solo_renta', 'sin_clasificar'];
        v_cuando text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  if not public.current_user_is_admin_or_manager_of(p_account) then
    raise exception 'Solo un administrador o un encargado de la cuenta confirma el mapa de %.', v_nombre using errcode = '42501';
  end if;
  if p_tipo_ficha not in ('empresa', 'contacto') then raise exception 'El mapa es de las empresas o de los contactos.' using errcode = '22023'; end if;
  select * into v_b from public.conta_crm where account_id = p_account and crm = p_crm for update;
  if v_b.account_id is null then raise exception 'Esta cuenta no tiene conectado %.', v_nombre using errcode = 'P0002'; end if;
  v_medidos := case p_tipo_ficha when 'empresa' then v_b.campos_medidos else v_b.campos_medidos_contactos end;
  if v_medidos is null then
    raise exception '%', case p_tipo_ficha when 'empresa' then format('Faltan los campos medidos del portal: vuelve a conectar %s.', v_nombre)
      else format('Aún no se han medido los campos de contacto del portal: lee %s y vuelve a confirmarlo.', v_nombre) end using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_mapa) is distinct from 'object' then raise exception 'El mapa no trae sus campos.' using errcode = '22023'; end if;

  if p_tipo_ficha = 'contacto' then
    for v_cod in
      select x from (values (p_mapa->>'nif'), (p_mapa->>'cuota'), (p_mapa->>'tipoCliente'), (p_mapa->'direccion'->>'calle'), (p_mapa->'direccion'->>'cp'),
                            (p_mapa->'direccion'->>'poblacion'), (p_mapa->'direccion'->>'provincia')) v(x) where coalesce(x, '') <> ''
    loop
      if not (v_medidos ? v_cod) then v_faltan := v_faltan || v_cod; end if;
    end loop;
    if cardinality(v_faltan) > 0 then
      raise exception 'Los contactos de este % no tienen estos campos: %.', v_nombre, array_to_string(v_faltan, ', ') using errcode = '22023';
    end if;
    v_mapa := jsonb_build_object('nif', p_mapa->'nif', 'direccion', p_mapa->'direccion', 'cuota', p_mapa->'cuota', 'tipoCliente', p_mapa->'tipoCliente',
      'textosTipo', coalesce(p_mapa->'textosTipo', '{}'::jsonb), 'confirmado', jsonb_build_object('quien', v_quien, 'cuando', v_cuando));
    update public.conta_crm set mapa_contactos = v_mapa, updated_at = now() where account_id = p_account and crm = p_crm;
    v_frase := format('Mapa de los contactos de %s confirmado por %s. Los contactos entran en Sumied desde la próxima lectura.', v_nombre, coalesce(v_quien, 'una persona de la cuenta'));
    return jsonb_build_object('frase', v_frase, 'confirmado', v_mapa->'confirmado');
  end if;

  -- Las empresas: lo de siempre (G01b · 0915).
  if jsonb_typeof(p_mapa->'campos') is distinct from 'array' then raise exception 'El mapa no trae sus campos.' using errcode = '22023'; end if;
  for v_cod in
    select c->>'codigo' from jsonb_array_elements(p_mapa->'campos') c where coalesce(c->>'codigo', '') <> ''
    union all
    select x from jsonb_array_elements(coalesce(p_mapa->'direcciones', '[]'::jsonb)) d,
           lateral (values (d->>'calle'), (d->>'cp'), (d->>'poblacion'), (d->>'provincia')) v(x) where coalesce(x, '') <> ''
  loop
    if not (v_medidos ? v_cod) then v_faltan := v_faltan || v_cod; end if;
  end loop;
  if cardinality(v_faltan) > 0 then
    raise exception 'Este % no tiene estos campos: %.', v_nombre, array_to_string(v_faltan, ', ') using errcode = '22023';
  end if;
  select count(*) into v_n from jsonb_array_elements(p_mapa->'campos') c where c->>'campo' = 'situacion' and coalesce(c->>'codigo', '') <> '';
  if v_n <> 1 then raise exception 'Falta decir qué campo de % es la situación del cliente.', v_nombre using errcode = '22023'; end if;
  select c into v_sit from jsonb_array_elements(p_mapa->'campos') c where c->>'campo' = 'situacion' and coalesce(c->>'codigo', '') <> '';
  for v_it in select * from jsonb_array_elements(coalesce(v_medidos->(v_sit->>'codigo')->'items', '[]'::jsonb)) loop
    v_op := v_sit->'opciones'->>(v_it->>'ID');
    if v_op is null or not (v_op = any (v_validas)) then v_sin_op := v_sin_op || (v_it->>'VALUE'); end if;
  end loop;
  if cardinality(v_sin_op) > 0 then
    raise exception 'Falta decir qué es en Sumied: %.', array_to_string(v_sin_op, ', ') using errcode = '22023';
  end if;
  v_mapa := (p_mapa - 'dudas') || jsonb_build_object('dudas', '[]'::jsonb, 'confirmado', jsonb_build_object('quien', v_quien, 'cuando', v_cuando));
  update public.conta_crm set mapa = v_mapa, updated_at = now() where account_id = p_account and crm = p_crm;
  select count(*) into v_n from jsonb_array_elements(p_mapa->'campos') c where coalesce(c->>'codigo', '') <> '';
  v_frase := format('Mapa de %s confirmado por %s: %s campos y %s fuentes de la dirección. La situación se guarda desde la próxima lectura.',
    v_nombre, coalesce(v_quien, 'una persona de la cuenta'), v_n, jsonb_array_length(coalesce(p_mapa->'direcciones', '[]'::jsonb)));
  return jsonb_build_object('frase', v_frase, 'confirmado', v_mapa->'confirmado');
end $$;
comment on function public.conta_crm_confirmar_mapa(uuid, text, text, jsonb) is
  'G01c · «Qué es cada campo»: una persona administradora o encargada confirma el mapa de las empresas o de los contactos de su CRM (con quién y cuándo).';
revoke all on function public.conta_crm_confirmar_mapa(uuid, text, text, jsonb) from public, anon;
grant execute on function public.conta_crm_confirmar_mapa(uuid, text, text, jsonb) to authenticated, service_role;

create or replace function public.conta_bitrix_confirmar_mapa(p_account uuid, p_mapa jsonb)
returns jsonb language sql security definer set search_path = public as $$
  select public.conta_crm_confirmar_mapa(p_account, 'bitrix24', 'empresa', p_mapa)
$$;
comment on function public.conta_bitrix_confirmar_mapa(uuid, jsonb) is 'G01c · De paso, mientras dura el cambio: conta_crm_confirmar_mapa con «bitrix24» y las empresas. La quita la tanda siguiente.';
revoke all on function public.conta_bitrix_confirmar_mapa(uuid, jsonb) from public, anon;
grant execute on function public.conta_bitrix_confirmar_mapa(uuid, jsonb) to authenticated, service_role;

-- 5d · Aplicar la unión de las fichas de un CRM.
create or replace function public.conta_crm_aplicar_union(p_account uuid, p_crm text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_b public.conta_crm; v_quien text := public.conta_nombre_actor(); v_union jsonb; v_nombre text := public._conta_crm_nombre(p_crm);
begin
  if not public.current_user_is_admin_or_manager_of(p_account) then
    raise exception 'Solo un administrador o un encargado de la cuenta aplica la unión de las fichas de %.', v_nombre using errcode = '42501';
  end if;
  select * into v_b from public.conta_crm where account_id = p_account and crm = p_crm for update;
  if v_b.account_id is null then raise exception 'Esta cuenta no tiene conectado %.', v_nombre using errcode = 'P0002'; end if;
  if v_b.mapa->'confirmado' is null or v_b.mapa->'confirmado' = 'null'::jsonb then
    raise exception 'Primero hay que confirmar el mapa en «Qué es cada campo».' using errcode = '22023';
  end if;
  v_union := jsonb_build_object('quien', v_quien, 'cuando', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  update public.conta_crm set mapa = mapa || jsonb_build_object('union', v_union), updated_at = now() where account_id = p_account and crm = p_crm;
  return jsonb_build_object('frase', format('Unión aplicada por %s: la próxima lectura une las fichas de %s con el mismo NIF en un solo cliente.',
    coalesce(v_quien, 'una persona de la cuenta'), v_nombre), 'union', v_union);
end $$;
comment on function public.conta_crm_aplicar_union(uuid, text) is 'G01c · Una persona administradora o encargada aplica la unión de las fichas de su CRM (mismo NIF = un cliente).';
revoke all on function public.conta_crm_aplicar_union(uuid, text) from public, anon;
grant execute on function public.conta_crm_aplicar_union(uuid, text) to authenticated, service_role;

create or replace function public.conta_bitrix_aplicar_union(p_account uuid)
returns jsonb language sql security definer set search_path = public as $$
  select public.conta_crm_aplicar_union(p_account, 'bitrix24')
$$;
comment on function public.conta_bitrix_aplicar_union(uuid) is 'G01c · De paso, mientras dura el cambio: conta_crm_aplicar_union con «bitrix24». La quita la tanda siguiente.';
revoke all on function public.conta_bitrix_aplicar_union(uuid) from public, anon;
grant execute on function public.conta_bitrix_aplicar_union(uuid) to authenticated, service_role;

-- 5e · Lo del adaptador de Bitrix24 (la dirección del webhook en Vault), sobre conta_crm.
create or replace function public.conta_bitrix_guardar_conexion(p_account uuid, p_entorno text, p_url text, p_portal text, p_quien text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ref uuid; v_nombre text := 'conta_bitrix:' || p_account::text;
begin
  if not exists (select 1 from public.accounts where id = p_account) then raise exception 'La cuenta no existe.' using errcode = 'P0002'; end if;
  if p_entorno not in ('real', 'pruebas') then raise exception 'Entorno: real o pruebas.' using errcode = '22023'; end if;
  if coalesce(trim(p_url), '') !~ '^https://[A-Za-z0-9.-]+/rest/[0-9]+/[A-Za-z0-9]+/?$' then
    raise exception 'La dirección de Bitrix24 es como https://<tu portal>/rest/<número>/<clave>/ (Bitrix24 › Aplicaciones › Webhooks › Webhook entrante).' using errcode = '22023';
  end if;
  select url_ref into v_ref from public.conta_crm where account_id = p_account and crm = 'bitrix24' for update;
  if v_ref is null or not exists (select 1 from vault.secrets where id = v_ref) then
    select id into v_ref from vault.secrets where name = v_nombre;
  end if;
  if v_ref is not null then
    perform vault.update_secret(v_ref, trim(p_url), v_nombre, 'Dirección de lectura de Bitrix24 de una cuenta de Sumied');
  else
    v_ref := vault.create_secret(trim(p_url), v_nombre, 'Dirección de lectura de Bitrix24 de una cuenta de Sumied');
  end if;
  insert into public.conta_crm (account_id, crm, entorno, url_ref, portal, conectada_at, conectada_por_name, updated_at)
  values (p_account, 'bitrix24', p_entorno, v_ref, p_portal, now(), p_quien, now())
  on conflict (account_id, crm) do update set entorno = excluded.entorno, url_ref = excluded.url_ref, portal = excluded.portal,
    conectada_at = excluded.conectada_at, conectada_por_name = excluded.conectada_por_name, updated_at = now();
end $$;
revoke all on function public.conta_bitrix_guardar_conexion(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.conta_bitrix_guardar_conexion(uuid, text, text, text, text) to service_role;

create or replace function public.conta_bitrix_secreto(p_account uuid)
returns table(entorno text, url text, mapa jsonb) language sql stable security definer set search_path = public as $$
  select b.entorno, s.decrypted_secret, b.mapa
    from public.conta_crm b join vault.decrypted_secrets s on s.id = b.url_ref
   where b.account_id = p_account and b.crm = 'bitrix24'
$$;
revoke all on function public.conta_bitrix_secreto(uuid) from public, anon, authenticated;
grant execute on function public.conta_bitrix_secreto(uuid) to service_role;

-- 6 · Despertar la lectura de cada noche: cada CRM conectado, con su función; GoCardless solo, donde no hay CRM.
create or replace function public.conta_gestoria_despertar()
returns void language plpgsql security definer set search_path = public as $$
declare v_secreto text; r record; v_funcion text;
begin
  if extract(hour from (now() at time zone 'Europe/Madrid')) <> 4 then return; end if;
  if not exists (select 1 from public.conta_crm) and not exists (select 1 from public.conta_cobro_gocardless) then return; end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
  if v_secreto is null then
    raise exception 'Falta cron_secret en el Vault: no se puede despertar la lectura de la gestoría.' using errcode = '55000';
  end if;
  for r in select account_id, crm from public.conta_crm where url_ref is not null loop
    -- La función de lectura de cada CRM (otro CRM, otra línea).
    v_funcion := case r.crm when 'bitrix24' then 'conta-bitrix-leer' end;
    continue when v_funcion is null;
    perform net.http_post(url := public._project_url() || '/functions/v1/' || v_funcion,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
      body := jsonb_build_object('accion', 'leer', 'cuenta', r.account_id, 'por', 'cada_noche'), timeout_milliseconds := 150000);
  end loop;
  for r in select g.company_id from public.conta_cobro_gocardless g
            where g.token_ref is not null and not exists (select 1 from public.conta_crm b where b.account_id = g.account_id and b.url_ref is not null) loop
    perform net.http_post(url := public._project_url() || '/functions/v1/conta-gocardless-leer',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
      body := jsonb_build_object('accion', 'leer', 'empresa', r.company_id, 'por', 'cada_noche'), timeout_milliseconds := 150000);
  end loop;
end $$;
