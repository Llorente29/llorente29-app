-- supabase/migrations/20261125T0903_x14c_dia_de_inicio_a_mano.sql
-- cambia: public.conta_traer_cargar · prueba: supabase/staging/sql/20261125_x14c_dia_de_inicio_a_mano_prueba.sql
-- cambia: public._conta_traer_seguir · prueba: supabase/staging/sql/20261125_x14c_dia_de_inicio_a_mano_prueba.sql
-- cambia: public.conta_fijar_corte · prueba: supabase/staging/sql/20261125_x14c_dia_de_inicio_a_mano_prueba.sql
-- cambia: public.fiscal_year_corte_cambiable · prueba: supabase/staging/sql/20261125_x14c_dia_de_inicio_a_mano_prueba.sql
--
-- X14 · 2 (Julio, 25/11): «traer años pasados de ERP10 nunca fija el día de inicio de Sumied». QBO sigue llevando su
-- contabilidad en ERP10: Sumied tiene que poder traer 2024, 2025 y lo que va de 2026, en cualquier orden, sin que uno deje
-- fuera al otro. El día de inicio lo fija Julio, a mano, cuando QBO pase a llevarla en Sumied.
--   1. conta_traer_cargar (misma firma; la de antes, guardada): ya no llama a conta_fijar_corte. Antes, sin día de inicio,
--      lo fijaba en el siguiente al último traído, y traer 2024 dejaba fuera 2025 y 2026. Con día de inicio fijado (a mano),
--      sigue trayendo solo lo anterior, como antes.
--   2. _conta_traer_seguir (misma firma; guardada): ya no dice «Sumied empieza a llevar la contabilidad el …» ni devuelve un
--      día de inicio que no existe; devuelve el que hay (nulo si no hay).
--   3. conta_fijar_corte (misma firma; guardada): con asientos traídos también se fija, si todo lo traído queda antes del día
--      de inicio. Si no, para y dice cuántos quedarían después y el primer día que valdría.
--   4. fiscal_year_corte_cambiable (el disparador; guardada): igual, ejercicio a ejercicio. Antes paraba cualquier cambio
--      de un ejercicio con algo traído.
-- Las cuatro, enteras: las que hay en producción (1552 y 0816, y la C04 para las dos últimas) con los trozos «X14 · 2».
-- Nada en el camino del pedido. No cambia ninguna fila. El real lo lanza Julio. Vuelta atrás: las cuatro de sus respaldos.

