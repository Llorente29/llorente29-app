-- supabase/migrations/20261125T1610_q10_emitir_cuotas.sql
--
-- Q10 · «Emitir las de noviembre»: las facturas de las cuotas que GoCardless YA COBRÓ, una por cobro, emitidas en
-- Sumied con la serie de Cegid y atadas a su cobro (Julio, 25/11). SOLO AÑADE una función; no toca ninguna fila al
-- aplicarse.
--
-- conta_cuotas_emitir(p_company, p_mes, p_desde, p_ultimo_erp10, p_facturas) emite, en una transacción, un trozo de
-- las facturas que la pantalla tiene preparadas, EN SU ORDEN (la pantalla las manda de diez en diez: cada trozo entero
-- o nada, y el siguiente sigue donde acabó; así nunca queda un hueco en la serie):
--   · p_facturas: [{gc_id, retencion_pct, cuenta_cliente}], en el orden de numerar. Lo demás NO lo da la pantalla: el
--     cliente, la línea y los importes salen de la base (el cobro, su suscripción y su enlace atado);
--   · cada cobro, cobrado (confirmed o paid_out), del mes, de la empresa, con su cliente atado a una ficha con NIF, y
--     sin factura todavía (conta_gc_cobro_factura, la tabla del #816 de K: un cobro, una factura);
--   · la línea es la suscripción, como en GoCardless; las notas, «Cuota de noviembre de 2026 · cobrada el dd/mm/aaaa»;
--   · la base, la que con el IVA del 21 % y la retención redondeados da EXACTAMENTE el cobro. Si ninguna, PARA;
--   · la fecha, la de HOY en Madrid (el día en que se emiten: nunca futura), la misma para todo el trozo;
--   · la serie «1» con el formato de Cegid («2026/1/2745»). La primera vez se crea empezando en p_desde. Siempre:
--     la siguiente de Sumied tiene que ser p_desde, y la última de ERP10 (p_ultimo_erp10, que la pantalla acaba de
--     leer) no puede ir por delante de lo que ha emitido Sumied. Si no, PARA: dos facturas con el mismo número no;
--   · la 430 del cliente: la suya en Sumied; si no tiene, la de ERP10 (cuenta_cliente, de su última factura allí),
--     que se da de alta en el plan y se le ata. Sin ninguna de las dos, o si esa 430 es de otro cliente, PARA;
--   · emite con conta_venta_guardar y conta_venta_emitir (las de siempre: su asiento 430/705/477 y la 473 de la
--     retención) y ata la factura a su cobro en conta_gc_cobro_factura.
-- No la cobra: el cobro (57200002/430) lo asienta «Preparar» los asientos de GoCardless (#816), que mira esa tabla.
-- No envía nada al cliente: el envío va en el PR siguiente.
--
-- Solo un administrador o un encargado de la cuenta (lo miran también conta_venta_guardar y conta_venta_emitir).
-- La emisión de verdad la lanza Julio, por empresa, desde la pantalla. Vuelta atrás:
-- supabase/vuelta-atras/20261125T1610_q10_emitir_cuotas.down.sql (quita la función; lo emitido no se des-emite: se
-- corrige con una rectificativa, como cualquier factura).

create or replace function public.conta_cuotas_emitir(p_company uuid, p_mes text, p_desde int, p_ultimo_erp10 text, p_facturas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid; v_hoy date := (now() at time zone 'Europe/Madrid')::date; v_anio int; v_m text[]; v_ult_erp int; v_ult_sumied int;
  v_x jsonb; v_c public.conta_gc_cobro; v_sus text; v_gcc text; v_party uuid; v_nif text; v_nombre text; v_total int; v_ret numeric;
  v_base int; v_iva int; v_retc int; v_ok boolean; v_k int; v_tipo uuid; v_705 uuid; v_wh uuid; v_430 text; v_cta text; v_otro text; v_d int;
  v_g jsonb; v_id uuid; v_numero text; v_emitidas jsonb := '[]'::jsonb; v_suma numeric := 0; v_quien text := public.conta_nombre_actor();
  v_mes_nombre text; v_ultima_fecha date;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'Solo un administrador o un encargado de la cuenta emite facturas.' using errcode = '42501';
  end if;
  if to_regclass('public.conta_gc_cobro_factura') is null then
    raise exception 'Aún no está la tabla que ata cada factura a su cobro (conta_gc_cobro_factura, del #816): no se emite ninguna.' using errcode = '55000';
  end if;
  if p_mes !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'El mes «%» no vale (AAAA-MM).', p_mes using errcode = '22023'; end if;
  if jsonb_typeof(p_facturas) <> 'array' or jsonb_array_length(p_facturas) = 0 then raise exception 'No hay facturas que emitir.' using errcode = '22023'; end if;
  if jsonb_array_length(p_facturas) > 25 then raise exception 'Como mucho 25 facturas de una vez (se mandan por trozos).' using errcode = '22023'; end if;
  v_mes_nombre := (array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'])[substr(p_mes, 6, 2)::int]
                  || ' de ' || left(p_mes, 4);

  -- La serie: una emisión a la vez por empresa; la última de ERP10 y la de Sumied.
  perform pg_advisory_xact_lock(hashtext('conta_cuotas_emitir:' || p_company::text));
  v_anio := extract(year from v_hoy)::int;
  v_m := regexp_match(coalesce(p_ultimo_erp10, ''), '^\s*(\d{4})\s*/\s*1\s*/\s*0*(\d+)\s*$');
  if v_m is null or v_m[1]::int <> v_anio then
    raise exception 'No se sabe cuál es la última factura de la serie %/1 en ERP10 («%»): léela antes de emitir.', v_anio, coalesce(p_ultimo_erp10, '') using errcode = '23514';
  end if;
  v_ult_erp := v_m[2]::int;
  select last_number into v_ult_sumied from public.customer_invoice_counter where company_id = p_company and series_code = '1' and fiscal_year = v_anio;
  if v_ult_sumied is null then
    if p_desde <> v_ult_erp + 1 then
      raise exception 'La última factura en ERP10 es la %/1/% y la primera de Sumied sería la %/1/%: tienen que ir seguidas. No se emite.', v_anio, v_ult_erp, v_anio, p_desde using errcode = '23514';
    end if;
  else
    if v_ult_erp > v_ult_sumied then
      raise exception 'En ERP10 ya está la %/1/% y Sumied iba por la %/1/%: alguien ha numerado en ERP10. No se emite hasta que cuadre.', v_anio, v_ult_erp, v_anio, v_ult_sumied using errcode = '23514';
    end if;
    if p_desde <> v_ult_sumied + 1 then
      raise exception 'La siguiente de la serie es la %/1/% y la pantalla esperaba la %/1/%: vuelve a leer y a preparar.', v_anio, v_ult_sumied + 1, v_anio, p_desde using errcode = '23514';
    end if;
  end if;
  select max(issue_date) into v_ultima_fecha from public.customer_invoice where company_id = p_company and series_code = '1' and status <> 'borrador';
  if v_ultima_fecha > v_hoy then
    raise exception 'La última factura de la serie es del % y hoy es %: no se emite con fecha anterior.', to_char(v_ultima_fecha, 'DD/MM/YYYY'), to_char(v_hoy, 'DD/MM/YYYY') using errcode = '23514';
  end if;
  if not exists (select 1 from public.invoice_series where company_id = p_company and code = '1') then
    insert into public.invoice_series (account_id, company_id, code, name, doc_type, digits, reset_yearly, starts_at, is_default, is_active, formato)
    values (v_cuenta, p_company, '1', 'Facturas (la serie de Cegid)', 'invoice', 1, true, p_desde, false, true, '{año}/{serie}/{número}');
  elsif not exists (select 1 from public.invoice_series where company_id = p_company and code = '1' and is_active and formato = '{año}/{serie}/{número}') then
    raise exception 'La serie «1» de la empresa no tiene el formato de Cegid ({año}/{serie}/{número}) o no está activa: no se emite.' using errcode = '23514';
  end if;

  -- Las cuentas de siempre: la 705 y la 477 del IVA general al 21 %.
  v_705 := public._conta_cobro_cuenta(p_company, '70500000', 'Prestaciones de servicios', v_quien);
  select id into v_tipo from public.tax_rate where is_system and code = 'iva_general' and rate = 21 limit 1;
  if v_tipo is null then raise exception 'No encuentro el IVA general al 21 %%.' using errcode = '23514'; end if;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (v_cuenta, p_company, public._conta_cobro_cuenta(p_company, '47700021', 'IVA repercutido 21 %', v_quien), 'tax_rate', v_tipo::text, 'repercutido', 'manual')
  on conflict (company_id, entity, entity_id, role) do nothing;
  select length(code) into v_d from public.company_account where company_id = p_company limit 1;

  v_k := 0;
  for v_x in select * from jsonb_array_elements(p_facturas) loop
    v_k := v_k + 1;
    -- El cobro, cobrado y del mes, sin factura.
    select * into v_c from public.conta_gc_cobro where company_id = p_company and gc_id = v_x->>'gc_id';
    if v_c.gc_id is null then raise exception 'La % · el cobro % no es de esta empresa.', v_k, v_x->>'gc_id' using errcode = '22023'; end if;
    if v_c.estado not in ('confirmed', 'paid_out') then raise exception 'La % · el cobro % no está cobrado («%»): no lleva factura.', v_k, v_c.gc_id, v_c.estado using errcode = '23514'; end if;
    if to_char(v_c.fecha, 'YYYY-MM') <> p_mes then raise exception 'La % · el cobro % es del %, no de %.', v_k, v_c.gc_id, to_char(v_c.fecha, 'DD/MM/YYYY'), v_mes_nombre using errcode = '23514'; end if;
    if exists (select 1 from public.conta_gc_cobro_factura where company_id = p_company and gc_id = v_c.gc_id) then
      raise exception 'La % · el cobro % ya tiene su factura: un cobro, una factura.', v_k, v_c.gc_id using errcode = '23505';
    end if;
    -- Su suscripción (la línea) y su cliente atado, con NIF.
    select s.nombre, s.gc_cliente_id into v_sus, v_gcc from public.conta_gc_suscripcion s where s.company_id = p_company and s.gc_id = v_c.suscripcion_gc_id;
    if nullif(btrim(v_sus), '') is null then raise exception 'La % · el cobro % no tiene suscripción: no se sabe qué servicio es.', v_k, v_c.gc_id using errcode = '23514'; end if;
    select e.party_id into v_party from public.conta_gc_enlace e where e.company_id = p_company and e.gc_cliente_id = v_gcc and e.estado = 'atado';
    if v_party is null then raise exception 'La % · el cobro % no tiene su cliente atado a una ficha.', v_k, v_c.gc_id using errcode = '23514'; end if;
    select nullif(btrim(p.tax_id), ''), p.name into v_nif, v_nombre from public.party p where p.id = v_party and p.account_id = v_cuenta;
    if v_nif is null then raise exception 'La % · % no tiene NIF.', v_k, coalesce(v_nombre, 'el cliente') using errcode = '23514'; end if;

    -- La base que da EXACTAMENTE el cobro.
    v_total := round(v_c.importe * 100)::int;
    v_ret := coalesce((v_x->>'retencion_pct')::numeric, 0);
    if v_ret not in (0, 7, 15) then raise exception 'La % · una retención del % %% no se emite aquí (0, 7 o 15).', v_k, v_ret using errcode = '22023'; end if;
    v_ok := false;
    foreach v_base in array array[round(v_total / (1 + 0.21 - v_ret / 100))::int, round(v_total / (1 + 0.21 - v_ret / 100))::int - 1, round(v_total / (1 + 0.21 - v_ret / 100))::int + 1] loop
      v_iva := round(v_base * 21 / 100.0)::int; v_retc := round(v_base * v_ret / 100.0)::int;
      if v_base > 0 and v_base + v_iva - v_retc = v_total then v_ok := true; exit; end if;
    end loop;
    if not v_ok then raise exception 'La % · con el IVA y la retención, ninguna base da % € (el cobro %).', v_k, v_c.importe, v_c.gc_id using errcode = '23514'; end if;
    v_wh := null;
    if v_ret > 0 then
      select id into v_wh from public.withholding_rate where is_system and code like 'profesional%' and rate = v_ret limit 1;
      if v_wh is null then raise exception 'No encuentro la retención profesional del % %%.', v_ret using errcode = '23514'; end if;
    end if;

    -- La 430: la suya, o la de ERP10 (de su última factura), dada de alta y atada.
    select a.code into v_430 from public.company_account_link k join public.company_account a on a.id = k.company_account_id
     where k.company_id = p_company and k.entity = 'customer' and k.entity_id = v_party::text and k.role = 'principal' limit 1;
    if v_430 is null then
      v_cta := regexp_replace(coalesce(v_x->>'cuenta_cliente', ''), '\D', '', 'g');
      if v_cta = '' then raise exception 'La % · % no tiene subcuenta de cliente en Sumied ni en ERP10.', v_k, v_nombre using errcode = '23514'; end if;
      if v_cta !~ '^430' or length(v_cta) <> coalesce(v_d, 8) then
        raise exception 'La % · la subcuenta de ERP10 de % (%) no es una 430 de % cifras.', v_k, v_nombre, v_cta, coalesce(v_d, 8) using errcode = '23514';
      end if;
      select k.entity_id into v_otro from public.company_account_link k join public.company_account a on a.id = k.company_account_id
       where k.company_id = p_company and a.code = v_cta and k.entity = 'customer' and k.role = 'principal' and k.entity_id <> v_party::text limit 1;
      if v_otro is not null then raise exception 'La % · la subcuenta % (la de % en ERP10) ya es de otro cliente en Sumied.', v_k, v_cta, v_nombre using errcode = '23514'; end if;
      insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
      values (v_cuenta, p_company, public._conta_cobro_cuenta(p_company, v_cta, coalesce(v_nombre, 'Cliente'), v_quien), 'customer', v_party::text, 'principal', 'manual');
    end if;

    -- La factura, emitida con las de siempre, y atada a su cobro.
    v_g := public.conta_venta_guardar(p_company, null, jsonb_build_object('cliente_id', v_party, 'fecha', v_hoy, 'serie', '1', 'retencion_id', v_wh,
             'notas', format('Cuota de %s · cobrada el %s', v_mes_nombre, to_char(v_c.fecha, 'DD/MM/YYYY'))),
           jsonb_build_array(jsonb_build_object('concepto', regexp_replace(btrim(v_sus), '\s+', ' ', 'g'), 'cantidad', 1, 'precio', v_base / 100.0, 'descuento', 0,
             'tipo_id', v_tipo, 'cuenta_id', v_705)), v_quien);
    v_id := (v_g->>'id')::uuid;
    if round((v_g->>'total')::numeric * 100) <> v_total then
      raise exception 'La % · la factura saldría por % € y el cobro fue de % €: no se emite.', v_k, v_g->>'total', v_c.importe using errcode = '23514';
    end if;
    perform public.conta_venta_emitir(v_id, v_quien);
    select number_text into v_numero from public.customer_invoice where id = v_id;
    if v_numero is distinct from public._conta_numero_con_formato('{año}/{serie}/{número}', v_anio, '1', p_desde + v_k - 1) then
      raise exception 'La % · ha salido la % y tocaba la %/1/%: no se emite el trozo.', v_k, v_numero, v_anio, p_desde + v_k - 1 using errcode = '23514';
    end if;
    insert into public.conta_gc_cobro_factura (company_id, account_id, gc_id, invoice_id) values (p_company, v_cuenta, v_c.gc_id, v_id);
    v_emitidas := v_emitidas || jsonb_build_array(jsonb_build_object('gc_id', v_c.gc_id, 'factura', v_id, 'numero', v_numero, 'total', v_total / 100.0));
    v_suma := v_suma + v_total / 100.0;
  end loop;

  return jsonb_build_object(
    'emitidas', v_emitidas, 'siguiente', p_desde + v_k, 'fecha', v_hoy,
    'frase', format('Emitidas %s %s de %s, del %s: de la %s a la %s, %s €.', v_k, case when v_k = 1 then 'factura' else 'facturas' end, v_mes_nombre,
      to_char(v_hoy, 'DD/MM/YYYY'), v_emitidas->0->>'numero', v_emitidas->(v_k - 1)->>'numero', replace(to_char(v_suma, 'FM999999990.00'), '.', ',')));
end $$;

comment on function public.conta_cuotas_emitir(uuid, text, int, text, jsonb) is
  'Q10 · Emite un trozo (hasta 25) de las facturas de las cuotas ya cobradas por GoCardless de un mes, en su orden, con la serie de Cegid y la fecha de hoy, y ata cada una a su cobro (conta_gc_cobro_factura). Todo el trozo o nada.';
revoke all on function public.conta_cuotas_emitir(uuid, text, int, text, jsonb) from public, anon;
grant execute on function public.conta_cuotas_emitir(uuid, text, int, text, jsonb) to authenticated;
