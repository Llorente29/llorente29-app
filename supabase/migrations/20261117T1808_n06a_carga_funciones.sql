-- supabase/migrations/20261117T1808_n06a_carga_funciones.sql
--
-- N06a · Traer de otro programa: la carga en prueba y deshacerla (17/11). 3 de 3: LAS FUNCIONES.
-- Solo AÑADE funciones nuevas (no cambia ninguna de las que hay ni ninguna fila). Usa lo que añade
-- la 1806 (las columnas) y lo que cambia la 1807 (el embudo y la carga como kind).
--
--   conta_traer_cargar(empresa, ejercicio, datos, quien)   «Traerlo» (3.2 del N06), EN PRUEBA.
--     Recibe lo leído por el módulo del N04 en la forma de paraLaBase (importes en céntimos) y, en
--     una sola transacción: crea las subcuentas que faltan (las que están no se tocan; si el nombre
--     es otro, se apunta), los terceros que faltan enlazados a su subcuenta (mismo NIF: se enlaza y
--     se apunta), cada asiento EN BORRADOR por el embudo (_journal_entry_proponer) con su fecha, su
--     serie y su número de allí, marcado como traído y atado a la carga, sin validar; y las facturas
--     como traídas, atadas a la carga y a su asiento cuando casa, sin propuestas, pagos ni avisos,
--     con lo pendiente por el saldo del tercero (decisión 3). Lo aprendido de los proveedores, como
--     propuesta en su ficha sin pisar nada. El inmovilizado se guarda con la carga.
--     Para con su frase si: hay otra carga en prueba; el largo de las cuentas no es el de la
--     empresa (decisión 7: no se convierte nada); el diario no cuadra; falta el ejercicio; o el
--     periodo ya tiene asientos apuntados en Sumied.
--     El día de inicio (decisión 1 de la respuesta N06 · 1 y respuesta N05c · 1): si la empresa ya
--     lo tiene, no se toca y se trae solo lo anterior (lo demás se deja fuera y se dice cuánto); si
--     no lo tiene, se fija con conta_fijar_corte en el día siguiente al último traído.
--   conta_traer_deshacer(carga, quien)          «Deshacer el traspaso» (3.3): solo en prueba.
--   conta_traer_dejar_fuera(carga, facturas, fuera)   «Dejarlas fuera» (3.4): marcadas, no se van.
--   conta_empresa_dia_de_inicio(empresa)        el día de inicio, para la pantalla (lo lee de la
--     base con conta_dia_de_inicio, no lo calcula: respuesta N05c · 1, punto 1).
--
-- Nada en el camino del pedido.

-- Un número en céntimos, en euros con coma, como se lee: 11499,00 → «11.499,00».
create or replace function public._conta_traer_euros(p_cent numeric)
returns text language sql immutable set search_path = public as $$
  select replace(replace(replace(to_char(p_cent / 100.0, 'FM999G999G999G990D00'), ',', '#'), '.', ','), '#', '.')
$$;
revoke all on function public._conta_traer_euros(numeric) from public, anon;
grant execute on function public._conta_traer_euros(numeric) to authenticated, service_role;

-- «1 cuenta», «16 cuentas».
create or replace function public._conta_traer_cuantos(p_n int, p_uno text, p_varios text)
returns text language sql immutable set search_path = public as $$
  select p_n || ' ' || case when p_n = 1 then p_uno else p_varios end
$$;
revoke all on function public._conta_traer_cuantos(int, text, text) from public, anon;
grant execute on function public._conta_traer_cuantos(int, text, text) to authenticated, service_role;

-- El kind de import_run de cada fichero leído.
create or replace function public._conta_traer_kind(p_tipo text)
returns text language sql immutable set search_path = public as $$
  select case p_tipo when 'plan_cuentas' then 'plan_cuentas' when 'proveedores' then 'terceros' when 'clientes' then 'terceros'
                     when 'inmovilizado' then 'inmovilizado' when 'diario' then 'diario' when 'sumas_saldos' then 'sumas_saldos'
                     when 'recibidas' then 'recibidas' when 'expedidas' then 'emitidas' end
$$;
revoke all on function public._conta_traer_kind(text) from public, anon, authenticated;
grant execute on function public._conta_traer_kind(text) to service_role;

