-- supabase/migrations/20261124T0835_x31_antes_de_enviar_mirar.sql
-- cambia: public.conta_erp10_envio · prueba: supabase/staging/sql/20261124_x31_antes_de_enviar_prueba.sql
-- cambia: public.conta_erp10_cola · prueba: supabase/staging/sql/20261124_x31_antes_de_enviar_prueba.sql
--
-- X31 · 2 · Antes de enviar a ERP10, mirar (encargo X31 y respuesta de Julio, 24/11). Lo que ya está en ERP10 no se
-- manda ni se enlaza solo: el envío queda en «duda» y lo decide una persona.
--   1. conta_erp10_envio (añade): duda (lo encontrado en ERP10: su número, y de una factura los dos totales), decision
--      («la_misma» u «otro»), quién y cuándo, y alta_pedida_en (cuándo pidió Sumied el alta: si un envío cortado a la
--      mitad vuelve y encuentra lo suyo, se enlaza solo). Y el estado «duda» en su CHECK (amplía: cambia en caliente).
--   2. conta_erp10_cola (trozo exacto, la misma firma; la de antes, guardada): lo que está en duda no lo coge la cola.
--      conta_erp10_envio_tomar no cambia: solo vuelve a coger lo que «no pudo» o lo que se quedó a medias.
--   3. conta_erp10_envio_es_la_misma: «Es la misma, no la mandes»: enlazada con lo de ERP10, sin escribir ni subir el
--      PDF. Si los totales no son iguales, solo con la diferencia mirada (p_mirada).
--   4. conta_erp10_envio_es_otro: «Es otro, mándalo», solo de un asiento (ERP10 no admite dos facturas con el mismo
--      número del mismo tercero): sale en la siguiente salida, sin volver a mirar.
--
-- Nada en el camino del pedido. El real lo lanza Julio. Vuelta atrás: quita lo nuevo y restaura la cola.

-- 1 · El envío en duda -----------------------------------------------------------------------------------------------------
alter table public.conta_erp10_envio add column if not exists duda jsonb;
alter table public.conta_erp10_envio add column if not exists decision text
  constraint conta_erp10_envio_decision_valores check (decision is null or decision in ('la_misma', 'otro'));
alter table public.conta_erp10_envio add column if not exists decision_por text;
alter table public.conta_erp10_envio add column if not exists decision_en timestamptz;
alter table public.conta_erp10_envio add column if not exists alta_pedida_en timestamptz;
comment on column public.conta_erp10_envio.duda is
  'X31 · Lo que ya estaba en ERP10 y encaja (estado «duda»): {que, ejercicio, serie, documento, cuantos, numero?, fecha?, totalErp10Cent?, totalSumiedCent?}.';
comment on column public.conta_erp10_envio.decision is 'X31 · Lo que dijo una persona de la duda: «la_misma» (enlazada, no se manda) u «otro» (un asiento: se manda).';
comment on column public.conta_erp10_envio.alta_pedida_en is
  'X31 · Cuándo pidió Sumied el alta en ERP10 (justo antes de escribir). Si el envío se cortó y vuelve, lo que encuentra es lo suyo: se enlaza.';

alter table public.conta_erp10_envio drop constraint if exists conta_erp10_envio_estado_check;
alter table public.conta_erp10_envio add constraint conta_erp10_envio_estado_check check (estado in ('enviando', 'en_erp10', 'no_pudo', 'duda'));

-- 2 · La cola no coge lo que está en duda --------------------------------------------------------------------------------
select public._respaldar_funcion('public.conta_erp10_cola(integer)', '20261124T0835_x31_antes_de_enviar_mirar');
do $do$
declare
  v_def text;
  a_viejo text := $v$         or (v.estado = 'no_pudo' and (v.intentos >= 3 or v.como = 'excel' or v.cambiado_en > now() - interval '5 minutes'))))$v$;
  a_nuevo text := $n$         or (v.estado = 'no_pudo' and (v.intentos >= 3 or v.como = 'excel' or v.cambiado_en > now() - interval '5 minutes'))
         -- X31 · Lo que ya está en ERP10 espera a una persona.
         or v.estado = 'duda'))$n$;
