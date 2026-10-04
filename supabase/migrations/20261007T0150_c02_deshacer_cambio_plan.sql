-- ============================================================================
-- C02 · Plan contable — 6 · DESHACER, CAMBIO DE PLAN Y LA GUARDA DEL PERFIL
-- ----------------------------------------------------------------------------
--   company_account_undo_add(cuenta)   «Deshacer» de «+ Añadir subcuenta»: borra
--                                      una subcuenta propia sin enlaces, creada
--                                      hace menos de 24 horas.
--   company_chart_change_plan(…)       Cambio de plan (D4), misma regla que
--                                      cambioDePlan() en planEmpresa.ts:
--     · pymes → general: se añaden las hojas del general que faltan; lo que
--       cuelga de una hoja de pymes que en el general no lo es va a la hoja
--       que la persona elige (p_elecciones: código de la cuenta → hoja del
--       general), una a una. Sin elección para alguna, no se cambia nada y se
--       dice cuáles faltan.
--     · general → pymes: se bloquea si hay algo (una subcuenta o un enlace) en
--       una cuenta que pymes no tiene, con la lista; si no, se permite.
--     Las hojas de serie sin nada que ya no existan en el plan nuevo se quitan.
--   La guarda del perfil: con el plan activado, company_tax_profile.chart_kind
--   y account_digits SOLO cambian por company_chart_set_digits y
--   company_chart_change_plan (que renumeran o mueven). Un update directo
--   (Tu empresa › Detalle contable, o a mano) se rechaza.
--
-- company_chart_set_digits se reescribe con su misma firma (create or replace,
-- sin sobrecarga) solo para pasar la guarda. Fuera del camino del pedido.
-- ============================================================================

alter table public.company_account_log drop constraint if exists company_account_log_que_check;
alter table public.company_account_log add constraint company_account_log_que_check
  check (que in ('activado', 'subcuenta_creada', 'oculta', 'visible', 'enlace_cambiado', 'longitud_cambiada',
                 'borrada_duplicada', 'fusionada', 'cerrada', 'palabras_clave', 'subcuenta_deshecha', 'plan_cambiado'));

-- ── La guarda del perfil ────────────────────────────────────────────────────
create function public.company_tax_profile_guarda_plan() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.chart_kind is distinct from old.chart_kind or new.account_digits is distinct from old.account_digits)
     and exists (select 1 from public.company_account a where a.company_id = new.company_id)
     and coalesce(current_setting('conta.plan_cambio', true), '') <> '1' then
    raise exception 'El plan contable de esta empresa está activado: el plan y la longitud se cambian en Ajustes › Plan contable.' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger company_tax_profile_guarda_plan before update of chart_kind, account_digits on public.company_tax_profile
  for each row execute function public.company_tax_profile_guarda_plan();

