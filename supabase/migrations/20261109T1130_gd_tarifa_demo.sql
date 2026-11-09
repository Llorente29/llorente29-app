-- supabase/migrations/20261109T1130_gd_tarifa_demo.sql
--
-- GD · La tarifa de «Gestoría Demo» (Julio, nº27 y nº34): lo que no viene del
-- Bitrix24 de pruebas ni del sandbox se siembra en Sumied.
--
--   demo_gestoria_tarifa_sembrar(cuenta): SOLO para cuentas de demostración
--   (accounts.is_demo) y SOLO la llama la plataforma. Va por los caminos de la
--   app, como el administrador de la cuenta (las funciones del G04 de «Tarifa y
--   paquetes»), y se puede repetir: primero quita lo que sembró la vez
--   anterior (los niveles, precios, paquetes y servicios de la tarifa, y las
--   líneas que no vienen de GoCardless) y lo vuelve a poner igual. No toca las
--   líneas que vienen de GoCardless salvo para ponerles su nivel.
--
--   En la empresa que cobra con GoCardless (Gestoría Demo, S.L.):
--     · Gestoría mensual con tres niveles: Básica 90 €, Estándar 120 € (el más
--       elegido) y Premium 150 €; cada cliente, en el nivel de lo que le cobra
--       GoCardless.
--     · Dos precios especiales: Frutas Hermanos Ortega y Óptica Mirada Clara,
--       en Premium a 120 € (lo que les cobra GoCardless, así no hay diferencia).
--     · Gestión laboral: 25 € por trabajador (los trabajadores, con su nombre,
--       vienen de las suscripciones de GoCardless).
--     · Impuesto de sociedades: 300 € al año. Si la importación dejó un servicio
--       por cliente («IMPUESTO DE SOCIEDADES <cliente>», la primera siembra del
--       sandbox), se juntan en uno.
--     · Nóminas, por tramos: de 1 a 5, 15 € cada una; de 6 a 20, 12 €; de 21 en
--       adelante, 10 €.
--     · El paquete «Pack Empresa»: Gestoría mensual Estándar y la laboral de
--       hasta 3 trabajadores, 180 € al mes; cada trabajador de más, 20 €.
--   En la del autónomo (Elena Campos Ortiz, cobra por transferencia):
--     · Cuota de autónomo, 60 € al mes, a sus clientes activos y morosos.
--     · Declaración de la renta, 50 € al año, a los de «solo renta».
--
-- Después la llama para «Gestoría Demo» (de000000-…-a0). Si la cuenta no está o
-- no tiene administrador (staging), no hace nada y lo dice.
-- Solo toca la cuenta demo que recibe: cada consulta lleva su cuenta (regla 9).
-- Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261109T1130_gd_tarifa_demo.down.sql

