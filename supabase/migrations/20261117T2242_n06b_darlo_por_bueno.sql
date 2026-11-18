-- supabase/migrations/20261117T2242_n06b_darlo_por_bueno.sql
-- cambia: public.conta_traer_cargar · prueba: supabase/staging/sql/20261117_n06b_darlo_por_bueno_prueba.sql
-- cambia: public.conta_traer_deshacer · prueba: supabase/staging/sql/20261117_n06b_darlo_por_bueno_prueba.sql
-- cambia: public.conta_traer_dejar_fuera · prueba: supabase/staging/sql/20261117_n06b_darlo_por_bueno_prueba.sql
--
-- N06b · Darlo por bueno. 4 de 4: TRAER Y DARLO POR BUENO. Va después de la 2241 (la serie 8).
--
-- Cambian, con la misma firma y su respaldo antes (son las del N06a, 1808, enteras con lo de ahora):
--   conta_traer_cargar
--     · lo traído entra en la serie 8, la de lo traído (contestado en el #715); su serie y su número
--       de allí siguen en external_series y external_number («n.º en ERP10»);
--     · una carga solo de cuentas y terceros (sin asientos ni facturas) es una carga entera: no fija el
--       día de inicio ni cierra nada, y dice «He traído 214 cuentas, 96 proveedores y 12 clientes. Lo
--       anterior al 01/10/2026 sigue sin traer.»;
--     · un proveedor que ya estaba con ese NIF se completa: se le enlaza la cuenta de allí y, si no lo
--       tiene, su nombre fiscal; su nombre, su IBAN, su forma de pago y lo demás no se tocan;
--     · las emitidas traídas se guardan con la carga y no existen en Sumied hasta darla por buena: así no
--       cuentan en las emitidas, en Cobros ni en el IVA mientras está en prueba;
--     · guarda el sumas y saldos de allí, para compararlo al darlo por bueno.
--   conta_traer_deshacer: además, quita el nombre fiscal que puso.
--   conta_traer_dejar_fuera: además, las emitidas guardadas con la carga.
-- Añade:
--   _conta_traer_comparar, conta_traer_antes_de_dar_por_bueno (la confirmación) y
--   conta_traer_dar_por_bueno (todo o nada: valida todos sus asientos en la serie 8, del 1 en adelante,
--   por fecha y por su orden de allí; crea sus emitidas; deja el historial como traído; y pone su
--   proveedor a las recibidas que entraron sin él con el mismo NIF).
--
-- No cambia ninguna fila al aplicarse. Nada en el camino del pedido.
--
-- sin hueco: al aplicarse no retira ningún asiento ni resumen del día; solo crea y reemplaza funciones.

select public._respaldar_funcion('public.conta_traer_cargar(uuid,text,jsonb,text)', '20261117T2242_n06b_darlo_por_bueno');
select public._respaldar_funcion('public.conta_traer_deshacer(uuid,text)', '20261117T2242_n06b_darlo_por_bueno');
select public._respaldar_funcion('public.conta_traer_dejar_fuera(uuid,uuid[],boolean)', '20261117T2242_n06b_darlo_por_bueno');

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
  v_emitidas jsonb := '[]'; v_provs jsonb := '[]'; v_fichas jsonb := '[]';   -- N06b
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
  if v_inicio is null and jsonb_array_length(v_asientos) > 0 then   -- N06b · solo cuentas y terceros: no fija nada
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
        'series', 8,   -- N06b · la serie de lo traído: se numera al darlo por bueno (#715)
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
         when v_inicio is null and v_hasta is not null then format(' Sumied empieza a llevar la contabilidad el %s.', to_char(v_hasta + 1, 'DD/MM/YYYY')) else '' end
    || ' Nada está validado: repásalo y dalo por bueno, o deshazlo.';
  -- N06b · Solo cuentas y terceros: lo que se ha traído y que lo de antes sigue sin traer.
  if jsonb_array_length(v_asientos) = 0 and jsonb_array_length(v_facturas) = 0 then
    v_texto := format('He traído %s, %s y %s.', public._conta_traer_cuantos(n_cuentas + n_cuentas_estaban, 'cuenta', 'cuentas'),
                      public._conta_traer_cuantos((select count(*)::int from jsonb_array_elements(coalesce(p_datos->'terceros', '[]')) z where z->>'clase' = 'proveedor'), 'proveedor', 'proveedores'),
                      public._conta_traer_cuantos((select count(*)::int from jsonb_array_elements(coalesce(p_datos->'terceros', '[]')) z where z->>'clase' = 'cliente'), 'cliente', 'clientes'))
      || case when v_inicio is not null then format(' Lo anterior al %s sigue sin traer.', to_char(v_inicio, 'DD/MM/YYYY')) else ' Lo de antes sigue sin traer.' end;
  end if;
  update public.import_run set counts = v_counts,
         detail = jsonb_build_object('mirar', v_mirar, 'aprendido', coalesce(p_datos->'aprendido', '[]'),
                                     'pendientesNoExactos', coalesce(p_datos->'pendientesNoExactos', '[]'), 'inmovilizado', p_datos->'inmovilizado',
                                     'frases', coalesce(p_datos->'frases', '[]'), 'dia_de_inicio', coalesce(v_inicio, v_hasta + 1),
                                     'sumas', p_datos->'sumas', 'emitidas', v_emitidas, 'proveedores', v_provs, 'solo_plan', jsonb_array_length(v_asientos) = 0,
                                     'texto', v_texto,
                                     'deshacer', v_deshacer || jsonb_build_object('corte', v_corte, 'fichas', v_fichas))
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
    raise exception 'Esta carga ya está dada por buena: no se deshace. Si ves un error en lo traído, corrígelo con un asiento a mano.' using errcode = '23514', hint = 'dada_por_buena';
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

  update public.supplier set legal_name = null where id in (select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(v_d->'fichas', '[]')));   -- N06b
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
declare v_r public.import_run; n1 int; n2 int; n3 int;
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
  -- N06b · las emitidas, guardadas con la carga hasta darla por buena.
  select count(*) into n3 from jsonb_array_elements(coalesce(v_r.detail->'emitidas', '[]')) e where (e->>'id')::uuid = any(p_facturas);
  if n3 > 0 then
    update public.import_run set detail = jsonb_set(detail, '{emitidas}', (
      select jsonb_agg(case when (e->>'id')::uuid = any(p_facturas)
                            then e || jsonb_build_object('marca', case when p_fuera then 'fuera' when e->>'asiento' is null then 'sin_casar' end) else e end)
        from jsonb_array_elements(detail->'emitidas') e))
     where id = p_carga;
  end if;
  n2 := n2 + n3;
  if n1 + n2 = 0 then raise exception 'Esas facturas no son de esta carga.' using errcode = '23514'; end if;
  return jsonb_build_object('facturas', n1 + n2, 'texto', case when p_fuera
    then format('Dejadas fuera %s: siguen en la carga, marcadas «Fuera de esta carga», y no se darán por buenas con ella.', case when n1 + n2 = 1 then '1 factura' else (n1 + n2) || ' facturas' end)
    else format('Vuelven a la carga %s.', case when n1 + n2 = 1 then '1 factura' else (n1 + n2) || ' facturas' end) end);
end $$;
revoke all on function public.conta_traer_dejar_fuera(uuid, uuid[], boolean) from public, anon;
grant execute on function public.conta_traer_dejar_fuera(uuid, uuid[], boolean) to authenticated, service_role;


-- ── N06b · Darlo por bueno ─────────────────────────────────────────────────────────────────────────

-- Lo traído (los apuntes de la carga, por subcuenta) contra el sumas y saldos de allí, si se trajo.
-- Devuelve {comparado, diferencias: [{cuenta, nombre, alli_debe, alli_haber, traido_debe, traido_haber}]},
-- en euros. Una cuenta difiere si su debe o su haber no son los de allí (al céntimo).
create or replace function public._conta_traer_comparar(p_carga uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with r as (select * from public.import_run where id = p_carga),
  alli as (
    select s->>'cuenta' cuenta, max(s->>'nombre') nombre, sum((s->>'debe')::numeric) / 100 debe, sum((s->>'haber')::numeric) / 100 haber
      from r, jsonb_array_elements(coalesce(r.detail->'sumas', '[]')) s group by 1),
  traido as (
    select a.code cuenta, max(a.name) nombre, sum(l.debit) debe, sum(l.credit) haber
      from public.journal_entry e join public.journal_line l on l.entry_id = e.id join public.company_account a on a.id = l.company_account_id
     where e.import_run_id = p_carga and e.source_type = 'migrated' group by 1),
  todo as (
    select coalesce(t.cuenta, x.cuenta) cuenta, coalesce(x.nombre, t.nombre) nombre,
           coalesce(x.debe, 0) alli_debe, coalesce(x.haber, 0) alli_haber, coalesce(t.debe, 0) traido_debe, coalesce(t.haber, 0) traido_haber
      from traido t full join alli x on x.cuenta = t.cuenta)
  select jsonb_build_object(
    'comparado', jsonb_array_length(coalesce((select detail->'sumas' from r), '[]')) > 0,
    'diferencias', coalesce((select jsonb_agg(jsonb_build_object('cuenta', cuenta, 'nombre', nombre, 'alli_debe', alli_debe, 'alli_haber', alli_haber,
                                                                 'traido_debe', traido_debe, 'traido_haber', traido_haber) order by cuenta)
                               from todo where jsonb_array_length(coalesce((select detail->'sumas' from r), '[]')) > 0
                                and (round(alli_debe, 2) <> round(traido_debe, 2) or round(alli_haber, 2) <> round(traido_haber, 2))), '[]'))
$$;
revoke all on function public._conta_traer_comparar(uuid) from public, anon, authenticated;
grant execute on function public._conta_traer_comparar(uuid) to service_role;

-- Lo que se dice ANTES de darlo por bueno (la confirmación de la pantalla, N07): qué se va a dar por
-- bueno, si cuadra con el sumas y saldos (y si no, las cuentas), y que después ya no se deshace.
create or replace function public.conta_traer_antes_de_dar_por_bueno(p_carga uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_r public.import_run; v_c jsonb; n_a int; n_f int; v_prog text; v_texto text; v_puede boolean := true;
begin
  select * into v_r from public.import_run where id = p_carga;
  if v_r.id is null or v_r.kind <> 'carga' or not public.belongs_to_account(v_r.account_id) then
    raise exception 'Esa carga no existe.' using errcode = 'P0002';
  end if;
  v_prog := case v_r.program when 'erp10' then 'ERP10' when 'diez' then 'Diez' else 'el programa de antes' end;
  if v_r.status <> 'en_prueba' then
    return jsonb_build_object('puede', false, 'texto', case v_r.status when 'dada_por_buena' then 'Esta carga ya está dada por buena.'
                                                                       when 'deshecha' then 'Esta carga está deshecha: no hay nada que dar por bueno.'
                                                                       else 'Esta carga no está en prueba.' end);
  end if;
  select count(*) into n_a from public.journal_entry where import_run_id = p_carga and source_type = 'migrated';
  n_f := (select count(*) from public.supplier_invoice where import_run_id = p_carga and source = 'traida' and import_mark is distinct from 'fuera')
       + (select count(*) from jsonb_array_elements(coalesce(v_r.detail->'emitidas', '[]')) e where e->>'marca' is distinct from 'fuera');
  v_c := public._conta_traer_comparar(p_carga);
  if n_a = 0 and n_f = 0 then
    v_texto := format('Vas a dar por bueno lo traído de %s: %s. Después ya no se podrá deshacer.', v_prog, coalesce(nullif(regexp_replace(
                 coalesce(v_r.detail->>'texto', ''), '^He traído (.*)\. Lo .*$', '\1'), coalesce(v_r.detail->>'texto', '')), 'las cuentas y los terceros'));
  elsif jsonb_array_length(v_c->'diferencias') > 0 then
    v_puede := false;
    v_texto := format('No cuadra con el sumas y saldos de %s en %s. Míralas antes de darlo por bueno.', v_prog,
                      public._conta_traer_cuantos(jsonb_array_length(v_c->'diferencias'), 'cuenta', 'cuentas'));
  else
    v_texto := format('Vas a dar por bueno lo traído de %s: %s y %s, hasta el %s. %s Después ya no se podrá deshacer.', v_prog,
                      public._conta_traer_cuantos(n_a, 'asiento', 'asientos'), public._conta_traer_cuantos(n_f, 'factura', 'facturas'),
                      to_char(v_r.period_to, 'DD/MM/YYYY'),
                      case when (v_c->>'comparado')::boolean then 'Cuadra con el sumas y saldos.'
                           else 'No se ha podido comparar con el sumas y saldos, porque no se trajo.' end);
  end if;
  return jsonb_build_object('puede', v_puede, 'texto', v_texto, 'comparado', (v_c->>'comparado')::boolean, 'diferencias', v_c->'diferencias',
                            'asientos', n_a, 'facturas', n_f,
                            'si_hay_un_error', 'Si después ves un error en lo traído, corrígelo con un asiento a mano: lo traído ya no se deshace ni se anula.');
end $$;
revoke all on function public.conta_traer_antes_de_dar_por_bueno(uuid) from public, anon;
grant execute on function public.conta_traer_antes_de_dar_por_bueno(uuid) to authenticated, service_role;

-- Darlo por bueno: TODO O NADA, en una transacción. Valida todos los asientos de la carga en la serie de
-- lo traído, del 1 en adelante, por fecha y por su orden de allí; crea las emitidas que se guardaron con
-- ella; deja el historial como traído; y pone su proveedor a las recibidas que entraron sin él y tienen el
-- NIF de uno de los de la carga. Si un asiento no se puede validar, no se da por bueno nada y se dice cuál.
create or replace function public.conta_traer_dar_por_bueno(p_carga uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_r public.import_run; v_quien text; v_c jsonb; e record; v_msg text; v_prog text; v_inicio date;
  n_a int := 0; n_emi int := 0; n_pagos int; n_cobros int; n_sin int := 0; v_num_desde int; v_num_hasta int;
  x jsonb; v_s record; v_i record; v_texto text; v_vale boolean;
begin
  select * into v_r from public.import_run where id = p_carga;
  if v_r.id is null or v_r.kind <> 'carga' then raise exception 'Esa carga no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_of(v_r.account_id) then
    raise exception 'Solo un administrador de la cuenta da por bueno lo traído.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('conta_traer:' || v_r.company_id::text, 0));
  select * into v_r from public.import_run where id = p_carga for update;
  if v_r.status = 'dada_por_buena' then raise exception 'Esta carga ya está dada por buena.' using errcode = '23514', hint = 'dada_por_buena'; end if;
  if v_r.status <> 'en_prueba' then raise exception 'Esta carga no está en prueba: no se da por buena.' using errcode = '23514'; end if;
  v_quien := coalesce(nullif(trim(p_quien_nombre), ''), public.conta_nombre_actor());
  v_prog := case v_r.program when 'erp10' then 'ERP10' when 'diez' then 'Diez' else 'el programa de antes' end;

  -- Antes, el sumas y saldos: con diferencias, no.
  v_c := public._conta_traer_comparar(p_carga);
  if jsonb_array_length(v_c->'diferencias') > 0 then
    raise exception 'No cuadra con el sumas y saldos de % en %. Míralas antes de darlo por bueno.', v_prog,
      public._conta_traer_cuantos(jsonb_array_length(v_c->'diferencias'), 'cuenta', 'cuentas') using errcode = '23514', hint = 'no_cuadra';
  end if;

  -- La carga deja de estar en prueba (sus asientos ya se pueden validar), y se validan todos, en orden.
  update public.import_run set status = 'dada_por_buena' where id = p_carga;
  for e in select j.id, j.entry_date, j.external_series, j.external_number from public.journal_entry j
            where j.import_run_id = p_carga and j.source_type = 'migrated' and j.status = 'borrador'
            order by j.entry_date, j.external_series, nullif(regexp_replace(j.external_number, '[^0-9]', '', 'g'), '')::bigint, j.external_number, j.id loop
    begin
      x := public._journal_entry_validar(e.id, v_quien);
    exception when others then
      get stacked diagnostics v_msg = message_text;
      raise exception 'No se ha dado por bueno nada: el asiento n.º % en % (serie %), del %, no se puede validar. %', e.external_number, v_prog,
        e.external_series, to_char(e.entry_date, 'DD/MM/YYYY'), v_msg using errcode = '23514', hint = 'asiento';
    end;
    n_a := n_a + 1;
    v_num_desde := coalesce(v_num_desde, (x->>'numero')::int); v_num_hasta := (x->>'numero')::int;
  end loop;

  -- Las emitidas, guardadas con la carga: ahora sí existen (las dejadas fuera, no).
  for x in select * from jsonb_array_elements(coalesce(v_r.detail->'emitidas', '[]')) loop
    continue when x->>'marca' is not distinct from 'fuera';
    if exists (select 1 from public.customer_invoice c where c.company_id = v_r.company_id and c.series_code = x->>'serie'
                 and c.fiscal_year = (x->>'ejercicio')::int and c.number = (x->>'numero')::int) then
      raise exception 'No se ha dado por bueno nada: ya hay en Sumied una factura emitida %-% del %.', x->>'serie', x->>'numero', x->>'ejercicio'
        using errcode = '23514', hint = 'emitida';
    end if;
    insert into public.customer_invoice (id, account_id, company_id, status, doc_type, origin, series_code, fiscal_year, number, number_text, issue_date,
                                         party_id, customer, base, tax, withholding_amount, total, entry_id, created_by, created_by_name,
                                         issued_at, issued_by_name, import_run_id, import_mark, import_pending)
    values ((x->>'id')::uuid, v_r.account_id, v_r.company_id, 'emitida', 'factura', 'traida', x->>'serie', (x->>'ejercicio')::int, (x->>'numero')::int,
            x->>'numero_texto', (x->>'fecha')::date, nullif(x->>'party_id', '')::uuid, x->'cliente', (x->>'base')::numeric, (x->>'cuota')::numeric,
            (x->>'retencion')::numeric, (x->>'total')::numeric, nullif(x->>'asiento', '')::uuid, auth.uid(), v_prog || ' (traída)', now(),
            v_prog || ' (traída)', p_carga, x->>'marca', (x->>'pendiente')::numeric);
    n_emi := n_emi + 1;
  end loop;

  -- El historial, como traído (si la carga traía asientos). La decisión de trabajar sin lo anterior se
  -- queda escrita, pero ya no hace falta: lo anterior está traído.
  if n_a > 0 then
    update public.fiscal_year set history_imported_at = now()
     where company_id = v_r.company_id and origin in ('mixed', 'migrated') and history_imported_at is null and starts_on <= v_r.period_to;
  end if;

  -- Las recibidas que entraron sin proveedor y tienen el NIF de uno de la carga: lo encuentran.
  for v_s in select s.id, s.name, public._conta_nif_clave(s.tax_id) nif from public.supplier s
              where s.account_id = v_r.account_id and s.archived_at is null and public._conta_nif_clave(s.tax_id) is not null
                and (s.import_run_id = p_carga or s.id in (select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(v_r.detail->'proveedores', '[]')))) loop
    for v_i in select i.id, i.inbox_id, i.company_id from public.supplier_invoice i
                where i.account_id = v_r.account_id and i.supplier_id is null and i.status not in ('anulada', 'descartada')
                  and (i.company_id = v_r.company_id or i.company_id is null)
                  and public._conta_nif_clave(coalesce(i.reading->'factura'->'proveedor'->>'nif', i.issuer_tax_id)) = v_s.nif loop
      v_vale := true;
      begin
        update public.supplier_invoice set supplier_id = v_s.id where id = v_i.id;
      exception when others then v_vale := false;   -- p. ej. resulta repetida: se queda como estaba, sin proveedor
      end;
      continue when not v_vale;
      insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, actor_name, action, text)
      values (v_r.account_id, coalesce(v_i.company_id, v_r.company_id), v_i.inbox_id, v_i.id, 'folvy', null, 'corregida',
              format('Sumied le ha puesto su proveedor, %s, al dar por bueno lo traído de %s: tienen el mismo NIF.', v_s.name, v_prog));
      n_sin := n_sin + 1;
    end loop;
  end loop;

  select count(*) into n_pagos from public.supplier_invoice
   where import_run_id = p_carga and source = 'traida' and status = 'aprobada' and import_mark is distinct from 'fuera';
  select count(*) into n_cobros from public.conta_factura_cobro c join public.customer_invoice ci on ci.id = c.invoice_id
   where ci.import_run_id = p_carga and ci.origin = 'traida' and c.pendiente >= 0.005;
  v_inicio := public.conta_dia_de_inicio(v_r.company_id);
  if n_a = 0 and n_emi = 0 and not exists (select 1 from public.supplier_invoice where import_run_id = p_carga) then
    v_texto := format('Hecho. Lo traído de %s ya es parte de tu contabilidad: %s.', v_prog,
                      coalesce(nullif(regexp_replace(coalesce(v_r.detail->>'texto', ''), '^He traído (.*)\. Lo .*$', '\1'), coalesce(v_r.detail->>'texto', '')), 'las cuentas y los terceros'));
  else
    v_texto := format('Hecho. %s de antes del %s ya %s en tu contabilidad', public._conta_traer_cuantos(n_a, 'asiento', 'asientos'),
                      to_char(coalesce(v_inicio, v_r.period_to + 1), 'DD/MM/YYYY'), case when n_a = 1 then 'está' else 'están' end)
      || case when n_pagos + n_cobros = 0 then '.'
              when n_cobros = 0 then format(', y %s %s a Pagos.', public._conta_traer_cuantos(n_pagos, 'factura pendiente', 'facturas pendientes'), case when n_pagos = 1 then 'ha pasado' else 'han pasado' end)
              when n_pagos = 0 then format(', y %s %s a Cobros.', public._conta_traer_cuantos(n_cobros, 'factura pendiente', 'facturas pendientes'), case when n_cobros = 1 then 'ha pasado' else 'han pasado' end)
              else format(', y %s han pasado: %s a Pagos y %s a Cobros.', public._conta_traer_cuantos(n_pagos + n_cobros, 'factura pendiente', 'facturas pendientes'), n_pagos, n_cobros) end;
  end if;
  if n_sin > 0 then
    v_texto := v_texto || format(' %s que %s entrado sin proveedor ya %s.', public._conta_traer_cuantos(n_sin, 'factura', 'facturas'),
                                 case when n_sin = 1 then 'había' else 'habían' end, case when n_sin = 1 then 'lo tiene' else 'lo tienen' end);
  end if;
  update public.import_run set detail = coalesce(detail, '{}') || jsonb_build_object('dada', jsonb_build_object('por', v_quien, 'el', now(),
           'asientos', n_a, 'numeros', case when n_a > 0 then jsonb_build_object('serie', 8, 'desde', v_num_desde, 'hasta', v_num_hasta) end,
           'emitidas', n_emi, 'pagos', n_pagos, 'cobros', n_cobros, 'con_proveedor', n_sin, 'texto', v_texto))
   where id = p_carga;
  return jsonb_build_object('carga', p_carga, 'asientos', n_a, 'emitidas', n_emi, 'pagos', n_pagos, 'cobros', n_cobros, 'con_proveedor', n_sin,
                            'numeros', case when n_a > 0 then jsonb_build_object('desde', v_num_desde, 'hasta', v_num_hasta) end, 'texto', v_texto);
end $$;
revoke all on function public.conta_traer_dar_por_bueno(uuid, text) from public, anon;
grant execute on function public.conta_traer_dar_por_bueno(uuid, text) to authenticated, service_role;
