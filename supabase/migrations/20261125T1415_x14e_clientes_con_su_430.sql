-- supabase/migrations/20261125T1415_x14e_clientes_con_su_430.sql
-- cambia: public.conta_traer_cargar · prueba: supabase/staging/sql/20261125_x14e_clientes_con_su_430_prueba.sql
-- cambia: public.conta_traer_deshacer · prueba: supabase/staging/sql/20261125_x14e_clientes_con_su_430_prueba.sql
--
-- X14 · 2 (Julio, 25/11): «cuando el X14 ate cada 430 de ERP10 a su cliente, déjala en conta_cobro_cliente.codigo_cliente,
-- que es lo que leen el G05 y el X33 de K. Un solo sitio.» QBO contabiliza noviembre desde Sumied, y su cobro (G05) usa el
-- código de cada cliente: su subcuenta es 430 + código (43000827 → 827).
--   1. conta_traer_cargar (misma firma; la de antes, guardada): al enlazar cada cliente con su 430, le pone su código en
--      conta_cobro_cliente (crea la fila o rellena la que no tenía código). Lo que ya hay no se pisa: si el cliente ya
--      tiene otro código, o ese código es de otro cliente de la empresa, va a lo que hay que mirar con su porqué. Se
--      cuentan en la carga (n_codigos_cliente).
--   2. conta_traer_deshacer (misma firma; guardada): deshacer la carga quita las filas que creó y deja sin código las que
--      rellenó.
-- Las dos, enteras: las de producción (X14 · 1b y X14 · 2) con los trozos nuevos («X14 · 2 · El código del cliente»).
-- Nada en el camino del pedido. No cambia ninguna fila al aplicarse. El real lo lanza Julio. Vuelta atrás: las dos
-- funciones de sus respaldos.

-- 1 · conta_traer_cargar: el código de cada cliente -----------------------------------------------------------------------
select public._respaldar_funcion('public.conta_traer_cargar(uuid,text,jsonb,text)', '20261125T1415_x14e_clientes_con_su_430');
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
  n_x14_codigos int := 0;   -- X14 · 2 · los códigos de cliente puestos
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
      -- X14 · 2 (Julio, 25/11) · El código del cliente, en UN solo sitio: conta_cobro_cliente.codigo_cliente, que leen el
      -- cobro (G05) y la salida a ERP10. Su 430 de allí es 430 + código (43000827 → 827). Lo que ya hay no se pisa: un
      -- código distinto en su ficha, o el mismo código de otro cliente, va a lo que hay que mirar con su porqué.
      declare v_x14_cod int; v_x14_tiene int; v_x14_otro uuid; v_x14_fila boolean;
      begin
        if v_code ~ '^430[0-9]+$' and length(v_code) <= 12 and substr(v_code, 4)::bigint between 1 and 99999 then
          v_x14_cod := substr(v_code, 4)::int;
          select true, c.codigo_cliente into v_x14_fila, v_x14_tiene from public.conta_cobro_cliente c where c.company_id = p_company and c.party_id = v_party;
          select c.party_id into v_x14_otro from public.conta_cobro_cliente c
           where c.company_id = p_company and c.codigo_cliente = v_x14_cod and c.party_id <> v_party;
          if v_x14_tiene = v_x14_cod then
            null;   -- ya lo tenía
          elsif v_x14_tiene is not null then
            v_mirar := v_mirar || jsonb_build_object('que', 'codigo_cliente', 'cuenta', v_code, 'frase',
              format('%s ya tiene el código de cliente %s en Sumied y en %s es la %s: se queda el de Sumied.', v_nombre, v_x14_tiene, v_nombre_prog, v_code));
          elsif v_x14_otro is not null then
            v_mirar := v_mirar || jsonb_build_object('que', 'codigo_cliente', 'cuenta', v_code, 'frase',
              format('El código de cliente %s (la %s de %s) ya es de otro cliente en Sumied: %s se queda sin código.', v_x14_cod, v_code, v_nombre_prog, v_nombre));
          elsif v_x14_fila then
            update public.conta_cobro_cliente set codigo_cliente = v_x14_cod, updated_at = now(), updated_by_name = v_quien
             where company_id = p_company and party_id = v_party;
            v_deshacer := jsonb_set(v_deshacer, '{codigos_puestos}', coalesce(v_deshacer->'codigos_puestos', '[]') || to_jsonb(v_party));
          else
            insert into public.conta_cobro_cliente (company_id, party_id, account_id, codigo_cliente, updated_by_name)
            values (p_company, v_party, v_cuenta, v_x14_cod, v_quien);
            v_deshacer := jsonb_set(v_deshacer, '{codigos_nuevos}', coalesce(v_deshacer->'codigos_nuevos', '[]') || to_jsonb(v_party));
          end if;
          n_x14_codigos := n_x14_codigos + case when v_x14_tiene is null and v_x14_otro is null then 1 else 0 end;
        end if;
      end;
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
    'n_cuentas', n_cuentas, 'n_cuentas_estaban', n_cuentas_estaban, 'n_prov', n_prov, 'n_cli', n_cli, 'n_enlazados', n_enlazados, 'n_codigos_cliente', n_x14_codigos,
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