create or replace function public.demo_gestoria_tarifa_sembrar(p_cuenta uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_activa text := current_setting('folvy.cuenta_activa', true);
  v_admin uuid; v_soc uuid; v_aut uuid;
  v_gm uuid; v_lab uuid; v_imp uuid; v_nom uuid; v_cuota uuid; v_renta uuid; v_paq uuid;
  v_basica uuid; v_estandar uuid; v_premium uuid;
  v_desde constant date := date '2026-01-01';
  v_alta date := date_trunc('month', now())::date;
  v_r jsonb; v_n int; v_juntados int := 0; v_lineas_aut int := 0; v_niveles int := 0;
begin
  if not exists (select 1 from public.accounts where id = p_cuenta and is_demo is true) then
    raise exception 'GD: % no es una cuenta de demostración: no se siembra nada.', p_cuenta using errcode = '42501';
  end if;
  select user_id into v_admin from public.user_profiles where account_id = p_cuenta and role = 'admin' and active order by created_at limit 1;
  if v_admin is null then return jsonb_build_object('frase', 'La cuenta demo no tiene administrador: no se siembra la tarifa.'); end if;
  select id into v_soc from public.company where account_id = p_cuenta and sector = 'gestoria' and entity_kind = 'company' order by created_at, id limit 1;
  select id into v_aut from public.company where account_id = p_cuenta and sector = 'gestoria' and entity_kind = 'self_employed' order by created_at, id limit 1;
  if v_soc is null then return jsonb_build_object('frase', 'La cuenta demo no tiene una sociedad de Gestoría: no se siembra la tarifa.'); end if;

  -- Como el administrador de la cuenta (las funciones del G04 miran quién es).
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  -- La cuenta abierta (DM1), como la guarda _cuenta_activa(): «usuario:cuenta».
  perform set_config('folvy.cuenta_activa', v_admin::text || ':' || p_cuenta::text, true);

  -- 1 · Lo de la vez anterior, fuera (solo de esta cuenta).
  update public.conta_linea set nivel_id = null where account_id = p_cuenta and nivel_id is not null;
  delete from public.conta_cliente_paquete where account_id = p_cuenta;
  delete from public.conta_linea where account_id = p_cuenta and origen = 'manual';
  delete from public.conta_precio where account_id = p_cuenta;
  delete from public.conta_paquete where account_id = p_cuenta;
  delete from public.conta_servicio_nivel where account_id = p_cuenta;
  delete from public.conta_servicio s where s.account_id = p_cuenta and s.clave like 'g04:%'
     and not exists (select 1 from public.conta_linea l where l.servicio_id = s.id)
     and not exists (select 1 from public.conta_tarifa t where t.servicio_id = s.id);

  -- 2 · Los servicios que vienen de GoCardless.
  select id into v_gm  from public.conta_servicio where company_id = v_soc and clave = 'gestoria_mensual';
  select id into v_lab from public.conta_servicio where company_id = v_soc and clave = 'gestion_laboral';
  if v_gm is null or v_lab is null then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    perform set_config('folvy.cuenta_activa', coalesce(v_activa, ''), true);
    return jsonb_build_object('frase', 'Aún no se ha leído GoCardless en la demo (faltan la gestoría mensual y la laboral): conecta y lee, y vuelve a sembrar.');
  end if;

  -- El impuesto de sociedades: uno solo, aunque la importación dejara uno por cliente.
  select id into v_imp from public.conta_servicio where company_id = v_soc and upper(nombre) like 'IMPUESTO DE SOCIEDADES%' order by (upper(nombre) = 'IMPUESTO DE SOCIEDADES') desc, created_at, id limit 1;
  if v_imp is not null then
    update public.conta_linea set servicio_id = v_imp where company_id = v_soc and servicio_id in
      (select id from public.conta_servicio where company_id = v_soc and upper(nombre) like 'IMPUESTO DE SOCIEDADES%' and id <> v_imp);
    update public.conta_tarifa set servicio_id = v_imp where company_id = v_soc and servicio_id in
      (select id from public.conta_servicio where company_id = v_soc and upper(nombre) like 'IMPUESTO DE SOCIEDADES%' and id <> v_imp);
    delete from public.conta_servicio where company_id = v_soc and upper(nombre) like 'IMPUESTO DE SOCIEDADES%' and id <> v_imp;
    get diagnostics v_juntados = row_count;
    update public.conta_servicio set nombre = 'Impuesto de sociedades', por_confirmar = false where id = v_imp;
  end if;

  -- 3 · Gestoría mensual con niveles, y cada cliente en el de lo que le cobra GoCardless.
  v_basica   := (public.conta_tarifa_nivel_guardar(v_soc, v_gm, null, 'Básica', 1, array['Contabilidad e impuestos trimestrales'], false, false)->>'id')::uuid;
  v_estandar := (public.conta_tarifa_nivel_guardar(v_soc, v_gm, null, 'Estándar', 2, array['Contabilidad e impuestos trimestrales', 'Cuentas anuales', 'Atención por teléfono'], true, false)->>'id')::uuid;
  v_premium  := (public.conta_tarifa_nivel_guardar(v_soc, v_gm, null, 'Premium', 3, array['Contabilidad e impuestos trimestrales', 'Cuentas anuales', 'Atención por teléfono', 'Gestor asignado y reunión trimestral'], false, false)->>'id')::uuid;
  perform public.conta_tarifa_precio_guardar(v_soc, v_gm, v_basica, null, null, 'fijo', 'mes', 90, null, v_desde, false);
  perform public.conta_tarifa_precio_guardar(v_soc, v_gm, v_estandar, null, null, 'fijo', 'mes', 120, null, v_desde, false);
  perform public.conta_tarifa_precio_guardar(v_soc, v_gm, v_premium, null, null, 'fijo', 'mes', 150, null, v_desde, false);
  update public.conta_linea l set nivel_id = case t.importe when 90 then v_basica when 120 then v_estandar when 150 then v_premium end
    from public.conta_tarifa t
   where l.account_id = p_cuenta and l.servicio_id = v_gm and t.servicio_id = v_gm and t.party_id = l.party_id and t.importe in (90, 120, 150);
  get diagnostics v_niveles = row_count;

  -- Dos precios especiales: en Premium, a lo que les cobra GoCardless (120 €).
  for v_r in select to_jsonb(p) from public.party p where p.account_id = p_cuenta and p.name in ('Frutas Hermanos Ortega, S.L.', 'Óptica Mirada Clara, S.L.') loop
    update public.conta_linea set nivel_id = v_premium where account_id = p_cuenta and servicio_id = v_gm and party_id = (v_r->>'id')::uuid;
    perform public.conta_tarifa_precio_guardar(v_soc, v_gm, v_premium, null, (v_r->>'id')::uuid, 'fijo', 'mes', 120, null, v_desde, false);
  end loop;

  -- 4 · Laboral, impuesto de sociedades, nóminas por tramos y el paquete.
  perform public.conta_tarifa_precio_guardar(v_soc, v_lab, null, null, null, 'por_trabajador', null, 25, null, v_desde, false);
  if v_imp is not null then perform public.conta_tarifa_precio_guardar(v_soc, v_imp, null, null, null, 'fijo', 'anio', 300, null, v_desde, false); end if;
  if not exists (select 1 from public.conta_servicio where company_id = v_soc and lower(nombre) = 'nóminas') then
    v_nom := (public.conta_tarifa_servicio_crear(v_soc, 'Nóminas', 'tramos', null, null,
      '[{"desde":1,"hasta":5,"importe":15,"porUnidad":true},{"desde":6,"hasta":20,"importe":12,"porUnidad":true},{"desde":21,"hasta":null,"importe":10,"porUnidad":true}]'::jsonb,
      v_desde, false)->>'id')::uuid;
  else
    select id into v_nom from public.conta_servicio where company_id = v_soc and lower(nombre) = 'nóminas';
    perform public.conta_tarifa_precio_guardar(v_soc, v_nom, null, null, null, 'tramos', null, null,
      '[{"desde":1,"hasta":5,"importe":15,"porUnidad":true},{"desde":6,"hasta":20,"importe":12,"porUnidad":true},{"desde":21,"hasta":null,"importe":10,"porUnidad":true}]'::jsonb, v_desde, false);
  end if;
  v_paq := (public.conta_tarifa_paquete_guardar(v_soc, null, 'Pack Empresa', 'Gestoría mensual Estándar y la laboral de hasta 3 trabajadores.', 20,
    jsonb_build_array(jsonb_build_object('servicio', v_gm, 'nivel', v_estandar), jsonb_build_object('servicio', v_lab, 'limiteTrabajadores', 3)), false)->>'id')::uuid;
  perform public.conta_tarifa_precio_guardar(v_soc, null, null, v_paq, null, 'fijo', 'mes', 180, null, v_desde, false);

  -- 5 · La autónoma: su cuota y la renta, a los clientes que son suyos según el CRM.
  if v_aut is not null then
    if not exists (select 1 from public.conta_servicio where company_id = v_aut and lower(nombre) = 'cuota de autónomo') then
      v_cuota := (public.conta_tarifa_servicio_crear(v_aut, 'Cuota de autónomo', 'fijo', 'mes', 60, null, v_desde, false)->>'id')::uuid;
    else
      select id into v_cuota from public.conta_servicio where company_id = v_aut and lower(nombre) = 'cuota de autónomo';
      perform public.conta_tarifa_precio_guardar(v_aut, v_cuota, null, null, null, 'fijo', 'mes', 60, null, v_desde, false);
    end if;
    if not exists (select 1 from public.conta_servicio where company_id = v_aut and lower(nombre) = 'declaración de la renta') then
      v_renta := (public.conta_tarifa_servicio_crear(v_aut, 'Declaración de la renta', 'fijo', 'anio', 50, null, v_desde, false)->>'id')::uuid;
    else
      select id into v_renta from public.conta_servicio where company_id = v_aut and lower(nombre) = 'declaración de la renta';
      perform public.conta_tarifa_precio_guardar(v_aut, v_renta, null, null, null, 'fijo', 'anio', 50, null, v_desde, false);
    end if;
    for v_r in select jsonb_build_object('party', c.party_id, 'situacion', c.situacion) from public.conta_gestoria_cliente c
                where c.account_id = p_cuenta and c.emisor_segun_crm = v_aut and c.situacion in ('activo', 'moroso', 'solo_renta') loop
      perform public.conta_tarifa_servicio_anadir(v_aut, (v_r->>'party')::uuid, case when v_r->>'situacion' = 'solo_renta' then v_renta else v_cuota end,
        null, null, v_alta, null, false);
      v_lineas_aut := v_lineas_aut + 1;
    end loop;
  end if;

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('folvy.cuenta_activa', coalesce(v_activa, ''), true);
  select count(*) into v_n from public.conta_precio where account_id = p_cuenta and party_id is not null;
  return jsonb_build_object('frase', format(
    'Sembrada la tarifa de la demo: Gestoría mensual con 3 niveles (Básica 90 €, Estándar 120 €, Premium 150 €; %s clientes en su nivel), %s precios especiales, '
    'laboral a 25 € por trabajador, impuesto de sociedades a 300 € al año%s, Nóminas por tramos, el paquete «Pack Empresa» (180 € al mes) '
    'y %s líneas de la autónoma (cuota y renta).',
    v_niveles, v_n, case when v_juntados > 0 then format(' (juntados %s servicios de la importación)', v_juntados) else '' end, v_lineas_aut));
end $$;
comment on function public.demo_gestoria_tarifa_sembrar(uuid) is
  'GD · Siembra (o vuelve a sembrar) la tarifa de una cuenta de demostración de Gestoría: niveles, precios especiales, laboral, impuesto de sociedades, nóminas por tramos, un paquete y las cuotas de la autónoma. Solo cuentas demo; solo la llama la plataforma.';
revoke all on function public.demo_gestoria_tarifa_sembrar(uuid) from public, anon, authenticated;
grant execute on function public.demo_gestoria_tarifa_sembrar(uuid) to service_role;

do $$
declare v jsonb;
begin
  if not exists (select 1 from public.accounts where id = 'de000000-0000-4000-8000-0000000000a0' and is_demo) then
    raise notice 'GD: no está «Gestoría Demo»: no se siembra la tarifa.';
    return;
  end if;
  v := public.demo_gestoria_tarifa_sembrar('de000000-0000-4000-8000-0000000000a0');
  raise notice 'GD: %', v->>'frase';
end $$;