create or replace function public.conta_traer_cargar(p_company uuid, p_ejercicio text, p_datos jsonb, p_quien_nombre text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
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
  v_lineas jsonb; v_r jsonb; v_entry uuid; v_ids jsonb := '{}';   -- «clave|fecha» → asiento
  v_tipo_id uuid; v_ret_id uuid; v_ret_modelo text; v_sin_tipo int := 0;
  v_fac uuid; n_rec int := 0; n_emi int := 0; n_casadas int := 0; n_sin_casar int := 0; v_num int; v_serie text;
  v_aprendidas int := 0; v_valor text; v_etiqueta text;
  v_mirar jsonb := '[]'; v_corte jsonb := null; v_locks jsonb;
  v_deshacer jsonb := jsonb_build_object('enlaces', '[]'::jsonb, 'roles', '[]'::jsonb, 'fiscales', '[]'::jsonb, 'aprendido', '[]'::jsonb);
  v_texto text; v_counts jsonb;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.current_user_is_admin_of(v_cuenta) then
    raise exception 'Solo un administrador de la cuenta trae la contabilidad de otro programa.' using errcode = '42501';
  end if;
  v_quien := coalesce(nullif(trim(p_quien_nombre), ''), public.conta_nombre_actor());
  perform pg_advisory_xact_lock(hashtextextended('conta_traer:' || p_company::text, 0));

  -- ── Las paradas ──
  select * into v_otra from public.import_run r where r.company_id = p_company and r.kind = 'carga' and r.status = 'en_prueba' limit 1;
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
  for a in select * from jsonb_array_elements(p_datos->'asientos') loop
    continue when p_ejercicio is not null and left(a->>'fecha', 4) <> p_ejercicio;
    if v_inicio is not null and (a->>'fecha')::date >= v_inicio then v_fuera_a := v_fuera_a + 1; continue; end if;
    v_asientos := v_asientos || a;
  end loop;
  for f in select * from jsonb_array_elements(coalesce(p_datos->'facturas', '[]')) loop
    continue when p_ejercicio is not null and left(f->>'fecha', 4) <> p_ejercicio;
    if v_inicio is not null and (f->>'fecha')::date >= v_inicio then v_fuera_f := v_fuera_f + 1; continue; end if;
    v_facturas := v_facturas || f;
  end loop;
  if jsonb_array_length(v_asientos) = 0 and jsonb_array_length(v_facturas) = 0 then
    raise exception '%', case when v_inicio is not null and v_fuera_a + v_fuera_f > 0
      then format('No hay nada que traer: todo lo leído es del %s en adelante, y desde ese día la contabilidad ya la lleva Sumied.', to_char(v_inicio, 'DD/MM/YYYY'))
      else 'No hay nada que traer: no hay asientos ni facturas de ese ejercicio.' end using errcode = '23514', hint = 'nada';
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
  values (v_cuenta, p_company, v_prog, 'carga', v_desde, v_hasta, 'en_prueba', now(), auth.uid(), v_quien)
  returning id into v_carga;
  insert into public.import_run (account_id, company_id, program, kind, period_from, period_to, status, finished_at, counts, created_by, created_by_name, parent_id)
  select v_cuenta, p_company, v_prog, public._conta_traer_kind(fi.v->>'tipo'), v_desde, v_hasta, 'hecho', now(),
         jsonb_build_object('fichero', fi.v->>'nombre', 'haLeido', fi.v->>'haLeido'), auth.uid(), v_quien, v_carga
    from jsonb_array_elements(coalesce(p_datos->'ficheros', '[]')) fi(v)
   where public._conta_traer_kind(fi.v->>'tipo') is not null;

  -- ── El día de inicio: si no lo tiene, el siguiente al último traído ──
  if v_inicio is null then
    select coalesce(jsonb_agg(jsonb_build_object('id', y.id, 'origin', y.origin, 'origin_program', y.origin_program, 'imported_until', y.imported_until)), '[]')
      into v_corte from public.fiscal_year y where y.company_id = p_company;
    select coalesce(jsonb_agg(l.id), '[]') into v_locks from public.fiscal_period_lock l where l.company_id = p_company;
    perform public.conta_fijar_corte(p_company, v_hasta, v_nombre_prog);
    v_corte := jsonb_build_object('ejercicios', v_corte, 'cierres', v_locks);
  end if;

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
        v_mirar := v_mirar || jsonb_build_object('que', 'tercero', 'cuenta', v_code,
          'frase', format('El proveedor %s (%s) ya estaba en Sumied: se ha enlazado a la cuenta %s, sin tocar su ficha.', v_nombre, t->>'nif', v_code));
      else
        insert into public.supplier (account_id, name, legal_name, tax_id, created_by_name, import_run_id)
        values (v_cuenta, coalesce(nullif(trim(t->>'nombreComercial'), ''), v_nombre), v_nombre, t->>'nif', v_nombre_prog || ' (traído)', v_carga)
        returning id into v_sup;
        n_prov := n_prov + 1;
      end if;
      select party_id into v_party from public.party_role where account_id = v_cuenta and role = 'supplier' and supplier_id = v_sup;
      insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
      values (v_cuenta, p_company, v_cta, 'supplier', v_sup::text, 'principal', 'migrated')
      on conflict do nothing returning id into v_link;
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
      insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
      values (v_cuenta, p_company, v_cta, 'customer', v_party::text, 'principal', 'migrated')
      on conflict do nothing returning id into v_link;
    end if;
    if v_link is not null then
      v_deshacer := jsonb_set(v_deshacer, '{enlaces}', (v_deshacer->'enlaces') || to_jsonb(v_link));
    elsif not exists (select 1 from public.company_account_link k where k.company_id = p_company and k.company_account_id = v_cta
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

  -- ── Los asientos: en borrador, por el embudo, con su número de allí ──
  for a in select * from jsonb_array_elements(v_asientos) loop
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
    v_r := public._journal_entry_proponer(p_company,
      jsonb_build_object('source_type', 'migrated', 'fecha', a->>'fecha',
        'series', case when a->>'serie' in ('1', '2', '3', '4', '9') then (a->>'serie')::int else 1 end,
        'concepto', coalesce(nullif(trim(a->>'concepto'), ''), 'Asiento ' || coalesce(nullif(a->>'documento', ''), a->>'clave') || ' de ' || v_nombre_prog),
        'documento', nullif(a->>'documento', ''),
        'externo', jsonb_build_object('programa', v_nombre_prog, 'ejercicio', left(a->>'fecha', 4), 'serie', a->>'serie',
                                      'numero', coalesce(nullif(a->>'documento', ''), a->>'clave')),
        'carga', v_carga),
      v_lineas, '{}'::jsonb, v_nombre_prog || ' (traído)', auth.uid());
    v_ids := v_ids || jsonb_build_object((a->>'clave') || '|' || (a->>'fecha'), v_r->>'id');
  end loop;

  -- ── Las facturas: traídas, atadas a la carga y a su asiento ──
  for f in select * from jsonb_array_elements(v_facturas) loop
    v_entry := nullif(v_ids->>(f->>'asiento'), '')::uuid;
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
           and (r.rate <> 19 or (r.code = 'alquiler' and exists (
                 select 1 from jsonb_array_elements(v_asientos) a3, jsonb_array_elements(a3->'apuntes') z
                  where (a3->>'clave') || '|' || (a3->>'fecha') = f->>'asiento' and z->>'cuenta' like '621%')))
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
      values (v_cuenta, p_company, v_sup, f->>'numero', (f->>'fecha')::date,
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
      if v_num is null or v_num = 0 or exists (select 1 from public.customer_invoice c where c.company_id = p_company and c.series_code = v_serie
                                                  and c.fiscal_year = left(f->>'fecha', 4)::int and c.number = v_num) then
        v_mirar := v_mirar || jsonb_build_object('que', 'factura', 'frase', case when v_num is null or v_num = 0
          then format('La factura emitida %s no tiene un número que Sumied pueda guardar: no se ha traído.', f->>'numero')
          else format('Ya hay en Sumied una factura emitida %s del %s: la %s de %s no se ha traído.', v_serie || '-' || v_num, left(f->>'fecha', 4), f->>'numero', v_nombre_prog) end);
        continue;
      end if;
      insert into public.customer_invoice (account_id, company_id, status, doc_type, origin, series_code, fiscal_year, number, number_text, issue_date,
                                           party_id, customer, base, tax, withholding_amount, total, entry_id, created_by, created_by_name,
                                           issued_at, issued_by_name, import_run_id, import_mark, import_pending)
      values (v_cuenta, p_company, 'emitida', 'factura', 'traida', v_serie, left(f->>'fecha', 4)::int, v_num, f->>'numero', (f->>'fecha')::date,
              v_party, jsonb_build_object('nombre', f->>'nombre', 'nif', f->>'nif'),
              (f->>'base')::numeric / 100, (f->>'cuota')::numeric / 100, coalesce((f->'retencion'->>'importe')::numeric, 0) / 100, (f->>'total')::numeric / 100,
              v_entry, auth.uid(), v_nombre_prog || ' (traída)', now(), v_nombre_prog || ' (traída)', v_carga,
              case when v_entry is null then 'sin_casar' end, (f->>'pendiente')::numeric / 100);
      n_emi := n_emi + 1;
    end if;
    if v_entry is null then n_sin_casar := n_sin_casar + 1; else n_casadas := n_casadas + 1; end if;
  end loop;

  -- ── Lo aprendido: como propuesta en la ficha, sin pisar ──
  for x in select * from jsonb_array_elements(coalesce(p_datos->'aprendido', '[]')) loop
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
  v_counts := jsonb_build_object('asientos', jsonb_array_length(v_asientos), 'apuntes', v_apuntes, 'debe', v_tot_debe / 100, 'haber', v_tot_haber / 100,
    'facturas_recibidas', n_rec, 'facturas_emitidas', n_emi, 'casadas', n_casadas, 'sin_casar', n_sin_casar,
    'cuentas_nuevas', n_cuentas, 'cuentas_estaban', n_cuentas_estaban, 'proveedores_nuevos', n_prov, 'clientes_nuevos', n_cli,
    'enlazados', n_enlazados, 'sin_tipo', v_sin_tipo, 'aprendido', v_aprendidas,
    'fuera_asientos', v_fuera_a, 'fuera_facturas', v_fuera_f, 'mirar', jsonb_array_length(v_mirar));
  v_texto := format('Traído en prueba: %s (%s apuntes, %s al debe y al haber) y %s, %s con su asiento.',
    case when jsonb_array_length(v_asientos) = 1 then '1 asiento' else jsonb_array_length(v_asientos) || ' asientos' end, v_apuntes,
    public._conta_traer_euros(v_tot_debe), case when n_rec + n_emi = 1 then '1 factura' else (n_rec + n_emi) || ' facturas' end, n_casadas)
    || case when n_cuentas + n_prov + n_cli > 0 then format(' Nuevos en Sumied: %s, %s y %s.', public._conta_traer_cuantos(n_cuentas, 'cuenta', 'cuentas'),
              public._conta_traer_cuantos(n_prov, 'proveedor', 'proveedores'), public._conta_traer_cuantos(n_cli, 'cliente', 'clientes')) else '' end
    || case when v_inicio is not null and v_fuera_a + v_fuera_f > 0
         then format(' Del %s en adelante lo lleva ya Sumied: se han dejado fuera %s y %s.', to_char(v_inicio, 'DD/MM/YYYY'),
                     public._conta_traer_cuantos(v_fuera_a, 'asiento', 'asientos'), public._conta_traer_cuantos(v_fuera_f, 'factura', 'facturas'))
         when v_inicio is null then format(' Sumied empieza a llevar la contabilidad el %s.', to_char(v_hasta + 1, 'DD/MM/YYYY')) else '' end
    || ' Nada está validado: repásalo y dalo por bueno, o deshazlo.';
  update public.import_run set counts = v_counts,
         detail = jsonb_build_object('mirar', v_mirar, 'aprendido', coalesce(p_datos->'aprendido', '[]'),
                                     'pendientesNoExactos', coalesce(p_datos->'pendientesNoExactos', '[]'), 'inmovilizado', p_datos->'inmovilizado',
                                     'frases', coalesce(p_datos->'frases', '[]'), 'dia_de_inicio', coalesce(v_inicio, v_hasta + 1),
                                     'deshacer', v_deshacer || jsonb_build_object('corte', v_corte))
   where id = v_carga;
  return jsonb_build_object('carga', v_carga, 'cuentas', v_counts, 'mirar', v_mirar, 'texto', v_texto,
                            'dia_de_inicio', coalesce(v_inicio, v_hasta + 1));
end $$;
revoke all on function public.conta_traer_cargar(uuid, text, jsonb, text) from public, anon;
grant execute on function public.conta_traer_cargar(uuid, text, jsonb, text) to authenticated, service_role;

create or replace function public.conta_traer_deshacer(p_carga uuid, p_quien_nombre text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_r public.import_run; v_quien text; v_d jsonb; x jsonb; v_id uuid;
  n_asientos int; n_rec int; n_emi int; n_aprendido int; n_enlaces int; n_cuentas int := 0; n_prov int := 0; n_cli int := 0;
  q_cuentas int := 0; q_prov int := 0; q_cli int := 0; v_texto text;
begin
  select * into v_r from public.import_run where id = p_carga;
  if v_r.id is null or v_r.kind <> 'carga' then raise exception 'Esa carga no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_of(v_r.account_id) then
    raise exception 'Solo un administrador de la cuenta deshace lo traído.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('conta_traer:' || v_r.company_id::text, 0));
  select * into v_r from public.import_run where id = p_carga for update;
  if v_r.status = 'dada_por_buena' then
    raise exception 'Esta carga ya está dada por buena: no se deshace. Lo traído se corrige como cualquier asiento validado.' using errcode = '23514', hint = 'dada_por_buena';
  end if;
  if v_r.status = 'deshecha' then
    raise exception 'Esta carga ya está deshecha (el %, por %).', to_char(((v_r.detail->'deshecha'->>'el')::timestamptz) at time zone 'Europe/Madrid', 'DD/MM/YYYY'),
      v_r.detail->'deshecha'->>'por' using errcode = '23514', hint = 'deshecha';
  end if;
  if v_r.status <> 'en_prueba' then raise exception 'Esta carga no está en prueba: no se deshace.' using errcode = '23514'; end if;
  if exists (select 1 from public.journal_entry e where e.import_run_id = p_carga and e.status <> 'borrador') then
    raise exception 'Hay asientos de esta carga que ya no están en borrador: no se deshace nada.' using errcode = '23514';
  end if;
  if exists (select 1 from public.supplier_invoice i where i.import_run_id = p_carga and (i.payment_entry_id is not null or i.paid_at is not null)) then
    raise exception 'Hay facturas traídas de esta carga con un pago apuntado en Sumied: quita ese pago antes de deshacer.' using errcode = '23514', hint = 'con_pago';
  end if;
  v_quien := coalesce(nullif(trim(p_quien_nombre), ''), public.conta_nombre_actor());
  v_d := coalesce(v_r.detail->'deshacer', '{}');

  delete from public.supplier_learning where id in (select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(v_d->'aprendido', '[]')));
  get diagnostics n_aprendido = row_count;
  delete from public.supplier_invoice where import_run_id = p_carga and source = 'traida';
  get diagnostics n_rec = row_count;
  delete from public.customer_invoice where import_run_id = p_carga and origin = 'traida';
  get diagnostics n_emi = row_count;
  delete from public.journal_entry where import_run_id = p_carga and source_type = 'migrated' and status = 'borrador';
  get diagnostics n_asientos = row_count;

  -- El día de inicio, como estaba (solo si lo fijó esta carga).
  if jsonb_typeof(v_d->'corte') = 'object' then
    delete from public.fiscal_period_lock l where l.company_id = v_r.company_id
       and not exists (select 1 from jsonb_array_elements_text(v_d->'corte'->'cierres') c where c::uuid = l.id);
    for x in select * from jsonb_array_elements(v_d->'corte'->'ejercicios') loop
      update public.fiscal_year set origin = x->>'origin', origin_program = x->>'origin_program', imported_until = (x->>'imported_until')::date
       where id = (x->>'id')::uuid;
    end loop;
  end if;

  delete from public.company_account_link where id in (select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(v_d->'enlaces', '[]')));
  get diagnostics n_enlaces = row_count;
  delete from public.party_role where id in (select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(v_d->'roles', '[]')));
  delete from public.customer_fiscal where party_id in (select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(v_d->'fiscales', '[]')));
  -- Lo creado por la carga, si nadie lo usa ya (lo que se usa después de traer, se queda).
  for v_id in select id from public.company_account where import_run_id = p_carga order by code desc loop
    begin
      delete from public.company_account where id = v_id; n_cuentas := n_cuentas + 1;
    exception when foreign_key_violation or raise_exception or check_violation then q_cuentas := q_cuentas + 1;
    end;
  end loop;
  for v_id in select id from public.supplier where import_run_id = p_carga loop
    begin
      delete from public.supplier where id = v_id; n_prov := n_prov + 1;
    exception when foreign_key_violation or raise_exception or check_violation then q_prov := q_prov + 1;
    end;
  end loop;
  for v_id in select id from public.party where import_run_id = p_carga loop
    begin
      delete from public.party where id = v_id; n_cli := n_cli + 1;
    exception when foreign_key_violation or raise_exception or check_violation then q_cli := q_cli + 1;
    end;
  end loop;

  v_texto := format('Deshecho: se han quitado %s, %s, %s, %s y %s que trajo la carga.',
                    public._conta_traer_cuantos(n_asientos, 'asiento', 'asientos'), public._conta_traer_cuantos(n_rec + n_emi, 'factura', 'facturas'),
                    public._conta_traer_cuantos(n_cuentas, 'cuenta', 'cuentas'), public._conta_traer_cuantos(n_prov, 'proveedor', 'proveedores'),
                    public._conta_traer_cuantos(n_cli, 'cliente', 'clientes'))
    || case when q_cuentas + q_prov + q_cli > 0
         then format(' Se quedan %s, %s y %s porque ya se usan en lo apuntado después.', public._conta_traer_cuantos(q_cuentas, 'cuenta', 'cuentas'),
                     public._conta_traer_cuantos(q_prov, 'proveedor', 'proveedores'), public._conta_traer_cuantos(q_cli, 'cliente', 'clientes')) else '' end
    || case when jsonb_typeof(v_d->'corte') = 'object' then ' El día de inicio vuelve a estar sin fijar.' else '' end;
  update public.import_run set status = 'deshecha',
         detail = coalesce(detail, '{}') || jsonb_build_object('deshecha', jsonb_build_object('por', v_quien, 'el', now(),
           'quitado', jsonb_build_object('asientos', n_asientos, 'recibidas', n_rec, 'emitidas', n_emi, 'cuentas', n_cuentas, 'proveedores', n_prov,
                                         'clientes', n_cli, 'enlaces', n_enlaces, 'aprendido', n_aprendido),
           'quedan', jsonb_build_object('cuentas', q_cuentas, 'proveedores', q_prov, 'clientes', q_cli)))
   where id = p_carga;
  return jsonb_build_object('carga', p_carga, 'asientos', n_asientos, 'recibidas', n_rec, 'emitidas', n_emi, 'cuentas', n_cuentas,
                            'proveedores', n_prov, 'clientes', n_cli, 'quedan', q_cuentas + q_prov + q_cli, 'texto', v_texto);
