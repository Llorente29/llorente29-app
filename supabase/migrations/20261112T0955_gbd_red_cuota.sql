-- supabase/migrations/20261112T0955_gbd_red_cuota.sql
--
-- GBd · El plan B, en PRUEBAS: la red de seguridad de la «Cuota mensual» de la
-- ficha de empresa de Bitrix24. Si alguien la cambia en Bitrix24, Sumied, al
-- momento (con el aviso de cambios, G01d), devuelve su valor, avisa por correo
-- a quien la cambió y a la persona responsable, y lo apunta en el historial.
-- Solo con una conexión de Bitrix24 de entorno «pruebas» (el Bitrix24 de
-- pruebas y la Gestoría Demo); en el real de QBO, más adelante y con el sí de Julio.
--
-- Solo añade:
--   1. conta_bitrix_red: lo que hace la red, una fila por devolución (qué
--      campo, de qué a qué, quién, el correo y la nota). Solo el servidor.
--   2. conta_bitrix_red_leer(cuenta, ficha): lo mismo que lee la pestaña
--      (conta_bitrix_pestana_leer) para calcular la cuota del mes que viene,
--      sin persona: lee como una administradora activa de la cuenta. Con el
--      campo de la cuota del mapa y las devoluciones de los últimos 10 minutos
--      (el freno del bucle). Solo el servidor.
--   3. conta_bitrix_red_apuntar(fila): apunta una devolución. Solo el servidor.
-- No llama a nada al aplicarse: no cambia ningún dato. Nada de cobros ni
-- recibos: solo se lee. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261112T0955_gbd_red_cuota.down.sql

-- 1 · Lo que hace la red.
create table if not exists public.conta_bitrix_red (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  crm text not null default 'bitrix24',
  tipo_ficha text not null default 'empresa' check (tipo_ficha in ('empresa', 'contacto')),
  id_externo text not null,
  campo text not null,
  antes text,
  despues text,
  quien_id text,
  quien text,
  correo text not null default 'sin_correo' check (correo in ('enviado', 'no_enviado', 'cupo', 'sin_correo')),
  correo_a text[] not null default '{}',
  correo_porque text,
  nota text not null default 'no' check (nota in ('escrita', 'no')),
  hecho_at timestamptz not null default now()
);
create index if not exists conta_bitrix_red_ficha on public.conta_bitrix_red (account_id, crm, tipo_ficha, id_externo, campo, hecho_at desc);
alter table public.conta_bitrix_red enable row level security;
revoke all on public.conta_bitrix_red from public, anon, authenticated;
comment on table public.conta_bitrix_red is
  'GBd (plan B, pruebas) · Cada vez que Sumied devuelve en Bitrix24 un campo suyo cambiado a mano (la «Cuota mensual»): de qué a qué, quién lo cambió (MODIFY_BY_ID; «no se sabe» si Bitrix24 no lo dice), el correo (enviado, no enviado o sin cupo) y la nota del historial. Solo el servidor.';

-- 2 · La lectura de la red, sin persona.
create or replace function public.conta_bitrix_red_leer(p_account uuid, p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_crm public.conta_crm; v_usuario uuid; v_cliente uuid; v_campo text; v_id text := trim(coalesce(p_id, ''));
begin
  if v_id !~ '^[0-9]{1,18}$' then return jsonb_build_object('estado', 'ficha_rara'); end if;
  select * into v_crm from public.conta_crm c where c.account_id = p_account and c.crm = 'bitrix24';
  if v_crm.account_id is null then return jsonb_build_object('estado', 'sin_crm'); end if;
  -- Solo en pruebas: en el real, la red se enciende más adelante, con el sí de Julio.
  if v_crm.entorno is distinct from 'pruebas' then return jsonb_build_object('estado', 'no_es_pruebas'); end if;

  select x->>'codigo' into v_campo from jsonb_array_elements(coalesce(v_crm.mapa->'campos', '[]'::jsonb)) x
   where x->>'campo' = 'cuota_referencia' and coalesce(x->>'codigo', '') <> ''
   order by (lower(coalesce(x->>'etiqueta', '')) = 'cuota mensual') desc limit 1;
  if v_campo is null then return jsonb_build_object('estado', 'sin_campo', 'portal', v_crm.portal); end if;

  select g.party_id into v_cliente from public.conta_gestoria_ficha g
   where g.account_id = p_account and g.crm = 'bitrix24' and g.tipo_ficha = 'empresa' and g.id_externo = v_id
   order by (g.de_empresa = '') desc, g.de_empresa limit 1;
  if v_cliente is null then
    select g.party_id into v_cliente from public.conta_gestoria_cliente g
     where g.account_id = p_account and g.crm = 'bitrix24' and g.tipo_ficha = 'empresa' and g.id_externo = v_id;
  end if;
  if v_cliente is null then return jsonb_build_object('estado', 'sin_enlazar', 'portal', v_crm.portal, 'campo', v_campo); end if;

  -- Como una administradora activa de la cuenta (DM1: «usuario:cuenta»), solo en esta transacción.
  select up.user_id into v_usuario from public.user_profiles up
   where up.account_id = p_account and up.active and up.role = 'admin' order by up.created_at limit 1;
  if v_usuario is null then return jsonb_build_object('estado', 'sin_persona', 'portal', v_crm.portal, 'campo', v_campo); end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_usuario, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', v_usuario::text || ':' || p_account::text, true);

  return jsonb_build_object(
    'estado', 'ok', 'portal', v_crm.portal, 'campo', v_campo, 'cliente', v_cliente,
    'clientes', public.conta_pantalla_clientes(p_account),
    'recientes', (select count(*) from public.conta_bitrix_red r
      where r.account_id = p_account and r.crm = 'bitrix24' and r.tipo_ficha = 'empresa' and r.id_externo = v_id
        and r.campo = v_campo and r.hecho_at > now() - interval '10 minutes'));
end $$;
revoke all on function public.conta_bitrix_red_leer(uuid, text) from public, anon, authenticated;
grant execute on function public.conta_bitrix_red_leer(uuid, text) to service_role;
comment on function public.conta_bitrix_red_leer(uuid, text) is
  'GBd (plan B, pruebas) · Lo que necesita la red de la «Cuota mensual» para una ficha de empresa de Bitrix24: el campo del mapa, el cliente y lo de Clientes (la cuota del mes que viene, como la pestaña), leído como una administradora activa de la cuenta, y las devoluciones de los últimos 10 minutos (el freno del bucle). Solo con la conexión en entorno «pruebas». Solo el servidor.';

-- 3 · Apuntar una devolución.
create or replace function public.conta_bitrix_red_apuntar(p_account uuid, p_fila jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.conta_bitrix_red (account_id, id_externo, campo, antes, despues, quien_id, quien, correo, correo_a, correo_porque, nota)
  values (p_account, p_fila->>'id_externo', p_fila->>'campo', p_fila->>'antes', p_fila->>'despues', p_fila->>'quien_id', p_fila->>'quien',
          coalesce(p_fila->>'correo', 'sin_correo'),
          coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_fila->'correo_a', '[]'::jsonb)) x), '{}'),
          left(p_fila->>'correo_porque', 200), coalesce(p_fila->>'nota', 'no'))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.conta_bitrix_red_apuntar(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conta_bitrix_red_apuntar(uuid, jsonb) to service_role;
comment on function public.conta_bitrix_red_apuntar(uuid, jsonb) is
  'GBd (plan B, pruebas) · Apunta una devolución de la red (conta_bitrix_red). Solo el servidor.';