-- 2 · conta_traer_deshacer: lo quita al deshacer -------------------------------------------------------------------------
select public._respaldar_funcion('public.conta_traer_deshacer(uuid,text)', '20261125T1415_x14e_clientes_con_su_430');
CREATE OR REPLACE FUNCTION public.conta_traer_deshacer(p_carga uuid, p_quien_nombre text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if v_r.status not in ('en_prueba', 'cargando') then raise exception 'Esta carga no está en prueba: no se deshace.' using errcode = '23514'; end if;   -- X14 · también a medias
  if exists (select 1 from public.journal_entry e where e.import_run_id = p_carga and e.status <> 'borrador') then
    raise exception 'Hay asientos de esta carga que ya no están en borrador: no se deshace nada.' using errcode = '23514';
  end if;
  if exists (select 1 from public.supplier_invoice i where i.import_run_id = p_carga and (i.payment_entry_id is not null or i.paid_at is not null)) then
    raise exception 'Hay facturas traídas de esta carga con un pago apuntado en Sumied: quita ese pago antes de deshacer.' using errcode = '23514', hint = 'con_pago';
  end if;
  v_quien := coalesce(nullif(trim(p_quien_nombre), ''), public.conta_nombre_actor());
  -- X14 · Una carga a medias guarda lo que hay que deshacer en su estado; y su cola se va.
  v_d := case when v_r.status = 'cargando'
              then coalesce(v_r.detail->'estado'->'deshacer', '{}') || jsonb_build_object('corte', v_r.detail->'estado'->'corte', 'fichas', v_r.detail->'estado'->'fichas')
              else coalesce(v_r.detail->'deshacer', '{}') end;
  delete from public.conta_traer_trozo where carga = p_carga;

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

  -- X14 · 1b · Los ejercicios que creó esta carga se van (sus asientos ya no están), y el primero de antes vuelve a no tener anterior.
  if jsonb_typeof(v_d->'ejercicios_nuevos') = 'array' and jsonb_array_length(v_d->'ejercicios_nuevos') > 0 then
    update public.fiscal_year set previous_year_id = null where id = (v_d->>'ejercicio_enganchado')::uuid;
    delete from public.fiscal_period_lock where fiscal_year_id in (select (value #>> '{}')::uuid from jsonb_array_elements(v_d->'ejercicios_nuevos'));
    delete from public.fiscal_year where id in (select (value #>> '{}')::uuid from jsonb_array_elements(v_d->'ejercicios_nuevos'));
  end if;
  update public.supplier set legal_name = null where id in (select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(v_d->'fichas', '[]')));   -- N06b
  delete from public.company_account_link where id in (select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(v_d->'enlaces', '[]')));
  get diagnostics n_enlaces = row_count;
  -- X14 · 2 · Los códigos de cliente que puso la carga: los que creó, fuera; los que rellenó, otra vez sin código.
  delete from public.conta_cobro_cliente where company_id = v_r.company_id
     and party_id in (select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(v_d->'codigos_nuevos', '[]')));
  update public.conta_cobro_cliente set codigo_cliente = null, updated_at = now(), updated_by_name = v_quien where company_id = v_r.company_id
     and party_id in (select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(v_d->'codigos_puestos', '[]')));
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
end $function$

;