end $$;
revoke all on function public.conta_traer_deshacer(uuid, text) from public, anon;
grant execute on function public.conta_traer_deshacer(uuid, text) to authenticated, service_role;

create or replace function public.conta_traer_dejar_fuera(p_carga uuid, p_facturas uuid[], p_fuera boolean default true)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_r public.import_run; n1 int; n2 int;
begin
  select * into v_r from public.import_run where id = p_carga;
  if v_r.id is null or v_r.kind <> 'carga' then raise exception 'Esa carga no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_of(v_r.account_id) then
    raise exception 'Solo un administrador de la cuenta decide qué se queda fuera de lo traído.' using errcode = '42501';
  end if;
  if v_r.status <> 'en_prueba' then
    raise exception 'Esta carga ya no está en prueba: lo que trae ya no se deja fuera.' using errcode = '23514';
  end if;
  update public.supplier_invoice set import_mark = case when p_fuera then 'fuera' when journal_entry_id is null then 'sin_casar' end
   where import_run_id = p_carga and source = 'traida' and id = any(p_facturas);
  get diagnostics n1 = row_count;
  update public.customer_invoice set import_mark = case when p_fuera then 'fuera' when entry_id is null then 'sin_casar' end
   where import_run_id = p_carga and origin = 'traida' and id = any(p_facturas);
  get diagnostics n2 = row_count;
  if n1 + n2 = 0 then raise exception 'Esas facturas no son de esta carga.' using errcode = '23514'; end if;
  return jsonb_build_object('facturas', n1 + n2, 'texto', case when p_fuera
    then format('Dejadas fuera %s: siguen en la carga, marcadas «Fuera de esta carga», y no se darán por buenas con ella.', case when n1 + n2 = 1 then '1 factura' else (n1 + n2) || ' facturas' end)
    else format('Vuelven a la carga %s.', case when n1 + n2 = 1 then '1 factura' else (n1 + n2) || ' facturas' end) end);
end $$;
revoke all on function public.conta_traer_dejar_fuera(uuid, uuid[], boolean) from public, anon;
grant execute on function public.conta_traer_dejar_fuera(uuid, uuid[], boolean) to authenticated, service_role;

-- El día de inicio de una empresa, para la pantalla: el de la base, no uno calculado aparte.
create or replace function public.conta_empresa_dia_de_inicio(p_company uuid)
returns date
language plpgsql stable security definer set search_path = public
as $$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.belongs_to_account(v_cuenta) then
    raise exception 'Esa empresa no es tuya.' using errcode = '42501';
  end if;
  return public.conta_dia_de_inicio(p_company);
end $$;
revoke all on function public.conta_empresa_dia_de_inicio(uuid) from public, anon;
grant execute on function public.conta_empresa_dia_de_inicio(uuid) to authenticated, service_role;
