-- supabase/migrations/20261123T2050_x30_conciliar_solo_anade.sql
--
-- X30 · Conciliar: lo seguro se concilia solo, y reglas de verdad (pieza 2 del conciliador; respuesta X30 · 1, con el
-- visto bueno de Julio a las cuatro). Solo AÑADE:
--   1. Por empresa, el umbral desde el que Sumied concilia solo y los días del aviso de «sin conciliar»:
--      bank_settings.auto_threshold (sin valor, 95) y aviso_dias (sin valor, 10), con bank_ajustes_conciliar.
--   2. El porcentaje de seguridad de lo conciliado: bank_match.confidence_pct (el de cada propuesta va en
--      bank_movement.proposal->'seguridad', jsonb que ya existe). Lo rellena el disparador de la 2051.
--   3. Reglas: bank_rule.applies_from (la regla solo mira lo que entró en el banco desde entonces; sin valor, todo) y
--      bank_rule.seed («partida»: las que pone Sumied en toda empresa), con bank_regla_desde («aplicarla hacia atrás»
--      la deja sin fecha) y _bank_reglas_de_partida (las de partida de una empresa; la 2051 la llama).
--   4. El orden del banco dentro del día: bank_movement.position (lo escribe bank_importar desde la 2051).
--
-- Todo opcional: nada de lo que existe cambia. Nada en el camino del pedido. El real lo lanza Julio.

-- 1 · El umbral y los días del aviso, por empresa --------------------------------------------------------------------------
alter table public.bank_settings add column if not exists auto_threshold smallint
  constraint bank_settings_auto_threshold_rango check (auto_threshold is null or auto_threshold between 80 and 100);
alter table public.bank_settings add column if not exists aviso_dias smallint
  constraint bank_settings_aviso_dias_rango check (aviso_dias is null or aviso_dias between 1 and 90);
comment on column public.bank_settings.auto_threshold is
  'X30 · «Solo desde 95 %»: desde este porcentaje de seguridad Sumied concilia solo lo que propone por una regla o por lo de antes; por debajo, propone en ámbar. Sin valor, 95. Lo «seguro» de siempre cuenta como 99 %.';
comment on column public.bank_settings.aviso_dias is 'X30 · Los días sin conciliar a partir de los que avisa la pantalla Conciliar. Sin valor, 10.';

create or replace function public.bank_ajustes_conciliar(p_company uuid, p_umbral smallint, p_dias smallint)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare v_cuenta uuid := public._bank_cuenta_de_empresa(p_company);
begin
  if p_umbral is not null and p_umbral not between 80 and 100 then
    raise exception 'El umbral va del 80 al 100 %%.' using errcode = '22023';
  end if;
  if p_dias is not null and p_dias not between 1 and 90 then
    raise exception 'Los días del aviso van de 1 a 90.' using errcode = '22023';
  end if;
  insert into public.bank_settings (company_id, account_id, auto_threshold, aviso_dias, updated_at, updated_by, updated_by_name)
  values (p_company, v_cuenta, p_umbral, p_dias, now(), auth.uid(), public.conta_nombre_actor())
  on conflict (company_id) do update set auto_threshold = excluded.auto_threshold, aviso_dias = excluded.aviso_dias,
         updated_at = now(), updated_by = auth.uid(), updated_by_name = public.conta_nombre_actor();
  return jsonb_build_object('umbral', coalesce(p_umbral, 95), 'dias', coalesce(p_dias, 10),
    'texto', format('Sumied concilia solo desde el %s %% · aviso a los %s días sin conciliar.', coalesce(p_umbral, 95), coalesce(p_dias, 10)));
end $function$;
comment on function public.bank_ajustes_conciliar(uuid, smallint, smallint) is 'X30 · El umbral desde el que Sumied concilia solo y los días del aviso, de una empresa.';
revoke all on function public.bank_ajustes_conciliar(uuid, smallint, smallint) from public, anon;
grant execute on function public.bank_ajustes_conciliar(uuid, smallint, smallint) to authenticated, service_role;

-- 2 · El porcentaje de lo conciliado ---------------------------------------------------------------------------------------
alter table public.bank_match add column if not exists confidence_pct smallint
  constraint bank_match_confidence_pct_rango check (confidence_pct is null or confidence_pct between 0 and 100);
comment on column public.bank_match.confidence_pct is
  'X30 · El porcentaje de seguridad con el que se concilió: 99 lo «seguro»; si no, el de la propuesta (bank_movement.proposal->seguridad). Sin valor lo de antes del X30.';

-- 3 · Reglas: desde cuándo miran, y las de partida ------------------------------------------------------------------------
alter table public.bank_rule add column if not exists applies_from timestamptz;
alter table public.bank_rule add column if not exists seed text
  constraint bank_rule_seed_valores check (seed is null or seed = 'partida');
comment on column public.bank_rule.applies_from is
  'X30 · La regla solo mira los movimientos que entraron en el banco (bank_movement.created_at) desde entonces. Sin valor: todos («aplicarla hacia atrás»).';
comment on column public.bank_rule.seed is
  'X30 · «partida»: una de las que pone Sumied en toda empresa (comisiones, luz, agua, teléfono, seguros; plataformas en hostelería). Propone en ámbar hasta que la empresa la confirme; se puede apagar.';

create or replace function public.bank_regla_desde(p_id uuid, p_desde timestamptz)
returns void language plpgsql volatile security definer set search_path = public as $function$
declare v public.bank_rule;
begin
  select * into v from public.bank_rule where id = p_id for update;
  if v.id is null then raise exception 'Esa regla no existe.' using errcode = 'P0002'; end if;
  perform public._bank_cuenta_de_empresa(v.company_id);
  if v.applies_from is not distinct from p_desde then return; end if;
  update public.bank_rule set applies_from = p_desde, updated_at = now() where id = p_id;
  insert into public.bank_rule_log (account_id, rule_id, action, before, after, created_by, created_by_name)
  values (v.account_id, p_id, 'cambiada', jsonb_build_object('desde', v.applies_from), jsonb_build_object('desde', p_desde), auth.uid(), public.conta_nombre_actor());