-- 1 · conta_traer_cargar: no fija el día de inicio ------------------------------------------------------------------------
select public._respaldar_funcion('public.conta_traer_cargar(uuid,text,jsonb,text)', '20261125T0903_x14c_dia_de_inicio_a_mano');
CREATE OR REPLACE FUNCTION public.conta_traer_cargar(p_company uuid, p_ejercicio text, p_datos jsonb, p_quien_nombre text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cuenta uuid; v_plan text; v_d int; v_inicio date; v_otra public.import_run; v_carga uuid; v_quien text;
  v_prog text := lower(coalesce(p_datos->>'programa', 'erp10'));
  v_nombre_prog text;
  v_asientos jsonb := '[]'; v_facturas jsonb := '[]'; a jsonb; l jsonb; f jsonb; t jsonb; x jsonb;
  v_fuera_a int := 0; v_fuera_f int := 0; v_desde date; v_hasta date; v_n int; v_primero date;
  v_debe numeric; v_haber numeric; v_tot_debe numeric := 0; v_tot_haber numeric := 0; v_apuntes int := 0;
  v_code text; v_hoja text; v_nombre text; v_cta uuid; v_ex public.company_account;
  n_cuentas int := 0; n_cuentas_estaban int := 0;
  v_sup uuid; v_party uuid; v_nif text; v_link uuid;
  n_prov int := 0; n_cli int := 0; n_enlazados int := 0;
  v_tercero jsonb := '{}';   -- código de la subcuenta → {party, supplier}
  v_emitidas jsonb := '[]'; v_provs jsonb := '[]'; v_fichas jsonb := '[]';   -- N06b
  v_lineas jsonb; v_r jsonb; v_entry uuid; v_ids jsonb := '{}';   -- «clave|fecha» → asiento
  v_tipo_id uuid; v_ret_id uuid; v_ret_modelo text; v_sin_tipo int := 0;
  v_fac uuid; n_rec int := 0; n_emi int := 0; n_casadas int := 0; n_sin_casar int := 0; v_num int; v_serie text;
  v_aprendidas int := 0; v_valor text; v_etiqueta text;
  v_mirar jsonb := '[]'; v_corte jsonb := null; v_locks jsonb;
  v_deshacer jsonb := jsonb_build_object('enlaces', '[]'::jsonb, 'roles', '[]'::jsonb, 'fiscales', '[]'::jsonb, 'aprendido', '[]'::jsonb);
  v_texto text; v_counts jsonb;
  v_estado jsonb; v_r2 jsonb; v_empieza timestamptz := clock_timestamp();   -- X14
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.current_user_is_admin_of(v_cuenta) then
    raise exception 'Solo un administrador de la cuenta trae la contabilidad de otro programa.' using errcode = '42501';
  end if;
  v_quien := coalesce(nullif(trim(p_quien_nombre), ''), public.conta_nombre_actor());
  perform pg_advisory_xact_lock(hashtextextended('conta_traer:' || p_company::text, 0));

  -- ── Las paradas ──
  select * into v_otra from public.import_run r where r.company_id = p_company and r.kind = 'carga' and r.status in ('en_prueba', 'cargando') limit 1;
  if v_otra.id is not null and v_otra.status = 'cargando' then   -- X14 · una carga a medias: se sigue con ella o se deshace
    raise exception 'Hay una carga de esta empresa a medias, del %: sigue con ella o deshazla antes de traer otra.',
      to_char(v_otra.started_at at time zone 'Europe/Madrid', 'DD/MM') using errcode = '23514', hint = 'a_medias';
  end if;
  if v_otra.id is not null then
    raise exception 'Ya hay una carga en prueba de esta empresa, del %. Dala por buena o deshazla antes de traer otra.',
      to_char(v_otra.started_at at time zone 'Europe/Madrid', 'DD/MM') using errcode = '23514', hint = 'otra_carga';
  end if;
  if coalesce((p_datos->>'version')::int, 0) <> 1 or jsonb_typeof(p_datos->'asientos') is distinct from 'array' then
    raise exception 'Lo leído no viene en la forma que espero: vuelve a leer los ficheros.' using errcode = '22023';
  end if;
  if v_prog not in ('erp10', 'diez', 'otro') then v_prog := 'otro'; end if;
  v_nombre_prog := case v_prog when 'erp10' then 'ERP10' when 'diez' then 'Diez' else 'el programa de antes' end;
  if p_ejercicio is not null and p_ejercicio !~ '^[0-9]{4}$' then
    raise exception 'El ejercicio % no es un año.', p_ejercicio using errcode = '22023';
  end if;

  select case p.chart_kind when 'normal' then 'general' else 'pymes' end, p.account_digits into v_plan, v_d
    from public.company_tax_profile p where p.company_id = p_company;
  if v_plan is null then raise exception 'La empresa no tiene plan contable elegido: elígelo en Empresa antes de traer.' using errcode = '23514'; end if;
  if jsonb_array_length(coalesce(p_datos->'largos', '[]')) > 1 then
    raise exception 'Los ficheros traen cuentas de distinto largo (% dígitos). No se convierte ninguna: sácalas todas con el mismo largo.',
      (select string_agg(value, ' y ') from jsonb_array_elements_text(p_datos->'largos')) using errcode = '23514', hint = 'largo';
  end if;
  if (p_datos->'largos'->>0)::int is distinct from v_d and jsonb_array_length(coalesce(p_datos->'largos', '[]')) = 1 then
    raise exception 'Las cuentas de estos ficheros tienen % dígitos y las de esta empresa, %. No se convierte ninguna: sácalas de % con % dígitos.',
      p_datos->'largos'->>0, v_d, v_nombre_prog, v_d using errcode = '23514', hint = 'largo';
  end if;

  -- Lo que se trae: el ejercicio pedido (o todo) y, si hay día de inicio, solo lo anterior.
  v_inicio := public.conta_dia_de_inicio(p_company);
  -- X14 · En una sola consulta: añadir uno a uno a un jsonb que crece copia todo lo de antes en cada vuelta (17,7 s con 4.425 asientos).
  select coalesce(jsonb_agg(s.v order by s.o) filter (where v_inicio is null or (s.v->>'fecha')::date < v_inicio), '[]'),
         count(*) filter (where v_inicio is not null and (s.v->>'fecha')::date >= v_inicio)
    into v_asientos, v_fuera_a
    from jsonb_array_elements(p_datos->'asientos') with ordinality s(v, o)
   where p_ejercicio is null or left(s.v->>'fecha', 4) = p_ejercicio;
  select coalesce(jsonb_agg(s.v order by s.o) filter (where v_inicio is null or (s.v->>'fecha')::date < v_inicio), '[]'),
         count(*) filter (where v_inicio is not null and (s.v->>'fecha')::date >= v_inicio)
    into v_facturas, v_fuera_f
    from jsonb_array_elements(coalesce(p_datos->'facturas', '[]')) with ordinality s(v, o)
   where p_ejercicio is null or left(s.v->>'fecha', 4) = p_ejercicio;
  -- N06b · Una carga solo de cuentas y terceros (sin asientos ni facturas) también es una carga.
  if jsonb_array_length(v_asientos) = 0 and jsonb_array_length(v_facturas) = 0
     and jsonb_array_length(coalesce(p_datos->'cuentas', '[]')) = 0 and jsonb_array_length(coalesce(p_datos->'terceros', '[]')) = 0 then
    raise exception '%', case when v_inicio is not null and v_fuera_a + v_fuera_f > 0
      then format('No hay nada que traer: todo lo leído es del %s en adelante, y desde ese día la contabilidad ya la lleva Sumied.', to_char(v_inicio, 'DD/MM/YYYY'))
      else 'No hay nada que traer: no hay cuentas, terceros, asientos ni facturas.' end using errcode = '23514', hint = 'nada';
  end if;

  -- El diario cuadra, asiento a asiento.
  for a in select * from jsonb_array_elements(v_asientos) loop
    select coalesce(sum((y->>'debe')::numeric), 0), coalesce(sum((y->>'haber')::numeric), 0), count(*) into v_debe, v_haber, v_n
      from jsonb_array_elements(a->'apuntes') y;
    if v_debe <> v_haber or v_n < 2 then
      raise exception 'El diario no cuadra: el asiento % del % lleva % al debe y % al haber. Corrígelo en % y vuelve a sacar el diario.',
        coalesce(nullif(a->>'documento', ''), a->>'clave'), to_char((a->>'fecha')::date, 'DD/MM/YYYY'),
        public._conta_traer_euros(v_debe), public._conta_traer_euros(v_haber), v_nombre_prog using errcode = '23514', hint = 'no_cuadra';
    end if;
    v_tot_debe := v_tot_debe + v_debe; v_tot_haber := v_tot_haber + v_haber; v_apuntes := v_apuntes + coalesce((a->>'apuntesLeidos')::int, v_n);
  end loop;
  select min((s.v->>'fecha')::date), max((s.v->>'fecha')::date) into v_desde, v_hasta
    from (select value v from jsonb_array_elements(v_asientos) union all select value from jsonb_array_elements(v_facturas)) s;

  -- X14 · 1b · Los ejercicios que falten antes del primero de la empresa: años naturales, encadenados (2024 → 2025 → 2026).
  -- «Traer» los crea en vez de pararse (Julio, 25/11). Solo si el primero es un año natural sin anterior; si no, para como antes.
  declare v_x14_prim public.fiscal_year; v_x14_desde int; v_x14_ant uuid; v_x14_id uuid; v_x14_nuevos jsonb := '[]'; v_x14_y int;
  begin
    select min(left(j.value->>'fecha', 4))::int into v_x14_desde from jsonb_array_elements(v_asientos) j;
    select * into v_x14_prim from public.fiscal_year where company_id = p_company order by starts_on limit 1;
    if v_x14_desde is not null and v_x14_prim.id is not null and v_x14_prim.previous_year_id is null
       and v_x14_desde < extract(year from v_x14_prim.starts_on)::int
       and v_x14_prim.starts_on = make_date(extract(year from v_x14_prim.starts_on)::int, 1, 1)
       and v_x14_prim.ends_on = make_date(extract(year from v_x14_prim.starts_on)::int, 12, 31) then
      for v_x14_y in v_x14_desde .. extract(year from v_x14_prim.starts_on)::int - 1 loop
        insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on, previous_year_id, created_by)
        values (v_cuenta, p_company, v_x14_y::text, make_date(v_x14_y, 1, 1), make_date(v_x14_y, 12, 31), v_x14_ant, auth.uid())
        returning id into v_x14_id;
        v_x14_nuevos := v_x14_nuevos || to_jsonb(v_x14_id);
        v_x14_ant := v_x14_id;
      end loop;
      update public.fiscal_year set previous_year_id = v_x14_ant where id = v_x14_prim.id;
      v_deshacer := v_deshacer || jsonb_build_object('ejercicios_nuevos', v_x14_nuevos, 'ejercicio_enganchado', v_x14_prim.id);
    end if;
  end;

  -- Cada día traído, con su ejercicio en la empresa.
  select min(s.d) into v_primero from (select (j.value->>'fecha')::date d from jsonb_array_elements(v_asientos) j) s
   where not exists (select 1 from public.fiscal_year y where y.company_id = p_company and s.d between y.starts_on and y.ends_on);
  if v_primero is not null then
    raise exception 'La empresa no tiene el ejercicio %: créalo en Empresa antes de traer.', extract(year from v_primero) using errcode = '23514', hint = 'sin_ejercicio';
  end if;

  -- El periodo no tiene asientos apuntados en Sumied.
  select count(*), min(e.entry_date) into v_n, v_primero from public.journal_entry e
   where e.company_id = p_company and e.source_type <> 'migrated' and e.status in ('borrador', 'validado')
     and e.entry_date between v_desde and v_hasta;
  if v_n > 0 then
    raise exception 'Entre el % y el % ya hay % apuntados en Sumied (el primero, del %). Lo traído no se mezcla con lo apuntado aquí: no se ha traído nada.',
      to_char(v_desde, 'DD/MM/YYYY'), to_char(v_hasta, 'DD/MM/YYYY'), case when v_n = 1 then '1 asiento' else v_n || ' asientos' end,
      to_char(v_primero, 'DD/MM/YYYY') using errcode = '23514', hint = 'periodo_con_asientos';
  end if;

  -- ── La carga y sus lecturas (3.1: una carga es una) ──
  insert into public.import_run (account_id, company_id, program, kind, period_from, period_to, status, finished_at, created_by, created_by_name)
  values (v_cuenta, p_company, v_prog, 'carga', v_desde, v_hasta, 'cargando', now(), auth.uid(), v_quien)   -- X14 · «cargando» hasta vaciar la cola
  returning id into v_carga;
  insert into public.import_run (account_id, company_id, program, kind, period_from, period_to, status, finished_at, counts, created_by, created_by_name, parent_id)
  select v_cuenta, p_company, v_prog, public._conta_traer_kind(fi.v->>'tipo'), v_desde, v_hasta, 'hecho', now(),
         jsonb_build_object('fichero', fi.v->>'nombre', 'haLeido', fi.v->>'haLeido'), auth.uid(), v_quien, v_carga
    from jsonb_array_elements(coalesce(p_datos->'ficheros', '[]')) fi(v)
   where public._conta_traer_kind(fi.v->>'tipo') is not null;

  -- ── X14 · 2 · El día de inicio NO lo fija lo traído (Julio, 25/11): lo fija una persona, a mano, en Empresa › Ejercicio. ──
  -- Antes, sin día de inicio, se fijaba en el siguiente al último traído: traer 2024 primero dejaba 2025 fuera de toda carga.
  -- v_corte se queda nulo: deshacer esta carga no tiene corte que devolver.

  -- ── Las subcuentas: las que faltan, con sus números ──
  for x in select * from jsonb_array_elements(coalesce(p_datos->'cuentas', '[]')) loop
    v_code := trim(x->>'codigo'); v_nombre := nullif(trim(x->>'nombre'), '');
    select * into v_ex from public.company_account where company_id = p_company and code = v_code;
    if v_ex.id is not null then
      n_cuentas_estaban := n_cuentas_estaban + 1;
      if v_nombre is not null and lower(v_nombre) <> lower(v_ex.name) then
        v_mirar := v_mirar || jsonb_build_object('que', 'cuenta', 'cuenta', v_code,
          'frase', format('La cuenta %s ya estaba en Sumied como «%s»; en %s se llama «%s». Se queda la de Sumied.', v_code, v_ex.name, v_nombre_prog, v_nombre));
      end if;
      continue;
    end if;
    if v_code !~ ('^[0-9]{' || v_d || '}$') then
      v_mirar := v_mirar || jsonb_build_object('que', 'cuenta', 'cuenta', v_code, 'frase', format('La cuenta %s no tiene %s dígitos: no se ha creado.', v_code, v_d));
      continue;
    end if;
    select p.code into v_hoja from public.pgc_account p
     where p.plan = v_plan and p.is_leaf and p.valid_to is null and v_code like p.code || '%' order by length(p.code) desc limit 1;
    if v_hoja is null then
      v_mirar := v_mirar || jsonb_build_object('que', 'cuenta', 'cuenta', v_code, 'frase', format('La cuenta %s no cuelga de ninguna cuenta del plan contable: no se ha creado.', v_code));
      continue;
    end if;
    if v_code = rpad(v_hoja, v_d, '0') then
      insert into public.company_account (account_id, company_id, plan, code, template_code, name, plain_name, kind, source, created_by_name, name_source, import_run_id)
      select v_cuenta, p_company, v_plan, v_code, p.code, p.name, p.plain_name, 'template', 'serie', v_nombre_prog || ' (traída)', v_nombre, v_carga
        from public.pgc_account p where p.plan = v_plan and p.code = v_hoja and p.valid_to is null;
    elsif v_nombre is null then
      insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name, name_pending, import_run_id)
      select v_cuenta, p_company, v_plan, v_code, v_hoja, p.name, 'own', 'migrated', v_nombre_prog || ' (traída)', true, v_carga
        from public.pgc_account p where p.plan = v_plan and p.code = v_hoja and p.valid_to is null;
    else
      insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name, name_source, import_run_id)
      values (v_cuenta, p_company, v_plan, v_code, v_hoja, v_nombre, 'own', 'migrated', v_nombre_prog || ' (traída)', v_nombre, v_carga);
    end if;
    n_cuentas := n_cuentas + 1;
  end loop;
  -- Una cuenta que usa el diario y no está: no se puede traer el asiento.
  select min(y->>'cuenta') into v_code from jsonb_array_elements(v_asientos) a2, jsonb_array_elements(a2->'apuntes') y
   where not exists (select 1 from public.company_account c where c.company_id = p_company and c.code = y->>'cuenta');
  if v_code is not null then
    raise exception 'El diario usa la cuenta %, que no está en el plan de cuentas de los ficheros ni se puede crear: no se ha traído nada.', v_code
      using errcode = '23514', hint = 'cuenta';
  end if;

  -- ── Los terceros: los que faltan, enlazados a su subcuenta ──
  for t in select * from jsonb_array_elements(coalesce(p_datos->'terceros', '[]')) loop
    v_code := t->>'codigo'; v_nif := nullif(public.party_nif(t->>'nif'), ''); v_sup := null; v_party := null;
    v_nombre := coalesce(nullif(trim(t->>'nombre'), ''), nullif(trim(t->>'nombreComercial'), ''), v_code);
    select id into v_cta from public.company_account where company_id = p_company and code = v_code;
    if v_cta is null then continue; end if;   -- ya apuntada arriba
    if t->>'clase' = 'proveedor' then
      if v_nif is not null then
        select s.id into v_sup from public.supplier s where s.account_id = v_cuenta and public.party_nif(s.tax_id) = v_nif and s.archived_at is null
         order by s.created_at limit 1;
      end if;
      if v_sup is not null then
        n_enlazados := n_enlazados + 1;
        -- N06b · Lo que ya está con ese NIF se completa, no se duplica: solo lo que le falta (el nombre
        -- fiscal). Su nombre, su IBAN, su forma de pago y lo demás de su ficha no se tocan.
        update public.supplier set legal_name = v_nombre where id = v_sup and nullif(trim(legal_name), '') is null and v_nombre <> v_code
        returning to_jsonb(id) into x;
        if found then v_fichas := v_fichas || x; end if;
        v_mirar := v_mirar || jsonb_build_object('que', 'tercero', 'cuenta', v_code,
          'frase', format('El proveedor %s (%s) ya estaba en Sumied: se ha enlazado a la cuenta %s%s; lo demás de su ficha no se toca.', v_nombre, t->>'nif', v_code,
                          case when found then ' y se le ha puesto su nombre fiscal' else '' end));
      else
        insert into public.supplier (account_id, name, legal_name, tax_id, created_by_name, import_run_id)
        values (v_cuenta, coalesce(nullif(trim(t->>'nombreComercial'), ''), v_nombre), v_nombre, t->>'nif', v_nombre_prog || ' (traído)', v_carga)
        returning id into v_sup;
        n_prov := n_prov + 1;
      end if;
      v_provs := v_provs || to_jsonb(v_sup);
      select party_id into v_party from public.party_role where account_id = v_cuenta and role = 'supplier' and supplier_id = v_sup;
      if public._conta_traer_ocupada(v_cta, 'supplier', v_sup) is not null then
        v_mirar := v_mirar || jsonb_build_object('que', 'tercero', 'cuenta', v_code, 'frase',
          format('La cuenta %s ya es de %s en Sumied: %s se ha traído sin enlazarla.', v_code, public._conta_traer_ocupada(v_cta, 'supplier', v_sup), v_nombre));
      else
        insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
        values (v_cuenta, p_company, v_cta, 'supplier', v_sup::text, 'principal', 'migrated')
        on conflict do nothing returning id into v_link;
      end if;
    else
      if v_nif is not null then
        select p.id into v_party from public.party p where p.account_id = v_cuenta and p.tax_id = v_nif;
      end if;
      if v_party is not null then
        n_enlazados := n_enlazados + 1;
        v_mirar := v_mirar || jsonb_build_object('que', 'tercero', 'cuenta', v_code,
          'frase', format('El cliente %s (%s) ya estaba en Sumied: se ha enlazado a la cuenta %s, sin tocar su ficha.', v_nombre, t->>'nif', v_code));
      else
        insert into public.party (account_id, name, tax_id, source, created_by_name, import_run_id)
        values (v_cuenta, v_nombre, v_nif, 'migrated', v_nombre_prog || ' (traído)', v_carga) returning id into v_party;
        n_cli := n_cli + 1;
      end if;
      if not exists (select 1 from public.party_role where party_id = v_party and role = 'customer') then
        insert into public.party_role (account_id, party_id, role) values (v_cuenta, v_party, 'customer') returning to_jsonb(id) into x;
        v_deshacer := jsonb_set(v_deshacer, '{roles}', (v_deshacer->'roles') || x);
      end if;
      if not exists (select 1 from public.customer_fiscal where party_id = v_party) then
        insert into public.customer_fiscal (party_id, account_id) values (v_party, v_cuenta);
        v_deshacer := jsonb_set(v_deshacer, '{fiscales}', (v_deshacer->'fiscales') || to_jsonb(v_party));
      end if;
      if public._conta_traer_ocupada(v_cta, 'customer', v_party) is not null then
        v_mirar := v_mirar || jsonb_build_object('que', 'tercero', 'cuenta', v_code, 'frase',
          format('La cuenta %s ya es de %s en Sumied: %s se ha traído sin enlazarla.', v_code, public._conta_traer_ocupada(v_cta, 'customer', v_party), v_nombre));
      else
        insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
        values (v_cuenta, p_company, v_cta, 'customer', v_party::text, 'principal', 'migrated')
        on conflict do nothing returning id into v_link;
      end if;
    end if;
    if v_link is not null then
      v_deshacer := jsonb_set(v_deshacer, '{enlaces}', (v_deshacer->'enlaces') || to_jsonb(v_link));
    elsif public._conta_traer_ocupada(v_cta, case when v_sup is not null then 'supplier' else 'customer' end, coalesce(v_sup, v_party)) is null and not exists (select 1 from public.company_account_link k where k.company_id = p_company and k.company_account_id = v_cta
                        and k.entity_id = coalesce(v_sup, v_party)::text and k.role = 'principal') then
      v_mirar := v_mirar || jsonb_build_object('que', 'tercero', 'cuenta', v_code,
        'frase', format('%s ya tenía otra cuenta principal en Sumied; la de %s es la %s. Se queda la de Sumied.', v_nombre, v_nombre_prog, v_code));
    end if;
    v_link := null;
    v_tercero := v_tercero || jsonb_build_object(v_code, jsonb_build_object('party', v_party, 'supplier', v_sup, 'nif', v_nif));
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p_datos->'raros', '[]')) loop
    v_mirar := v_mirar || jsonb_build_object('que', 'raro', 'frase', x->>'frase');
  end loop;

  -- ── X14 · Los asientos y las facturas, a la cola de la carga: entran por trozos (_conta_traer_seguir) ──
  insert into public.conta_traer_trozo (carga, orden, tipo, dato, clave)
  select v_carga, s.ord, 'asiento', s.v, (s.v->>'clave') || '|' || (s.v->>'fecha') from jsonb_array_elements(v_asientos) with ordinality s(v, ord);
  -- La retención del 19 % de una recibida mira si su asiento va a un 621: se mira aquí, con todos los asientos a mano.
  with c621 as (select distinct (a3->>'clave') || '|' || (a3->>'fecha') k
                  from jsonb_array_elements(v_asientos) a3, jsonb_array_elements(a3->'apuntes') z where z->>'cuenta' like '621%')
  insert into public.conta_traer_trozo (carga, orden, tipo, dato)
  select v_carga, jsonb_array_length(v_asientos) + s.ord, 'factura', s.v || jsonb_build_object('asiento621', c.k is not null)
    from jsonb_array_elements(v_facturas) with ordinality s(v, ord) left join c621 c on c.k = s.v->>'asiento';

  -- Lo que hace falta para seguir, guardado con la carga.
  v_estado := jsonb_build_object('company', p_company, 'cuenta', v_cuenta, 'prog', v_prog, 'nombre_prog', v_nombre_prog, 'quien', v_quien,
    'inicio', v_inicio, 'hasta', v_hasta, 'fuera_a', v_fuera_a, 'fuera_f', v_fuera_f, 'apuntes', v_apuntes, 'tot_debe', v_tot_debe, 'tot_haber', v_tot_haber,
    'n_asientos', jsonb_array_length(v_asientos), 'n_facturas', jsonb_array_length(v_facturas),
    'n_cuentas', n_cuentas, 'n_cuentas_estaban', n_cuentas_estaban, 'n_prov', n_prov, 'n_cli', n_cli, 'n_enlazados', n_enlazados,
    'sin_tipo', 0, 'n_rec', 0, 'n_emi', 0, 'n_casadas', 0, 'n_sin_casar', 0, 'hechos_a', 0, 'hechos_f', 0,
    'terceros_prov', (select count(*)::int from jsonb_array_elements(coalesce(p_datos->'terceros', '[]')) z where z->>'clase' = 'proveedor'),
    'terceros_cli', (select count(*)::int from jsonb_array_elements(coalesce(p_datos->'terceros', '[]')) z where z->>'clase' = 'cliente'),
    'tercero', v_tercero, 'mirar', v_mirar, 'emitidas', '[]'::jsonb, 'provs', v_provs, 'fichas', v_fichas,
    'deshacer', v_deshacer, 'corte', v_corte,
    'aprendido', coalesce(p_datos->'aprendido', '[]'), 'pendientesNoExactos', coalesce(p_datos->'pendientesNoExactos', '[]'),
    'inmovilizado', p_datos->'inmovilizado', 'frases', coalesce(p_datos->'frases', '[]'), 'sumas', p_datos->'sumas');
  update public.import_run set detail = jsonb_build_object('estado', v_estado) where id = v_carga;

  -- Lo que quepa, ya: una carga pequeña entra entera en esta misma llamada, como antes.
  v_r2 := public._conta_traer_seguir(v_carga, v_empieza + public._conta_traer_margen());
  return v_r2;