create or replace function public.company_chart_set_digits(p_company uuid, p_digitos int, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid := public.conta_ia_cuenta(p_company);
  v_de int; n int;
begin
  if p_digitos not between 6 and 12 then raise exception 'La longitud tiene que ir de 6 a 12 dígitos.' using errcode = '22023'; end if;
  if public.company_account_length_locked(p_company) then
    raise exception 'Ya hay asientos: la longitud de las cuentas no se puede cambiar.' using errcode = '22023';
  end if;
  select account_digits into v_de from public.company_tax_profile where company_id = p_company for update;
  if v_de = p_digitos then return jsonb_build_object('renumeradas', 0); end if;
  if exists (select 1 from public.company_account a where a.company_id = p_company
              and length(ltrim(substr(a.code, length(a.template_code) + 1), '0')) > p_digitos - length(a.template_code)) then
    raise exception 'Alguna subcuenta no cabe en % dígitos.', p_digitos using errcode = '22023';
  end if;
  -- Un solo paso: los códigos viejos y los nuevos tienen distinta longitud,
  -- así que no pueden chocar a mitad de camino.
  update public.company_account a
     set code = a.template_code || lpad(coalesce(nullif(ltrim(substr(a.code, length(a.template_code) + 1), '0'), ''), '0'), p_digitos - length(a.template_code), '0'),
         updated_at = now()
   where company_id = p_company;
  get diagnostics n = row_count;
  perform set_config('conta.plan_cambio', '1', true);
  update public.company_tax_profile set account_digits = p_digitos, updated_at = now(), updated_by = auth.uid() where company_id = p_company;
  insert into public.company_account_log (account_id, company_id, que, detalle, antes, despues, source, done_by, done_by_name)
  values (v_cuenta, p_company, 'longitud_cambiada', format('Las cuentas pasan de %s a %s dígitos: %s renumeradas.', v_de, p_digitos, n),
          jsonb_build_object('digitos', v_de), jsonb_build_object('digitos', p_digitos, 'renumeradas', n), 'manual', auth.uid(), p_quien_nombre);
  return jsonb_build_object('renumeradas', n);
end $$;

-- ── Deshacer una subcuenta recién añadida ───────────────────────────────────
create function public.company_account_undo_add(p_id uuid, p_quien_nombre text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.company_account; v_cuenta uuid;
begin
  select * into a from public.company_account where id = p_id;
  if not found then raise exception 'Esa cuenta ya no está.' using errcode = 'P0002'; end if;
  v_cuenta := public.conta_ia_cuenta(a.company_id);
  if a.kind <> 'own' then raise exception 'Una cuenta de serie no se borra.' using errcode = '22023'; end if;
  if a.created_at < now() - interval '24 hours' then raise exception 'Ya han pasado 24 horas: si no la usas, ocúltala.' using errcode = '22023'; end if;
  if exists (select 1 from public.company_account_link where company_account_id = p_id) then
    raise exception 'Ya hay algo enlazado a %: cambia antes ese enlace.', a.code using errcode = '22023';
  end if;
  delete from public.company_account where id = p_id;
  insert into public.company_account_log (account_id, company_id, que, code, detalle, antes, source, done_by, done_by_name)
  values (v_cuenta, a.company_id, 'subcuenta_deshecha', a.code, format('Deshecha %s · %s, recién creada.', a.code, a.name),
          jsonb_build_object('code', a.code, 'name', a.name), 'manual', auth.uid(), p_quien_nombre);
end $$;

-- ── Cambio de plan (D4) ─────────────────────────────────────────────────────
create function public.company_chart_change_plan(p_company uuid, p_a text, p_elecciones jsonb default '{}', p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid := public.conta_ia_cuenta(p_company);
  v_de text; v_d int; r record; v_hoja text; v_destino uuid; v_code text;
  faltan text[] := '{}'; bloquean text[] := '{}'; n_anadidas int := 0; n_quitadas int := 0; n_movidas int := 0;
begin
  if p_a not in ('pymes', 'general') then raise exception 'Ese plan no existe.' using errcode = '22023'; end if;
  select plan into v_de from public.company_account where company_id = p_company limit 1;
  if v_de is null then raise exception 'El plan contable de esta empresa no está activado.' using errcode = '22023'; end if;
  if v_de = p_a then return jsonb_build_object('cambiado', false); end if;
  select account_digits into v_d from public.company_tax_profile where company_id = p_company for update;

  -- Lo que tiene algo (subcuenta propia o enlace) sobre una hoja que en el plan nuevo no lo es.
  for r in
    select a.id, a.code, a.kind, a.template_code from public.company_account a
     where a.company_id = p_company
       and not exists (select 1 from public.pgc_account p where p.plan = p_a and p.code = a.template_code and p.is_leaf and p.valid_to is null)
       and (a.kind = 'own' or exists (select 1 from public.company_account_link l where l.company_account_id = a.id))
     order by a.code
  loop
    if p_a = 'pymes' then bloquean := bloquean || r.code; continue; end if;
    v_hoja := p_elecciones ->> r.code;
    if v_hoja is null or not exists (select 1 from public.pgc_account p where p.plan = 'general' and p.code = v_hoja and p.is_leaf and p.valid_to is null) then
      faltan := faltan || r.code;
    end if;
  end loop;
  if cardinality(bloquean) > 0 then
    raise exception 'No se puede pasar al plan de pymes: hay % con datos en cuentas que el plan de pymes no tiene (%).',
      case when cardinality(bloquean) = 1 then 'una cuenta' else cardinality(bloquean) || ' cuentas' end, array_to_string(bloquean, ', ') using errcode = '22023';
  end if;
  if cardinality(faltan) > 0 then
    raise exception 'Falta elegir a qué cuenta del plan general va: %.', array_to_string(faltan, ', ') using errcode = '22023';
  end if;

  perform set_config('conta.plan_cambio', '1', true);
  -- El orden importa: una hoja del plan nuevo rellenada puede dar el mismo
  -- código que una hoja del viejo (2550 del general y 255 de pymes, las dos
  -- 2550000000 con 10 dígitos). Por eso:
  -- 1. Fuera las hojas de serie que el plan nuevo no tiene y no llevan nada.
  delete from public.company_account a
   where a.company_id = p_company and a.kind = 'template'
     and not exists (select 1 from public.pgc_account p where p.plan = p_a and p.code = a.template_code and p.is_leaf and p.valid_to is null)
     and not exists (select 1 from public.company_account_link l where l.company_account_id = a.id);
  get diagnostics n_quitadas = row_count;
  -- 2. Lo elegido, a su hoja (solo pymes → general). Una hoja de serie con
  --    enlaces cuyo código ya es el de su elegida se convierte en su sitio.
  for r in select key code, value hoja from jsonb_each_text(p_elecciones) loop
    select id into v_destino from public.company_account where company_id = p_company and code = r.code;
    if v_destino is null then continue; end if;
    if (select kind from public.company_account where id = v_destino) = 'own' then
      v_code := public.company_account_siguiente(p_company, r.hoja, v_d);
      update public.company_account set template_code = r.hoja, code = v_code, updated_at = now() where id = v_destino;
    elsif r.code = rpad(r.hoja, v_d, '0') then
      update public.company_account a set template_code = p.code, name = p.name, plain_name = p.plain_name, updated_at = now()
        from public.pgc_account p where a.id = v_destino and p.plan = p_a and p.code = r.hoja and p.valid_to is null;
    else
      insert into public.company_account (account_id, company_id, plan, code, template_code, name, plain_name, kind, source, created_by, created_by_name)
      select v_cuenta, p_company, p_a, rpad(p.code, v_d, '0'), p.code, p.name, p.plain_name, 'template', 'serie', auth.uid(), p_quien_nombre
        from public.pgc_account p where p.plan = p_a and p.code = r.hoja and p.valid_to is null
      on conflict (company_id, code) do nothing;
      update public.company_account_link set company_account_id = (select id from public.company_account where company_id = p_company and code = rpad(r.hoja, v_d, '0'))
       where company_account_id = v_destino;
      delete from public.company_account where id = v_destino;
    end if;
    n_movidas := n_movidas + 1;
  end loop;
  -- 3. Las hojas del plan nuevo que faltan.
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, plain_name, kind, is_common, source, created_by, created_by_name)
  select v_cuenta, p_company, p_a, rpad(p.code, v_d, '0'), p.code, p.name, p.plain_name, 'template', p.code in ('4000', '4100', '4300'), 'serie', auth.uid(), p_quien_nombre
    from public.pgc_account p
   where p.plan = p_a and p.is_leaf and p.valid_to is null
     and not exists (select 1 from public.company_account a where a.company_id = p_company and a.template_code = p.code and a.kind = 'template');
  get diagnostics n_anadidas = row_count;
  update public.company_account set plan = p_a, updated_at = now() where company_id = p_company;
  update public.company_tax_profile set chart_kind = case p_a when 'general' then 'normal' else 'pymes' end, updated_at = now(), updated_by = auth.uid()
   where company_id = p_company;
  insert into public.company_account_log (account_id, company_id, que, detalle, antes, despues, source, done_by, done_by_name)
  values (v_cuenta, p_company, 'plan_cambiado',
          format('Plan de %s a %s: %s cuentas de serie añadidas, %s quitadas (sin nada) y %s movidas a la cuenta elegida.', v_de, p_a, n_anadidas, n_quitadas, n_movidas),
          jsonb_build_object('plan', v_de), jsonb_build_object('plan', p_a, 'elecciones', p_elecciones), 'manual', auth.uid(), p_quien_nombre);
  return jsonb_build_object('cambiado', true, 'anadidas', n_anadidas, 'quitadas', n_quitadas, 'movidas', n_movidas);
end $$;

do $$
declare f text;
begin
  foreach f in array array['company_account_undo_add(uuid, text)', 'company_chart_change_plan(uuid, text, jsonb, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