end $function$;
comment on function public.bank_regla_desde(uuid, timestamptz) is
  'X30 · Desde cuándo mira una regla (sin fecha: también lo que ya estaba, «aplicarla hacia atrás»). Queda en su registro.';
revoke all on function public.bank_regla_desde(uuid, timestamptz) from public, anon;
grant execute on function public.bank_regla_desde(uuid, timestamptz) to authenticated, service_role;

-- Las de partida de una empresa: solo las que tienen su cuenta en el plan y cuyo texto la empresa aún no usa en ninguna
-- regla. Activas, de Sumied, sin confirmar (proponen en ámbar: a la 3.ª confirmación casan solas, como cualquier regla) y
-- con applies_from = p_desde: no tocan nada de lo que ya estaba. La Seguridad Social no: la concilia el paso de nóminas
-- con el criterio de cada empresa (respuesta X30 · 1, B). Las de plataforma, solo en hostelería y contra la 430 de esa
-- plataforma; el motor solo llega a ellas cuando no hay liquidación (el paso 4 va antes que las reglas).
create or replace function public._bank_reglas_de_partida(p_company uuid, p_desde timestamptz)
returns integer language plpgsql volatile security definer set search_path = public as $function$
declare
  v_cuenta uuid; v_hosteleria boolean; v_n int := 0; r record; v_codigo text; v_id uuid;
begin
  select c.account_id, c.sector = 'hosteleria' into v_cuenta, v_hosteleria from public.company c where c.id = p_company;
  if v_cuenta is null then return 0; end if;
  for r in
    select * from (values
      ('Comisiones del banco', 'COMISION', -1, '626', null::text),
      ('Comisiones del banco', 'COMISIONES', -1, '626', null),
      ('Luz', 'IBERDROLA', -1, '628', null), ('Luz', 'ENDESA', -1, '628', null), ('Luz', 'NATURGY', -1, '628', null),
      ('Luz', 'HOLALUZ', -1, '628', null), ('Luz', 'TOTALENERGIES', -1, '628', null),
      ('Agua', 'CANAL DE ISABEL II', -1, '628', null), ('Agua', 'AGUAS DE', -1, '628', null),
      ('Teléfono', 'MOVISTAR', -1, '629', null), ('Teléfono', 'TELEFONICA', -1, '629', null), ('Teléfono', 'VODAFONE', -1, '629', null),
      ('Teléfono', 'ORANGE', -1, '629', null), ('Teléfono', 'DIGI', -1, '629', null), ('Teléfono', 'MASMOVIL', -1, '629', null),
      ('Seguros', 'MAPFRE', -1, '625', null), ('Seguros', 'ALLIANZ', -1, '625', null), ('Seguros', 'AXA SEGUROS', -1, '625', null),
      ('Seguros', 'GENERALI', -1, '625', null), ('Seguros', 'ZURICH', -1, '625', null), ('Seguros', 'LINEA DIRECTA', -1, '625', null),
      ('Glovo', 'GLOVO', 1, '430', 'glovo'), ('Uber Eats', 'UBER', 1, '430', 'uber'), ('Just Eat', 'JUST EAT', 1, '430', 'just eat')
    ) as t(que, contiene, signo, grupo, plataforma)
  loop
    if r.plataforma is not null and not coalesce(v_hosteleria, false) then continue; end if;
    -- La cuenta: la de la plataforma (su 430 con su nombre) o la primera hoja del grupo en el plan de la empresa.
    select a.code into v_codigo from public.company_account a
     where a.company_id = p_company and a.code like r.grupo || '%' and length(a.code) >= 8
       and (r.plataforma is null or lower(coalesce(a.plain_name, a.name)) like '%' || r.plataforma || '%')
     order by a.code limit 1;
    if v_codigo is null then continue; end if;
    if exists (select 1 from public.bank_rule b where b.company_id = p_company and upper(b.condition->>'contiene') = r.contiene) then continue; end if;
    insert into public.bank_rule (account_id, company_id, words, condition, target, origin, status, applies_from, seed, created_by_name)
    values (v_cuenta, p_company, r.contiene, jsonb_build_object('contiene', r.contiene, 'signo', r.signo),
            jsonb_build_object('cuenta', v_codigo, 'que', r.que), 'folvy', 'activa', p_desde, 'partida', 'Sumied')
    returning id into v_id;
    insert into public.bank_rule_log (account_id, rule_id, action, after, created_by_name)
    values (v_cuenta, v_id, 'creada', jsonb_build_object('palabras', r.contiene, 'que', r.que, 'cuenta', v_codigo, 'partida', true, 'desde', p_desde), 'Sumied');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$;
comment on function public._bank_reglas_de_partida(uuid, timestamptz) is
  'X30 · Las reglas de partida de una empresa (las que tienen su cuenta en el plan y cuyo texto aún no usa), activas, sin confirmar y desde p_desde.';
revoke all on function public._bank_reglas_de_partida(uuid, timestamptz) from public, anon, authenticated;

-- 4 · El orden del banco dentro del día ------------------------------------------------------------------------------------
alter table public.bank_movement add column if not exists position integer;
comment on column public.bank_movement.position is
  'X30 · El orden de la línea en su extracto, de la más antigua a la más nueva (lo escribe bank_importar). Ordena el saldo línea a línea dentro del mismo día. Sin valor lo importado antes del X30.';