end $function$

;

-- 2 · _conta_traer_seguir: no anuncia un día de inicio ---------------------------------------------------------------
select public._respaldar_funcion('public._conta_traer_seguir(uuid,timestamp with time zone)', '20261125T0903_x14c_dia_de_inicio_a_mano');
CREATE OR REPLACE FUNCTION public._conta_traer_seguir(p_carga uuid, p_hasta timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  st jsonb; tz record; n_hechos int := 0;
  v_carga uuid := p_carga; v_company uuid; v_cuenta uuid; v_prog text; v_nombre_prog text; v_quien text; v_inicio date; v_hasta date;
  v_fuera_a int; v_fuera_f int; v_apuntes int; v_tot_debe numeric; v_tot_haber numeric; n_asientos int; n_facturas int;
  n_cuentas int; n_cuentas_estaban int; n_prov int; n_cli int; n_enlazados int; v_sin_tipo int; n_rec int; n_emi int; n_casadas int; n_sin_casar int;
  v_tercero jsonb; v_mirar jsonb; v_emitidas jsonb; v_provs jsonb; v_fichas jsonb; v_deshacer jsonb; v_corte jsonb;
  a jsonb; l jsonb; f jsonb; x jsonb;
  v_lineas jsonb; v_r jsonb; v_entry uuid; v_tipo_id uuid; v_ret_id uuid; v_ret_modelo text;
  v_sup uuid; v_party uuid; v_nif text; v_fac uuid; v_num int; v_serie text;
  v_aprendidas int := 0; v_valor text; v_etiqueta text; v_texto text; v_counts jsonb;
begin
  st := (select detail->'estado' from public.import_run where id = p_carga and kind = 'carga' and status = 'cargando' for update);
  if st is null then raise exception 'Esa carga no está a medias.' using errcode = '23514'; end if;
  v_company := (st->>'company')::uuid; v_cuenta := (st->>'cuenta')::uuid; v_prog := st->>'prog'; v_nombre_prog := st->>'nombre_prog'; v_quien := st->>'quien';
  v_inicio := (st->>'inicio')::date; v_hasta := (st->>'hasta')::date; v_fuera_a := (st->>'fuera_a')::int; v_fuera_f := (st->>'fuera_f')::int;
  v_apuntes := (st->>'apuntes')::int; v_tot_debe := (st->>'tot_debe')::numeric; v_tot_haber := (st->>'tot_haber')::numeric;
  n_asientos := (st->>'n_asientos')::int; n_facturas := (st->>'n_facturas')::int;
  n_cuentas := (st->>'n_cuentas')::int; n_cuentas_estaban := (st->>'n_cuentas_estaban')::int; n_prov := (st->>'n_prov')::int; n_cli := (st->>'n_cli')::int;
  n_enlazados := (st->>'n_enlazados')::int; v_sin_tipo := (st->>'sin_tipo')::int; n_rec := (st->>'n_rec')::int; n_emi := (st->>'n_emi')::int;
  n_casadas := (st->>'n_casadas')::int; n_sin_casar := (st->>'n_sin_casar')::int;
  v_tercero := st->'tercero'; v_mirar := st->'mirar'; v_emitidas := st->'emitidas'; v_provs := st->'provs'; v_fichas := st->'fichas';
  v_deshacer := st->'deshacer'; v_corte := st->'corte';

  -- La cola, en orden (los asientos antes que las facturas, que se atan a ellos), hasta la hora. Siempre avanza al menos uno.
  for tz in select q.orden, q.tipo, q.dato from public.conta_traer_trozo q where q.carga = p_carga and not q.hecho order by q.orden loop
    exit when n_hechos > 0 and clock_timestamp() > p_hasta;
    update public.conta_traer_trozo q set hecho = true where q.carga = p_carga and q.orden = tz.orden;
    n_hechos := n_hechos + 1;
    if tz.tipo = 'asiento' then
      a := tz.dato;
      st := jsonb_set(st, '{hechos_a}', to_jsonb((st->>'hechos_a')::int + 1));
      v_lineas := '[]';
      for l in select * from jsonb_array_elements(a->'apuntes') loop
        x := jsonb_build_object('cuenta', l->>'cuenta', 'debe', (l->>'debe')::numeric / 100, 'haber', (l->>'haber')::numeric / 100,
                                'concepto', nullif(l->>'concepto', ''), 'comun', true, 'tercero_id', v_tercero->(l->>'cuenta')->>'party');
        if l ? 'iva' then
          select r.id into v_tipo_id from public.tax_rate r
           where r.rate = (l->'iva'->>'tipo')::numeric and r.treatment = 'taxed' and r.valid_to is null and r.name like 'IVA%' limit 1;
          if v_tipo_id is not null then
            x := x || jsonb_build_object('iva', jsonb_build_object('tipo_id', v_tipo_id, 'base', (l->'iva'->>'base')::numeric / 100,
                       'libro', l->'iva'->>'libro', 'deducible', case when l->'iva'->>'libro' = 'received' then 'yes' end, 'facturas', 1));
          else
            v_sin_tipo := v_sin_tipo + 1;
          end if;
        elsif l ? 'retencion' then
          -- 19 %: alquiler si el asiento lleva un 621; si no, no se sabe (también es el de capital).
          select r.id, r.filed_in into v_ret_id, v_ret_modelo from public.withholding_rate r
           where r.is_system and r.valid_to is null and r.rate = (l->'retencion'->>'tipo')::numeric
             and (r.rate <> 19 or (r.code = 'alquiler' and exists (select 1 from jsonb_array_elements(a->'apuntes') z where z->>'cuenta' like '621%')))
             and r.code <> 'trabajo'
           order by r.sort_order limit 1;
          if v_ret_id is not null then
            x := x || jsonb_build_object('retencion', jsonb_build_object('tipo_id', v_ret_id, 'base', (l->'retencion'->>'base')::numeric / 100, 'modelo', v_ret_modelo));
          else
            v_sin_tipo := v_sin_tipo + 1;
          end if;
        elsif l ? 'sinTipo' then
          v_sin_tipo := v_sin_tipo + 1;
        end if;
        v_lineas := v_lineas || x;
      end loop;
      v_r := public._journal_entry_proponer(v_company,
        jsonb_build_object('source_type', 'migrated', 'fecha', a->>'fecha',
          'series', 8,   -- N06b · la serie de lo traído: se numera al darlo por bueno (#715)
          'concepto', coalesce(nullif(trim(a->>'concepto'), ''), 'Asiento ' || coalesce(nullif(a->>'documento', ''), a->>'clave') || ' de ' || v_nombre_prog),
          'documento', nullif(a->>'documento', ''),
          'externo', jsonb_build_object('programa', v_nombre_prog, 'ejercicio', left(a->>'fecha', 4), 'serie', a->>'serie',
                                        'numero', coalesce(nullif(a->>'documento', ''), a->>'clave')),
          'carga', v_carga),
        v_lineas, '{}'::jsonb, v_nombre_prog || ' (traído)', auth.uid());
      update public.conta_traer_trozo q set entrada = (v_r->>'id')::uuid where q.carga = p_carga and q.orden = tz.orden;   -- X14 · para sus facturas
    else
      f := tz.dato;
      st := jsonb_set(st, '{hechos_f}', to_jsonb((st->>'hechos_f')::int + 1));
      v_entry := null;   -- X14 · el asiento de Sumied de su asiento de allí, apuntado en la cola
      select q.entrada into v_entry from public.conta_traer_trozo q where q.carga = p_carga and q.clave = f->>'asiento';
      v_nif := nullif(public.party_nif(f->>'nif'), '');
      if f->>'libro' = 'recibidas' then
        v_sup := null;
        select (v->>'supplier')::uuid into v_sup from jsonb_each(v_tercero) e(k, v)
         where v->>'supplier' is not null and v->>'nif' = v_nif limit 1;
        if v_sup is null and v_nif is not null then
          select s.id into v_sup from public.supplier s where s.account_id = v_cuenta and public.party_nif(s.tax_id) = v_nif and s.archived_at is null
           order by s.created_at limit 1;
        end if;
        if v_sup is null then
          insert into public.supplier (account_id, name, legal_name, tax_id, created_by_name, import_run_id)
          values (v_cuenta, f->>'nombre', f->>'nombre', f->>'nif', v_nombre_prog || ' (traído)', v_carga) returning id into v_sup;
          n_prov := n_prov + 1;
          v_mirar := v_mirar || jsonb_build_object('que', 'tercero', 'frase',
            format('El proveedor %s de la factura %s no estaba en el listado de proveedores: se ha creado sin cuenta.', f->>'nombre', f->>'numero'));
        end if;
        if exists (select 1 from public.supplier_invoice i where i.account_id = v_cuenta and i.supplier_id = v_sup
                     and public.conta_clave_numero(i.invoice_number) = public.conta_clave_numero(f->>'numero')
                     and round(i.grand_total * 100) = (f->>'total')::numeric and i.status not in ('anulada', 'descartada')) then
          v_mirar := v_mirar || jsonb_build_object('que', 'factura', 'frase',
            format('La factura %s de %s ya estaba en Sumied: no se ha traído otra vez.', f->>'numero', f->>'nombre'));
          continue;
        end if;
        -- La retención, con su tipo (19 %: alquiler si su asiento va a un 621; si no, no se sabe y se dice).
        v_ret_id := null;
        if coalesce((f->'retencion'->>'importe')::numeric, 0) <> 0 then
          select r.id into v_ret_id from public.withholding_rate r
           where r.is_system and r.valid_to is null and r.code <> 'trabajo' and r.rate = (f->'retencion'->>'tipo')::numeric
             and (r.rate <> 19 or (r.code = 'alquiler' and coalesce((f->>'asiento621')::boolean, false)))   -- X14 · mirado al encolar
           order by r.sort_order limit 1;
          if v_ret_id is null then
            v_mirar := v_mirar || jsonb_build_object('que', 'factura', 'frase',
              format('La factura %s de %s lleva una retención de %s que no sé de qué tipo es: se ha traído sin ella. Pónsela al repasarla.',
                     f->>'numero', f->>'nombre', public._conta_traer_euros((f->'retencion'->>'importe')::numeric)));
          end if;
        end if;
        insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, status, source,
                                             tax_base_total, tax_total, grand_total, withholding_rate_id, withholding_amount, withholding_base, journal_entry_id,
                                             needs_review, created_by, created_by_name, approved_at, approved_by, approved_by_name,
                                             issuer_name, issuer_tax_id, import_run_id, import_mark, import_pending)
        values (v_cuenta, v_company, v_sup, f->>'numero', (f->>'fecha')::date,
                case when (f->>'pendiente')::numeric = 0 then 'pagada' else 'aprobada' end, 'traida',
                (f->>'base')::numeric / 100, (f->>'cuota')::numeric / 100, (f->>'total')::numeric / 100,
                v_ret_id, case when v_ret_id is not null then (f->'retencion'->>'importe')::numeric / 100 end,
                case when v_ret_id is not null then (f->>'base')::numeric / 100 end,
                v_entry, false, auth.uid(), v_nombre_prog || ' (traída)', now(), auth.uid(), v_nombre_prog || ' (traída)',
                f->>'nombre', f->>'nif', v_carga, case when v_entry is null then 'sin_casar' end, (f->>'pendiente')::numeric / 100)
        returning id into v_fac;
        insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount)
        select v_cuenta, v_fac, coalesce((z->>'tipo')::numeric, 0), (z->>'base')::numeric / 100, (z->>'cuota')::numeric / 100
          from jsonb_array_elements(coalesce(f->'tramos', '[]')) z;
        n_rec := n_rec + 1;
      else
        v_party := null;
        select (v->>'party')::uuid into v_party from jsonb_each(v_tercero) e(k, v)
         where v->>'supplier' is null and v->>'nif' = v_nif limit 1;
        if v_party is null and v_nif is not null then
          select p.id into v_party from public.party p where p.account_id = v_cuenta and p.tax_id = v_nif;
        end if;
        v_serie := upper(regexp_replace(coalesce(nullif(f->>'serie', ''), v_prog), '[^A-Za-z0-9-]', '', 'g'));
        if v_serie !~ '^[A-Z0-9][A-Z0-9-]{0,9}$' then v_serie := 'ERP10'; end if;
        v_num := case when coalesce(f->>'numeroSolo', '') ~ '^[0-9]{1,9}$' then (f->>'numeroSolo')::int
                      when f->>'numero' ~ '[0-9]{1,9}$' then substring(f->>'numero' from '([0-9]{1,9})$')::int end;
        if v_num is null or v_num = 0 or exists (select 1 from public.customer_invoice c where c.company_id = v_company and c.series_code = v_serie
                                                    and c.fiscal_year = left(f->>'fecha', 4)::int and c.number = v_num) then
          v_mirar := v_mirar || jsonb_build_object('que', 'factura', 'frase', case when v_num is null or v_num = 0
            then format('La factura emitida %s no tiene un número que Sumied pueda guardar: no se ha traído.', f->>'numero')
            else format('Ya hay en Sumied una factura emitida %s del %s: la %s de %s no se ha traído.', v_serie || '-' || v_num, left(f->>'fecha', 4), f->>'numero', v_nombre_prog) end);
          continue;
        end if;
        -- N06b · Una emitida traída no existe en Sumied hasta darla por buena: mientras, no cuenta en las
        -- emitidas, ni en Cobros, ni en el IVA (respuesta N06a · 1, «no sé» 2). Se guarda con la carga.
        v_emitidas := v_emitidas || jsonb_build_object('id', gen_random_uuid(), 'serie', v_serie, 'ejercicio', left(f->>'fecha', 4)::int, 'numero', v_num,
          'numero_texto', f->>'numero', 'fecha', f->>'fecha', 'party_id', v_party, 'cliente', jsonb_build_object('nombre', f->>'nombre', 'nif', f->>'nif'),
          'base', (f->>'base')::numeric / 100, 'cuota', (f->>'cuota')::numeric / 100, 'retencion', coalesce((f->'retencion'->>'importe')::numeric, 0) / 100,
          'total', (f->>'total')::numeric / 100, 'asiento', v_entry, 'marca', case when v_entry is null then 'sin_casar' end,
          'pendiente', (f->>'pendiente')::numeric / 100);
        n_emi := n_emi + 1;
      end if;
      if v_entry is null then n_sin_casar := n_sin_casar + 1; else n_casadas := n_casadas + 1; end if;
    end if;
  end loop;

  -- Queda cola: se guarda por dónde va y se dice cuánto lleva.
  if exists (select 1 from public.conta_traer_trozo q where q.carga = p_carga and not q.hecho) then
    st := st || jsonb_build_object('sin_tipo', v_sin_tipo, 'n_rec', n_rec, 'n_emi', n_emi, 'n_casadas', n_casadas, 'n_sin_casar', n_sin_casar, 'n_prov', n_prov,
                                   'mirar', v_mirar, 'emitidas', v_emitidas);
    update public.import_run set detail = jsonb_build_object('estado', st) where id = p_carga;
    return jsonb_build_object('carga', p_carga, 'acabado', false,
      'asientos', jsonb_build_object('hechos', (st->>'hechos_a')::int, 'de', n_asientos), 'facturas', jsonb_build_object('hechos', (st->>'hechos_f')::int, 'de', n_facturas));
  end if;

  delete from public.conta_traer_trozo q where q.carga = p_carga;   -- X14 · la cola, vacía: se va

  -- ── Lo aprendido: como propuesta en la ficha, sin pisar ──
  for x in select * from jsonb_array_elements(coalesce(st->'aprendido', '[]')) loop
    v_sup := (v_tercero->(x->>'codigo')->>'supplier')::uuid;
    continue when v_sup is null or jsonb_array_length(coalesce(x->'tiposIva', '[]')) = 0;
    continue when exists (select 1 from public.supplier_learning s where s.supplier_id = v_sup and s.campo = 'tax_rates');
    select string_agg(trim(to_char(v::numeric, 'FM990D99'), ',.'), ',' order by v::numeric),
           'IVA al ' || string_agg(trim(to_char(v::numeric, 'FM990D99'), ',.') || ' %', ' y al ' order by v::numeric)
      into v_valor, v_etiqueta from jsonb_array_elements_text(x->'tiposIva') v;
    insert into public.supplier_learning (account_id, supplier_id, campo, valor, etiqueta, porque, veces, a_mano)
    values (v_cuenta, v_sup, 'tax_rates', v_valor, v_etiqueta, x->>'porque', 1, false)
    returning to_jsonb(id) into x;
    v_deshacer := jsonb_set(v_deshacer, '{aprendido}', (v_deshacer->'aprendido') || x);
    v_aprendidas := v_aprendidas + 1;
  end loop;

  -- ── Lo que se guarda con la carga y lo que se cuenta ──
  v_counts := jsonb_build_object('asientos', n_asientos, 'apuntes', v_apuntes, 'debe', v_tot_debe / 100, 'haber', v_tot_haber / 100,
    'facturas_recibidas', n_rec, 'facturas_emitidas', n_emi, 'casadas', n_casadas, 'sin_casar', n_sin_casar,
    'cuentas_nuevas', n_cuentas, 'cuentas_estaban', n_cuentas_estaban, 'proveedores_nuevos', n_prov, 'clientes_nuevos', n_cli,
    'enlazados', n_enlazados, 'sin_tipo', v_sin_tipo, 'aprendido', v_aprendidas,
    'fuera_asientos', v_fuera_a, 'fuera_facturas', v_fuera_f, 'mirar', jsonb_array_length(v_mirar));
  v_texto := format('Traído en prueba: %s (%s apuntes, %s al debe y al haber) y %s, %s con su asiento.',
    case when n_asientos = 1 then '1 asiento' else n_asientos || ' asientos' end, v_apuntes,
    public._conta_traer_euros(v_tot_debe), case when n_rec + n_emi = 1 then '1 factura' else (n_rec + n_emi) || ' facturas' end, n_casadas)
    || case when n_cuentas + n_prov + n_cli > 0 then format(' Nuevos en Sumied: %s, %s y %s.', public._conta_traer_cuantos(n_cuentas, 'cuenta', 'cuentas'),
              public._conta_traer_cuantos(n_prov, 'proveedor', 'proveedores'), public._conta_traer_cuantos(n_cli, 'cliente', 'clientes')) else '' end
    || case when v_inicio is not null and v_fuera_a + v_fuera_f > 0
         then format(' Del %s en adelante lo lleva ya Sumied: se han dejado fuera %s y %s.', to_char(v_inicio, 'DD/MM/YYYY'),
                     public._conta_traer_cuantos(v_fuera_a, 'asiento', 'asientos'), public._conta_traer_cuantos(v_fuera_f, 'factura', 'facturas')) else '' end   -- X14 · 2: lo traído no fija el día de inicio; no se dice que empieza
    || ' Nada está validado: repásalo y dalo por bueno, o deshazlo.';
  -- N06b · Solo cuentas y terceros: lo que se ha traído y que lo de antes sigue sin traer.
  if n_asientos = 0 and n_facturas = 0 then
    v_texto := format('He traído %s, %s y %s.', public._conta_traer_cuantos(n_cuentas + n_cuentas_estaban, 'cuenta', 'cuentas'),
                      public._conta_traer_cuantos((st->>'terceros_prov')::int, 'proveedor', 'proveedores'),
                      public._conta_traer_cuantos((st->>'terceros_cli')::int, 'cliente', 'clientes'))
      || case when v_inicio is not null then format(' Lo anterior al %s sigue sin traer.', to_char(v_inicio, 'DD/MM/YYYY')) else ' Lo de antes sigue sin traer.' end;
  end if;
  update public.import_run set status = 'en_prueba', finished_at = now(), counts = v_counts,
         detail = jsonb_build_object('mirar', v_mirar, 'aprendido', coalesce(st->'aprendido', '[]'),
                                     'pendientesNoExactos', coalesce(st->'pendientesNoExactos', '[]'), 'inmovilizado', st->'inmovilizado',
                                     'frases', coalesce(st->'frases', '[]'), 'dia_de_inicio', v_inicio,
                                     'sumas', st->'sumas', 'emitidas', v_emitidas, 'proveedores', v_provs, 'solo_plan', n_asientos = 0,
                                     'texto', v_texto,
                                     'deshacer', v_deshacer || jsonb_build_object('corte', v_corte, 'fichas', v_fichas))
   where id = v_carga;
  return jsonb_build_object('carga', v_carga, 'cuentas', v_counts, 'mirar', v_mirar, 'texto', v_texto,
                            'dia_de_inicio', v_inicio, 'acabado', true,
                            'asientos', jsonb_build_object('hechos', n_asientos, 'de', n_asientos), 'facturas', jsonb_build_object('hechos', n_facturas, 'de', n_facturas));