begin
  v_def := pg_get_functiondef('public.conta_erp10_cola(integer)'::regprocedure);
  if strpos(v_def, 'X31 · Lo que ya está en ERP10 espera') > 0 then return; end if;   -- ya pasada
  if (length(v_def) - length(replace(v_def, a_viejo, ''))) / length(a_viejo) <> 1 then
    raise exception 'X31 · 0835: conta_erp10_cola no es la medida (su trozo no está una sola vez): no se toca.';
  end if;
  execute replace(v_def, a_viejo, a_nuevo);
end $do$;

-- 3 · «Es la misma, no la mandes» ----------------------------------------------------------------------------------------
create or replace function public.conta_erp10_envio_es_la_misma(p_envio uuid, p_mirada boolean default false, p_quien_nombre text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare v public.conta_erp10_envio; d jsonb; v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
begin
  select * into v from public.conta_erp10_envio where id = p_envio for update;
  if v.id is null then raise exception 'Ese envío no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v.account_id) then raise exception 'Solo quien administra la cuenta lo decide.' using errcode = '42501'; end if;
  if v.estado <> 'duda' or v.duda is null then raise exception 'Ese envío no espera a nadie: ya está decidido.' using errcode = '23514'; end if;
  d := v.duda;
  if d ? 'totalErp10Cent' and d ? 'totalSumiedCent' and (d->>'totalErp10Cent') is distinct from (d->>'totalSumiedCent') and not coalesce(p_mirada, false) then
    raise exception 'Los totales no son iguales: mira antes la diferencia.' using errcode = '23514';
  end if;
  update public.conta_erp10_envio
     set estado = 'en_erp10', erp10_ejercicio = d->>'ejercicio', erp10_serie = d->>'serie', erp10_documento = (d->>'documento')::int,
         enlazada = true, motivo = null, decision = 'la_misma', decision_por = v_quien, decision_en = now(), cambiado_en = now()
   where id = v.id;
  return jsonb_build_object('documento', (d->>'documento')::int,
    'texto', format('Es la misma: no se manda; queda unida al asiento %s de ERP10.', d->>'documento'));
end $function$;
comment on function public.conta_erp10_envio_es_la_misma(uuid, boolean, text) is
  'X31 · «Es la misma, no la mandes»: el envío en duda queda enlazado con lo que ya está en ERP10 (sin escribir ni subir el PDF). Con totales distintos, solo con p_mirada.';
revoke all on function public.conta_erp10_envio_es_la_misma(uuid, boolean, text) from public, anon;
grant execute on function public.conta_erp10_envio_es_la_misma(uuid, boolean, text) to authenticated, service_role;

-- 4 · «Es otro, mándalo» (solo un asiento) -------------------------------------------------------------------------------
create or replace function public.conta_erp10_envio_es_otro(p_envio uuid, p_quien_nombre text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare v public.conta_erp10_envio; v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
begin
  select * into v from public.conta_erp10_envio where id = p_envio for update;
  if v.id is null then raise exception 'Ese envío no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v.account_id) then raise exception 'Solo quien administra la cuenta lo decide.' using errcode = '42501'; end if;
  if v.estado <> 'duda' or v.duda is null then raise exception 'Ese envío no espera a nadie: ya está decidido.' using errcode = '23514'; end if;
  if v.duda->>'que' is distinct from 'asiento' then
    raise exception 'Una factura no puede ser otra: ERP10 no admite dos con el mismo número del mismo tercero. Si no es la misma, el número está mal en un lado.' using errcode = '23514';
  end if;
  update public.conta_erp10_envio
     set estado = 'no_pudo', intentos = 1, motivo = 'Es otro: sale en la siguiente salida.', decision = 'otro', decision_por = v_quien, decision_en = now(),
         cambiado_en = now() - interval '6 minutes'
   where id = v.id;
  return jsonb_build_object('texto', 'Es otro: sale a ERP10 en la siguiente salida, sin volver a mirar.');
end $function$;
comment on function public.conta_erp10_envio_es_otro(uuid, text) is
  'X31 · «Es otro, mándalo» (solo un asiento en duda): sale en la siguiente salida sin volver a mirar lo que encaja en ERP10.';
revoke all on function public.conta_erp10_envio_es_otro(uuid, text) from public, anon;
grant execute on function public.conta_erp10_envio_es_otro(uuid, text) to authenticated, service_role;