end $function$

;

-- 3 · conta_fijar_corte: a mano, también con lo traído antes -----------------------------------------------------------
select public._respaldar_funcion('public.conta_fijar_corte(uuid,date,text)', '20261125T0903_x14c_dia_de_inicio_a_mano');
CREATE OR REPLACE FUNCTION public.conta_fijar_corte(p_company uuid, p_hasta date, p_programa text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cuenta uuid; v_n int := 0; r record; m date; v_tras int; v_ult date;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.current_user_is_admin_of(v_cuenta) then
    raise exception 'Solo un administrador de la cuenta fija la fecha de corte.' using errcode = '42501';
  end if;
  if p_programa is null or length(trim(p_programa)) = 0 then raise exception 'Hay que decir de qué programa se trae.' using errcode = '23514'; end if;
  -- X14 · 2 · Con asientos traídos también se fija, si todo lo traído queda antes del día de inicio. Si alguno quedaría
  -- desde ese día (lo llevaría Sumied y está traído), para y dice cuántos y hasta cuándo llega lo traído.
  select count(*) filter (where p_hasta is null or e.entry_date > p_hasta), max(e.entry_date) into v_tras, v_ult
    from public.journal_entry e where e.company_id = p_company and e.source_type = 'migrated';
  if v_tras > 0 then
    raise exception '%', case when p_hasta is null
      then format('No se puede quitar el día de inicio: hay %s traídos, el último del %s. Sin día de inicio los llevaría Sumied.',
                  case when v_tras = 1 then '1 asiento' else v_tras || ' asientos' end, to_char(v_ult, 'DD/MM/YYYY'))
      else format('El día de inicio no puede ser el %s: hay %s traídos de ese día en adelante, el último del %s. Como pronto, el %s.',
                  to_char(p_hasta + 1, 'DD/MM/YYYY'), case when v_tras = 1 then '1 asiento' else v_tras || ' asientos' end,
                  to_char(v_ult, 'DD/MM/YYYY'), to_char(v_ult + 1, 'DD/MM/YYYY')) end
      using errcode = '23514', hint = 'traido_despues';
  end if;
  -- Lo que dejó un corte anterior se quita (solo los cierres de mes «traídos»).
  delete from public.fiscal_period_lock where company_id = p_company and kind = 'migrated';
  for r in select * from public.fiscal_year where company_id = p_company order by starts_on loop
    update public.fiscal_year set
      origin = case when p_hasta is null or p_hasta < r.starts_on then 'folvy' when p_hasta >= r.ends_on then 'migrated' else 'mixed' end,
      origin_program = case when p_hasta is null or p_hasta < r.starts_on then null else trim(p_programa) end,
      imported_until = case when p_hasta is null or p_hasta < r.starts_on or p_hasta >= r.ends_on then null else p_hasta end
     where id = r.id;
    if p_hasta is not null and p_hasta >= r.starts_on then
      for m in select generate_series(date_trunc('month', r.starts_on), date_trunc('month', least(p_hasta, r.ends_on)), interval '1 month')::date loop
        -- Solo los meses enteros traídos se cierran (el del corte, si no acaba ese día, sigue abierto desde el día siguiente).
        if (m + interval '1 month' - interval '1 day')::date <= p_hasta
           and not exists (select 1 from public.fiscal_period_lock l where l.company_id = p_company and l.month = m and l.reopened_at is null) then
          insert into public.fiscal_period_lock (account_id, company_id, fiscal_year_id, month, kind, locked_by, locked_by_name)
          values (v_cuenta, p_company, r.id, m, 'migrated', auth.uid(), public.conta_nombre_actor());
          v_n := v_n + 1;
        end if;
      end loop;
    end if;
  end loop;
  return jsonb_build_object('hasta', p_hasta, 'programa', p_programa, 'meses_cerrados', v_n);
end $function$

;

-- 4 · fiscal_year_corte_cambiable: ejercicio a ejercicio, lo mismo -----------------------------------------------------
select public._respaldar_funcion('public.fiscal_year_corte_cambiable()', '20261125T0903_x14c_dia_de_inicio_a_mano');
CREATE OR REPLACE FUNCTION public.fiscal_year_corte_cambiable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (new.origin, new.origin_program, new.imported_until) is distinct from (old.origin, old.origin_program, old.imported_until)
     -- X14 · 2 · Solo para si lo traído de este ejercicio quedaría en la parte que lleva Sumied: el ejercicio entero
     -- (deja de ser traído) o, si es mixto, del día siguiente al corte en adelante. Moverlo dejando lo traído antes, pasa.
     and exists (select 1 from public.journal_entry e where e.fiscal_year_id = old.id and e.source_type = 'migrated'
                  and (new.origin is distinct from 'migrated')
                  and (new.origin is distinct from 'mixed' or new.imported_until is null or e.entry_date > new.imported_until)) then
    raise exception 'El ejercicio % tiene asientos traídos después de ese día: el día de inicio no puede ir antes de lo traído (o se deshace lo traído y se vuelve a traer).', old.code
      using errcode = '23514';
  end if;
  return new;
end $function$

;
