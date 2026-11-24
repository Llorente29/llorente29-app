-- supabase/staging/sql/20261117_n06a_carga_prueba.sql
--
-- SOLO STAGING. Prueba del N06a (20261117T1806_n06a_carga_columnas, 20261117T1807_n06a_carga_embudo y
-- 20261117T1808_n06a_carga_funciones), que el ensayo de staging pone delante en la misma sesión. Todo
-- en una transacción con ROLLBACK: staging no cambia. Datos INVENTADOS: el ejemplo de ERP10 del
-- repositorio (tests/conta/fixtures/importar/erp10), leído por el módulo del N04 y pasado por
-- paraLaBase (abajo, entre $carga$; una prueba unitaria comprueba que es exactamente eso), en la
-- primera empresa de la cuenta A sin nada traído. Nombra los objetos que cambian:
-- public._journal_entry_proponer, public.conta_motivos_para_validar, public._conta_facturas_apuntar,
-- public.tg_s01o2_iva_no_deducible, public.customer_invoice_inalterable y public.import_run.
--
--   0. Permisos.
--   1. EL EMBUDO (regla 31): una propuesta de cada clase que ya existe (una recibida, una emitida, un
--      día de ventas, un movimiento de banco y un asiento a mano), con el embudo NUEVO, con el de
--      ANTES (las tres vueltas atrás) y con el nuevo otra vez: idénticas campo a campo.
--   2. Traer el ejemplo en una empresa sin día de inicio: las cifras del LEEME (10 asientos, 26
--      apuntes, 11.499,00 al debe y al haber; 5 facturas casadas; F-2, B-7 y ALQ-3 pendientes; F-1 y
--      A-10 pagadas), en borrador, con su número de ERP10, y el día de inicio fijado el 01/04/2026.
--   3. Lo traído no se valida a mano; a una traída no se le propone asiento (ni a mano ni la pasada);
--      sus facturas no generan actividad ni pagos, ni cambian su IVA.
--   4. No dos a la vez; otra cuenta no ve la carga ni la deshace; «Dejarlas fuera».
--   5. Deshacer: la cuenta A, tabla a tabla, IDÉNTICA a antes de traer, y las demás cuentas sin
--      cambios. Traer otra vez (las mismas cifras) y deshacer otra vez; una deshecha no se deshace.
--   6. El ensayo de la regla 10 (respuesta N05c · 1, punto 6): la empresa con día de inicio
--      (01/11/2026) y la decisión de trabajar sin lo anterior; traer (lo del 01/11 en adelante,
--      fuera); validar a mano un asiento y una recibida nuevos con la carga en prueba; deshacer; y
--      la empresa queda como antes de traer, con sus dos asientos nuevos intactos.
--
-- con usuario: lo de la pantalla (traer, deshacer, dejar fuera, proponer, validar y leer el día de
-- inicio) se hace como el administrador a1 de la cuenta A, y lo de la otra cuenta como b1
-- («set local role authenticated»); lo de preparar y medir, como el dueño.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA N06a: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- El ejemplo de ERP10, como lo manda la pantalla (paraLaBase de leerCarga; importes en céntimos).
select set_config('n06a.datos', $carga${"version":1,"programa":"erp10","ficheros":[{"tipo":"proveedores","nombre":"proveedores.xlsx","haLeido":"4 fichas"},{"tipo":"clientes","nombre":"clientes.xlsx","haLeido":"1 ficha"},{"tipo":"inmovilizado","nombre":"inmovilizado.xlsx","haLeido":"1 elemento"},{"tipo":"plan_cuentas","nombre":"plan_de_cuentas.xlsx","haLeido":"16 cuentas"},{"tipo":"diario","nombre":"diario.xlsx","haLeido":"10 asientos · 26 apuntes"},{"tipo":"expedidas","nombre":"libro_expedidas.xlsx","haLeido":"2 facturas"},{"tipo":"recibidas","nombre":"libro_recibidas.xlsx","haLeido":"3 facturas"},{"tipo":"sumas_saldos","nombre":"sumas_y_saldos.xlsx","haLeido":"15 cuentas"}],"largos":[8],"cuentas":[{"codigo":"10000000","nombre":"Capital social"},{"codigo":"21600000","nombre":"Mobiliario"},{"codigo":"28160000","nombre":"Amortización acumulada de mobiliario"},{"codigo":"40000000","nombre":"Proveedores varios"},{"codigo":"40000001","nombre":"Proveedor Ejemplo Uno, S.L."},{"codigo":"40000002","nombre":"Proveedor Ejemplo Dos, S.A."},{"codigo":"41000001","nombre":"Arrendador Ejemplo"},{"codigo":"43000001","nombre":"Cliente Ejemplo Uno, S.L."},{"codigo":"47200000","nombre":"H.P. IVA soportado"},{"codigo":"47510000","nombre":"H.P. acreedora por retenciones"},{"codigo":"47700000","nombre":"H.P. IVA repercutido"},{"codigo":"57200001","nombre":"Banco de ejemplo"},{"codigo":"60000000","nombre":"Compras de mercaderías"},{"codigo":"62100000","nombre":"Arrendamientos"},{"codigo":"68100000","nombre":"Amortización del inmovilizado material"},{"codigo":"70000000","nombre":"Ventas de mercaderías"}],"terceros":[{"clase":"proveedor","codigo":"40000000","nombre":"Proveedores varios","nombreComercial":"","nif":null},{"clase":"proveedor","codigo":"40000001","nombre":"Proveedor Ejemplo Uno, S.L.","nombreComercial":"Ejemplo Uno","nif":"B00000000"},{"clase":"proveedor","codigo":"40000002","nombre":"Proveedor Ejemplo Dos, S.A.","nombreComercial":"Ejemplo Dos","nif":"A00000000"},{"clase":"proveedor","codigo":"41000001","nombre":"Arrendador Ejemplo","nombreComercial":"Arrendador Ejemplo","nif":"12345678Z"},{"clase":"cliente","codigo":"43000001","nombre":"Cliente Ejemplo Uno, S.L.","nombreComercial":"Cliente Uno","nif":"B12345678"}],"asientos":[{"clave":"3.1","serie":"3","documento":"1","fecha":"2026-01-02","concepto":"Aportación inicial","apuntesLeidos":2,"apuntes":[{"cuenta":"57200001","nombre":"Banco de ejemplo","concepto":"Aportación inicial","debe":500000,"haber":0},{"cuenta":"10000000","nombre":"Capital social","concepto":"Aportación inicial","debe":0,"haber":500000}]},{"clave":"3.2","serie":"3","documento":"2","fecha":"2026-01-05","concepto":"Compra de mobiliario","apuntesLeidos":2,"apuntes":[{"cuenta":"21600000","nombre":"Mobiliario","concepto":"Compra de mobiliario","debe":120000,"haber":0},{"cuenta":"57200001","nombre":"Banco de ejemplo","concepto":"Compra de mobiliario","debe":0,"haber":120000}]},{"clave":"1.1","serie":"1","documento":"1","fecha":"2026-01-15","concepto":"F-1-Cliente Ejemplo Uno","apuntesLeidos":3,"apuntes":[{"cuenta":"43000001","nombre":"Cliente Ejemplo Uno, S.L.","concepto":"F-1-Cliente Ejemplo Uno","debe":110000,"haber":0},{"cuenta":"70000000","nombre":"Ventas de mercaderías","concepto":"F-1-Cliente Ejemplo Uno","debe":0,"haber":100000},{"cuenta":"47700000","nombre":"H.P. IVA repercutido","concepto":"F-1-Cliente Ejemplo Uno","debe":0,"haber":10000,"iva":{"tipo":10,"base":100000,"libro":"issued"}}]},{"clave":"2.1","serie":"2","documento":"1","fecha":"2026-01-20","concepto":"A-10-Proveedor Ejemplo Uno","apuntesLeidos":3,"apuntes":[{"cuenta":"60000000","nombre":"Compras de mercaderías","concepto":"A-10-Proveedor Ejemplo Uno","debe":40000,"haber":0},{"cuenta":"47200000","nombre":"H.P. IVA soportado","concepto":"A-10-Proveedor Ejemplo Uno","debe":8400,"haber":0,"iva":{"tipo":21,"base":40000,"libro":"received"}},{"cuenta":"40000001","nombre":"Proveedor Ejemplo Uno, S.L.","concepto":"A-10-Proveedor Ejemplo Uno","debe":0,"haber":48400}]},{"clave":"3.3","serie":"3","documento":"3","fecha":"2026-01-31","concepto":"Cobro F-1","apuntesLeidos":2,"apuntes":[{"cuenta":"57200001","nombre":"Banco de ejemplo","concepto":"Cobro F-1","debe":110000,"haber":0},{"cuenta":"43000001","nombre":"Cliente Ejemplo Uno, S.L.","concepto":"Cobro F-1","debe":0,"haber":110000}]},{"clave":"2.2","serie":"2","documento":"2","fecha":"2026-02-05","concepto":"B-7-Proveedor Ejemplo Dos","apuntesLeidos":3,"apuntes":[{"cuenta":"60000000","nombre":"Compras de mercaderías","concepto":"B-7-Proveedor Ejemplo Dos","debe":30000,"haber":0},{"cuenta":"47200000","nombre":"H.P. IVA soportado","concepto":"B-7-Proveedor Ejemplo Dos","debe":2100,"haber":0,"iva":{"tipo":21,"base":10000,"libro":"received"}},{"cuenta":"47200000","nombre":"H.P. IVA soportado","concepto":"B-7-Proveedor Ejemplo Dos","debe":2000,"haber":0,"iva":{"tipo":10,"base":20000,"libro":"received"}},{"cuenta":"40000002","nombre":"Proveedor Ejemplo Dos, S.A.","concepto":"B-7-Proveedor Ejemplo Dos","debe":0,"haber":34100}]},{"clave":"1.2","serie":"1","documento":"2","fecha":"2026-02-10","concepto":"F-2-Cliente Ejemplo Uno","apuntesLeidos":3,"apuntes":[{"cuenta":"43000001","nombre":"Cliente Ejemplo Uno, S.L.","concepto":"F-2-Cliente Ejemplo Uno","debe":55000,"haber":0},{"cuenta":"70000000","nombre":"Ventas de mercaderías","concepto":"F-2-Cliente Ejemplo Uno","debe":0,"haber":50000},{"cuenta":"47700000","nombre":"H.P. IVA repercutido","concepto":"F-2-Cliente Ejemplo Uno","debe":0,"haber":5000,"iva":{"tipo":10,"base":50000,"libro":"issued"}}]},{"clave":"3.4","serie":"3","documento":"4","fecha":"2026-02-28","concepto":"Pago A-10","apuntesLeidos":2,"apuntes":[{"cuenta":"40000001","nombre":"Proveedor Ejemplo Uno, S.L.","concepto":"Pago A-10","debe":48400,"haber":0},{"cuenta":"57200001","nombre":"Banco de ejemplo","concepto":"Pago A-10","debe":0,"haber":48400}]},{"clave":"2.3","serie":"2","documento":"3","fecha":"2026-03-01","concepto":"ALQ-3-Arrendador Ejemplo","apuntesLeidos":4,"apuntes":[{"cuenta":"62100000","nombre":"Arrendamientos","concepto":"ALQ-3-Arrendador Ejemplo","debe":100000,"haber":0},{"cuenta":"47200000","nombre":"H.P. IVA soportado","concepto":"ALQ-3-Arrendador Ejemplo","debe":21000,"haber":0,"iva":{"tipo":21,"base":100000,"libro":"received"}},{"cuenta":"47510000","nombre":"H.P. acreedora por retenciones","concepto":"ALQ-3-Arrendador Ejemplo","debe":0,"haber":19000,"retencion":{"tipo":19,"base":100000}},{"cuenta":"41000001","nombre":"Arrendador Ejemplo","concepto":"ALQ-3-Arrendador Ejemplo","debe":0,"haber":102000}]},{"clave":"3.5","serie":"3","documento":"5","fecha":"2026-03-31","concepto":"Amortización del trimestre","apuntesLeidos":2,"apuntes":[{"cuenta":"68100000","nombre":"Amortización del inmovilizado material","concepto":"Amortización del trimestre","debe":3000,"haber":0},{"cuenta":"28160000","nombre":"Amortización acumulada de mobiliario","concepto":"Amortización del trimestre","debe":0,"haber":3000}]}],"facturas":[{"libro":"recibidas","numero":"A-10","serie":null,"numeroSolo":null,"fecha":"2026-01-20","operacion":null,"periodo":"1T","ejercicio":"2026","nif":"B00000000","nombre":"Proveedor Ejemplo Uno, S.L.","tramos":[{"base":40000,"tipo":21,"cuota":8400}],"base":40000,"cuota":8400,"total":48400,"retencion":null,"asiento":"2.1|2026-01-20","pendiente":0},{"libro":"recibidas","numero":"B-7","serie":null,"numeroSolo":null,"fecha":"2026-02-05","operacion":null,"periodo":"1T","ejercicio":"2026","nif":"A00000000","nombre":"Proveedor Ejemplo Dos, S.A.","tramos":[{"base":10000,"tipo":21,"cuota":2100},{"base":20000,"tipo":10,"cuota":2000}],"base":30000,"cuota":4100,"total":34100,"retencion":null,"asiento":"2.2|2026-02-05","pendiente":34100},{"libro":"recibidas","numero":"ALQ-3","serie":null,"numeroSolo":null,"fecha":"2026-03-01","operacion":null,"periodo":"1T","ejercicio":"2026","nif":"12345678Z","nombre":"Arrendador Ejemplo","tramos":[{"base":100000,"tipo":21,"cuota":21000}],"base":100000,"cuota":21000,"total":121000,"retencion":{"tipo":19,"importe":19000},"asiento":"2.3|2026-03-01","pendiente":102000},{"libro":"expedidas","numero":"F-1","serie":"F","numeroSolo":"1","fecha":"2026-01-15","operacion":null,"periodo":"1T","ejercicio":"2026","nif":"B12345678","nombre":"Cliente Ejemplo Uno, S.L.","tramos":[{"base":100000,"tipo":10,"cuota":10000}],"base":100000,"cuota":10000,"total":110000,"retencion":null,"asiento":"1.1|2026-01-15","pendiente":0},{"libro":"expedidas","numero":"F-2","serie":"F","numeroSolo":"2","fecha":"2026-02-10","operacion":null,"periodo":"1T","ejercicio":"2026","nif":"B12345678","nombre":"Cliente Ejemplo Uno, S.L.","tramos":[{"base":50000,"tipo":10,"cuota":5000}],"base":50000,"cuota":5000,"total":55000,"retencion":null,"asiento":"1.2|2026-02-10","pendiente":55000}],"aprendido":[{"codigo":"40000001","gasto":{"cuenta":"60000000","nombre":"Compras de mercaderías"},"tiposIva":[21],"retencion":null,"porque":"Su factura del diario va a Compras de mercaderías · 60000000, con IVA al 21 %."},{"codigo":"40000002","gasto":{"cuenta":"60000000","nombre":"Compras de mercaderías"},"tiposIva":[10,21],"retencion":null,"porque":"Su factura del diario va a Compras de mercaderías · 60000000, con IVA al 10 % y al 21 %."},{"codigo":"41000001","gasto":{"cuenta":"62100000","nombre":"Arrendamientos"},"tiposIva":[21],"retencion":19,"porque":"Su factura del diario va a Arrendamientos · 62100000, con IVA al 21 % y una retención del 19 %."}],"pendientesNoExactos":[],"raros":[{"que":"sin_nif","cuentas":["40000000"],"nif":null,"frase":"40000000 · Proveedores varios: no trae NIF."}],"inmovilizado":{"aFecha":"2026-03-31","elementos":[{"codigo":"1","subcuenta":"21600000","descripcion":"Mobiliario de ejemplo","compra":"2026-01-05","baja":null,"precio":120000,"amortizado":3000,"valorContable":117000,"amortizacionFiscal":3000}],"totales":{"precio":120000,"amortizado":3000,"valorContable":117000,"amortizacionFiscal":3000},"avisos":[]},"frases":["40000000 · Proveedores varios: no trae NIF."]}$carga$, true) is not null as datos;

-- ── Para preparar y medir (como el dueño) ──────────────────────────────────────────────────────────
create temp table n06a_fuera (id uuid primary key) on commit drop;   -- lo apuntado DESPUÉS de traer (regla 10)
create temp table n06a_h (paso text, quien text, tabla text, filas bigint, huella text) on commit drop;

-- La huella de cada tabla que toca una carga (sin updated_at), de la cuenta A o de todas las demás.
create or replace function pg_temp.medir(p_paso text) returns void language plpgsql as $f$
declare t text; v_filtro text; v_suya boolean;
begin
  foreach v_suya in array array[true, false] loop
    foreach t in array array['journal_entry', 'journal_line', 'supplier_invoice', 'supplier_invoice_tax', 'customer_invoice', 'company_account',
                             'company_account_link', 'supplier', 'party', 'party_role', 'customer_fiscal', 'supplier_learning', 'supplier_invoice_auto',
                             'document_activity', 'fiscal_year', 'fiscal_period_lock', 'conta_mes_cambio', 'import_run'] loop
      v_filtro := case t
        when 'import_run' then ' and x.kind <> ''carga'' and x.parent_id is null'
        when 'journal_entry' then ' and x.id not in (select id from n06a_fuera)'
        when 'journal_line' then ' and x.entry_id not in (select id from n06a_fuera)'
        when 'supplier_invoice' then ' and x.id not in (select id from n06a_fuera)'
        when 'supplier_invoice_tax' then ' and x.supplier_invoice_id not in (select id from n06a_fuera)'
        when 'supplier_invoice_auto' then ' and x.invoice_id not in (select id from n06a_fuera)'
        when 'document_activity' then ' and not exists (select 1 from n06a_fuera f where f.id in (x.supplier_invoice_id, x.journal_entry_id))'
        when 'conta_mes_cambio' then ' and x.entry_id not in (select id from n06a_fuera)'
        else '' end;
      execute format('insert into n06a_h select %L, %L, %L, count(*), md5(coalesce(string_agg((to_jsonb(x) - ''updated_at'')::text, ''|'' '
                     || 'order by (to_jsonb(x) - ''updated_at'')::text), '''')) from public.%I x where (x.account_id = $1) = $2' || v_filtro,
                     p_paso, case when v_suya then 'A' else 'otras' end, t, t)
        using 'c01a0000-0000-4000-8000-00000000000a'::uuid, v_suya;
    end loop;
  end loop;
end $f$;
-- Dos medidas iguales, tabla a tabla (regla 31: la misma vara a los dos lados).
create or replace function pg_temp.iguales(p_antes text, p_despues text, p_que text) returns text language plpgsql as $f$
declare v_mal text; v_a bigint; v_o bigint;
begin
  select string_agg(a.quien || ' · ' || a.tabla || ' (' || a.filas || ' → ' || coalesce(d.filas::text, '?') || ' filas)', '; ' order by a.quien, a.tabla) into v_mal
    from n06a_h a left join n06a_h d on d.paso = p_despues and d.quien = a.quien and d.tabla = a.tabla
   where a.paso = p_antes and (d.huella is distinct from a.huella);
  if v_mal is not null then raise exception 'PRUEBA N06a · %: no ha quedado como estaba: %.', p_que, v_mal; end if;
  select sum(filas) filter (where quien = 'A'), sum(filas) filter (where quien = 'otras') into v_a, v_o from n06a_h where paso = p_antes;
  return format('18 tablas iguales, huella a huella: %s filas de la cuenta A y %s de las demás cuentas', v_a, v_o);
end $f$;

-- La empresa: la primera de la cuenta A sin nada traído, con su ejercicio 2026 y sin día de inicio.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; v_run uuid; r jsonb; v_loc uuid;
begin
  select co.id into c from public.company co
   where co.account_id = v_acc and not exists (select 1 from public.journal_entry e where e.company_id = co.id and e.source_type = 'migrated')
   order by co.created_at, co.id limit 1;
  if c is null then raise exception 'PRUEBA N06a: la cuenta A no tiene ninguna empresa sin asientos traídos.'; end if;
  perform set_config('n06a.empresa', c::text, true);
  if (select account_digits from public.company_tax_profile where company_id = c) is distinct from 8 then
    raise exception 'PRUEBA N06a: la empresa de la cuenta A no tiene cuentas de 8 dígitos, y el ejemplo de ERP10 sí.';
  end if;
  if not exists (select 1 from public.fiscal_year where company_id = c and starts_on = '2026-01-01' and ends_on = '2026-12-31') then
    if exists (select 1 from public.fiscal_year where company_id = c and starts_on <= '2026-12-31' and ends_on >= '2026-01-01') then
      raise exception 'PRUEBA N06a: el ejercicio de 2026 de la empresa no va del 01/01 al 31/12.';
    end if;
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31');
  end if;
  update public.bank_settings set cutover_date = null where company_id = c;
  perform public.conta_fijar_corte(c, null, 'erp10');
  if public.conta_dia_de_inicio(c) is not null then raise exception 'PRUEBA N06a: la empresa sigue con día de inicio.'; end if;
  if exists (select 1 from public.journal_entry e where e.company_id = c and e.status in ('borrador', 'validado') and e.entry_date between '2026-01-01' and '2026-03-31') then
    raise exception 'PRUEBA N06a: la empresa ya tiene asientos del primer trimestre de 2026: el ejemplo pararía.';
  end if;
  -- Las cuentas de las propuestas del paso 1 y de lo apuntado en el 6 (algunas, las mismas que trae el ejemplo).
  insert into public.import_run (account_id, company_id, program, kind) values (v_acc, c, 'otro', 'plan_cuentas') returning id into v_run;
  r := public.conta_diez_subcuentas(c, v_run, '[{"code":"62900000","nombre":"Otros servicios"},{"code":"57200000","nombre":"Bancos"},{"code":"60000000","nombre":"Compras"},{"code":"47200000","nombre":"IVA soportado"},{"code":"40000000","nombre":"Proveedores"},{"code":"43000000","nombre":"Clientes"},{"code":"70000000","nombre":"Ventas"},{"code":"47700000","nombre":"IVA repercutido"}]');
  if jsonb_array_length(r -> 'rechazadas') <> 0 then raise exception 'PRUEBA N06a: las subcuentas de la prueba no entran: %.', r; end if;
  update public.import_run set status = 'hecho', finished_at = now() where id = v_run;
  select id into v_loc from public.locations where account_id = v_acc order by id limit 1;
  if v_loc is null then raise exception 'PRUEBA N06a: la cuenta A no tiene ningún local para el día de ventas.'; end if;
  perform set_config('n06a.local', v_loc::text, true);
end $$;

-- 0 · Permisos ---------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['conta_traer_cargar(uuid,text,jsonb,text)', 'conta_traer_deshacer(uuid,text)', 'conta_traer_dejar_fuera(uuid,uuid[],boolean)',
                           'conta_empresa_dia_de_inicio(uuid)'] loop
    if not has_function_privilege('authenticated', 'public.' || f, 'execute') or has_function_privilege('anon', 'public.' || f, 'execute') then
      raise exception 'PRUEBA N06a · 0: % no es solo para usuarios.', f;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public._conta_traer_kind(text)', 'execute') then
    raise exception 'PRUEBA N06a · 0: _conta_traer_kind la puede ejecutar un usuario.';
  end if;
end $$;

-- 1 · EL EMBUDO: una propuesta de cada clase, antes y después del cambio, idénticas campo a campo ------
create or replace function pg_temp.cinco() returns jsonb language plpgsql as $f$
declare
  c uuid := current_setting('n06a.empresa')::uuid; v_iva uuid; v_rec uuid; v_emi uuid; r jsonb; v_out jsonb := '[]'; v_e jsonb; v_id uuid;
  v_ids uuid[] := '{}';
begin
  select id into v_iva from public.tax_rate where rate = 21 and treatment = 'taxed' and valid_to is null and name like 'IVA%' limit 1;
  v_rec := current_setting('n06a.recibida_embudo')::uuid; v_emi := current_setting('n06a.emitida_embudo')::uuid;
  for v_e in select * from jsonb_array_elements(jsonb_build_array(
    -- una recibida
    jsonb_build_object('e', jsonb_build_object('series', 2, 'fecha', '2026-11-06', 'concepto', 'Prueba N06a · recibida', 'source_type', 'supplier_invoice',
                         'source_id', v_rec, 'confianza', 'seguro', 'porque', 'Prueba N06a', 'documento', 'N06A-EMB-1'),
                       'l', jsonb_build_array(jsonb_build_object('cuenta', '60000000', 'debe', 100, 'haber', 0, 'comun', true),
                              jsonb_build_object('cuenta', '47200000', 'debe', 21, 'haber', 0, 'comun', true,
                                'iva', jsonb_build_object('tipo_id', v_iva, 'base', 100, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
                              jsonb_build_object('cuenta', '40000000', 'debe', 0, 'haber', 121, 'comun', true))),
    -- una emitida
    jsonb_build_object('e', jsonb_build_object('series', 1, 'fecha', '2026-11-07', 'concepto', 'Prueba N06a · emitida', 'source_type', 'customer_invoice',
                         'source_id', v_emi, 'confianza', 'seguro', 'porque', 'Prueba N06a'),
                       'l', jsonb_build_array(jsonb_build_object('cuenta', '43000000', 'debe', 121, 'haber', 0, 'comun', true),
                              jsonb_build_object('cuenta', '70000000', 'debe', 0, 'haber', 100, 'comun', true),
                              jsonb_build_object('cuenta', '47700000', 'debe', 0, 'haber', 21, 'comun', true,
                                'iva', jsonb_build_object('tipo_id', v_iva, 'base', 100, 'libro', 'issued', 'facturas', 1)))),
    -- un día de ventas (por unidad)
    jsonb_build_object('e', jsonb_build_object('series', 1, 'fecha', '2026-11-08', 'concepto', 'Prueba N06a · ventas del día', 'source_type', 'sales_day',
                         'confianza', 'seguro', 'porque', 'Prueba N06a'),
                       's', jsonb_build_object('location_id', current_setting('n06a.local'), 'sales_day', '2026-11-08', 'unit_key', 'n06a', 'tickets_count', 3,
                         'total', 121, 'by_rate', '[]'::jsonb, 'detail_hash', 'n06a'),
                       'l', jsonb_build_array(jsonb_build_object('cuenta', '57200000', 'debe', 121, 'haber', 0, 'comun', true),
                              jsonb_build_object('cuenta', '70000000', 'debe', 0, 'haber', 121, 'comun', true))),
    -- un movimiento de banco
    jsonb_build_object('e', jsonb_build_object('series', 3, 'fecha', '2026-11-09', 'concepto', 'Prueba N06a · banco', 'source_type', 'bank',
                         'source_id', 'e06a0000-0000-4000-8000-000000000001', 'confianza', 'probable', 'porque', 'Prueba N06a'),
                       'l', jsonb_build_array(jsonb_build_object('cuenta', '62900000', 'debe', 30, 'haber', 0, 'comun', true),
                              jsonb_build_object('cuenta', '57200000', 'debe', 0, 'haber', 30, 'comun', true))),
    -- un asiento a mano
    jsonb_build_object('e', jsonb_build_object('series', 3, 'fecha', '2026-11-10', 'concepto', 'Prueba N06a · a mano', 'source_type', 'manual',
                         'confianza', 'seguro', 'porque', 'Prueba N06a'),
                       'l', jsonb_build_array(jsonb_build_object('cuenta', '62900000', 'debe', 10, 'haber', 0, 'comun', true),
                              jsonb_build_object('cuenta', '57200000', 'debe', 0, 'haber', 10, 'comun', true))))) loop
    r := public.journal_entry_proponer(c, v_e->'e', v_e->'l', v_e->'s', 'Prueba N06a');
    v_id := (r->>'id')::uuid; v_ids := v_ids || v_id;
    v_out := v_out || jsonb_build_object(
      'asiento', (select to_jsonb(e) - array['id', 'created_at', 'updated_at'] || jsonb_build_object('source_id', case when e.source_type = 'sales_day' then null else e.source_id end)
                    from public.journal_entry e where e.id = v_id),
      'apuntes', (select jsonb_agg(to_jsonb(l) - array['id', 'entry_id', 'created_at', 'updated_at'] order by l.position) from public.journal_line l where l.entry_id = v_id),
      'resumen', (select to_jsonb(s) - array['id', 'entry_id', 'created_at'] from public.sales_day_summary s where s.entry_id = v_id),
      'respuesta', r - 'id');
  end loop;
  perform set_config('n06a.cinco', array_to_string(v_ids, ','), true);
  return v_out;
end $f$;
create or replace function pg_temp.cinco_fuera() returns void language plpgsql as $f$
begin
  delete from public.sales_day_summary where entry_id = any(string_to_array(current_setting('n06a.cinco'), ',')::uuid[]);
  delete from public.journal_entry where id = any(string_to_array(current_setting('n06a.cinco'), ',')::uuid[]);
end $f$;
do $$
declare c uuid := current_setting('n06a.empresa')::uuid; v uuid;
begin
  insert into public.supplier_invoice (account_id, company_id, invoice_number, invoice_date, status, source, grand_total, tax_base_total, tax_total, created_by_name)
  values ('c01a0000-0000-4000-8000-00000000000a', c, 'N06A-EMB-1', '2026-11-06', 'en_revision', 'manual', 121, 100, 21, 'Prueba N06a') returning id into v;
  perform set_config('n06a.recibida_embudo', v::text, true);
  insert into public.customer_invoice (account_id, company_id, status, issue_date, base, tax, total, created_by_name)
  values ('c01a0000-0000-4000-8000-00000000000a', c, 'borrador', '2026-11-07', 100, 21, 121, 'Prueba N06a') returning id into v;
  perform set_config('n06a.emitida_embudo', v::text, true);
end $$;

set local role authenticated;
select set_config('n06a.cinco_nuevo', pg_temp.cinco()::text, true) is not null as cinco_con_el_nuevo;
reset role;
select pg_temp.cinco_fuera();
-- El embudo de ANTES: las tres vueltas atrás (también se prueban aquí, sobre estos datos).
\i supabase/vuelta-atras/20261117T1808_n06a_carga_funciones.down.sql
\i supabase/vuelta-atras/20261117T1807_n06a_carga_embudo.down.sql
\i supabase/vuelta-atras/20261117T1806_n06a_carga_columnas.down.sql
do $$
begin
  if exists (select 1 from pg_proc where proname in ('_journal_entry_proponer', 'conta_motivos_para_validar', '_conta_facturas_apuntar', 'tg_s01o2_iva_no_deducible',
                                                     'customer_invoice_inalterable') and prosrc ~ 'N06a')
     or to_regprocedure('public.conta_traer_cargar(uuid,text,jsonb,text)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and column_name in ('import_mark', 'import_pending', 'parent_id', 'detail')
                  and table_name in ('import_run', 'supplier_invoice', 'customer_invoice'))
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('supplier', 'party') and column_name = 'import_run_id')
     or pg_get_constraintdef((select oid from pg_constraint where conname = 'import_run_kind_check')) ~ 'carga' then
    raise exception 'PRUEBA N06a · 1: las vueltas atrás no han dejado todo como antes.';
  end if;
end $$;
set local role authenticated;
select set_config('n06a.cinco_viejo', pg_temp.cinco()::text, true) is not null as cinco_con_el_de_antes;
reset role;
select pg_temp.cinco_fuera();
-- Y el nuevo otra vez (las tres, como las pasa el ensayo).
\i supabase/migrations/20261117T1806_n06a_carga_columnas.sql
\i supabase/migrations/20261117T1807_n06a_carga_embudo.sql
\i supabase/migrations/20261117T1808_n06a_carga_funciones.sql
set local role authenticated;
select set_config('n06a.cinco_otra', pg_temp.cinco()::text, true) is not null as cinco_con_el_nuevo_otra_vez;
reset role;
select pg_temp.cinco_fuera();
do $$
declare v_n jsonb := current_setting('n06a.cinco_nuevo')::jsonb; v_v jsonb := current_setting('n06a.cinco_viejo')::jsonb; i int; v_campos int := 0;
begin
  if jsonb_array_length(v_n) <> 5 then raise exception 'PRUEBA N06a · 1: no salen las cinco propuestas: %.', v_n; end if;
  for i in 0..4 loop
    if v_n->i is distinct from v_v->i then
      raise exception 'PRUEBA N06a · 1: la propuesta % (%) no sale igual con el embudo nuevo. Antes: %. Ahora: %.', i + 1, v_v->i->'asiento'->>'source_type', v_v->i, v_n->i;
    end if;
    if v_n->i->'asiento'->>'status' <> 'propuesto' then raise exception 'PRUEBA N06a · 1: la % no queda propuesta.', v_n->i->'asiento'->>'source_type'; end if;
    select v_campos + count(*) into v_campos from jsonb_object_keys(v_n->i->'asiento');
    select v_campos + coalesce(sum((select count(*) from jsonb_object_keys(a))), 0) into v_campos from jsonb_array_elements(v_n->i->'apuntes') a;
  end loop;
  if current_setting('n06a.cinco_otra')::jsonb is distinct from v_n then
    raise exception 'PRUEBA N06a · 1: con el embudo nuevo pasado otra vez, las propuestas cambian.';
  end if;
  raise notice 'PRUEBA N06a · 1: las cinco propuestas (recibida, emitida, día de ventas, banco y a mano), idénticas antes y después del cambio: % campos de asiento y apuntes, uno a uno.', v_campos;
end $$;
delete from public.supplier_invoice where id = current_setting('n06a.recibida_embudo')::uuid;
delete from public.customer_invoice where id = current_setting('n06a.emitida_embudo')::uuid;

-- 2 · Traer el ejemplo, sin día de inicio --------------------------------------------------------------
select pg_temp.medir('antes');
set local role authenticated;
do $$
declare c uuid := current_setting('n06a.empresa')::uuid; r jsonb; k jsonb; v_t text;
begin
  r := public.conta_traer_cargar(c, null, current_setting('n06a.datos')::jsonb, 'Prueba N06a');
  perform set_config('n06a.carga', r->>'carga', true);
  k := r->'cuentas';
  if (k->>'asientos')::int <> 10 or (k->>'apuntes')::int <> 26 or (k->>'debe')::numeric <> 11499 or (k->>'haber')::numeric <> 11499
     or (k->>'casadas')::int <> 5 or (k->>'sin_casar')::int <> 0 or (k->>'facturas_recibidas')::int <> 3 or (k->>'facturas_emitidas')::int <> 2
     or (k->>'sin_tipo')::int <> 0 or (k->>'proveedores_nuevos')::int <> 4 or (k->>'clientes_nuevos')::int <> 1 then
    raise exception 'PRUEBA N06a · 2: las cifras no son las del LEEME: %.', k;
  end if;
  v_t := format('Traído en prueba: 10 asientos (26 apuntes, 11.499,00 al debe y al haber) y 5 facturas, 5 con su asiento. Nuevos en Sumied: %s cuentas, 4 proveedores y 1 cliente. Sumied empieza a llevar la contabilidad el 01/04/2026. Nada está validado: repásalo y dalo por bueno, o deshazlo.',
                k->>'cuentas_nuevas');
  if r->>'texto' is distinct from v_t then raise exception 'PRUEBA N06a · 2: el texto es «%».', r->>'texto'; end if;
  if public.conta_empresa_dia_de_inicio(c) is distinct from '2026-04-01' then
    raise exception 'PRUEBA N06a · 2: el día de inicio que lee la pantalla es %, no el 01/04/2026.', public.conta_empresa_dia_de_inicio(c);
  end if;
  raise notice 'PRUEBA N06a · 2: %', r->>'texto';
end $$;
reset role;
do $$
declare c uuid := current_setting('n06a.empresa')::uuid; v_carga uuid := current_setting('n06a.carga')::uuid; v text;
begin
  -- Los asientos: en borrador, con su serie y su número de ERP10, atados a la carga.
  if (select count(*) from public.journal_entry where import_run_id = v_carga and status = 'borrador' and source_type = 'migrated' and external_program = 'ERP10'
        and number is null and external_number is not null) <> 10
     or (select count(*) from public.journal_line l join public.journal_entry e on e.id = l.entry_id where e.import_run_id = v_carga) <> 27 then
    raise exception 'PRUEBA N06a · 2: los asientos traídos no son 10 borradores de ERP10 con 27 apuntes en Sumied.';
  end if;
  -- La B-7: su 472 de 41,00 son 21,00 al 21 % (base 100,00) y 20,00 al 10 % (base 200,00); la ALQ-3, su retención del 19 % de alquiler.
  select string_agg(l.debit || '@' || r.rate || '/' || l.tax_base, ' ' order by r.rate desc) into v
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.tax_rate r on r.id = l.tax_rate_id
   where e.import_run_id = v_carga and e.external_series = '2' and e.external_number = '2';
  if v is distinct from '21.00@21.00/100.00 20.00@10.00/200.00' then raise exception 'PRUEBA N06a · 2: el IVA de la B-7 es «%».', v; end if;
  select w.code || ' ' || l.withholding_base || ' ' || l.withholding_model into v
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.withholding_rate w on w.id = l.withholding_rate_id
   where e.import_run_id = v_carga and e.external_series = '2' and e.external_number = '3';
  if v is distinct from 'alquiler 1000.00 115' then raise exception 'PRUEBA N06a · 2: la retención de la ALQ-3 es «%».', v; end if;
  -- Las facturas: pagadas y pendientes por el saldo, casadas, sin pagos ni vencimientos.
  select string_agg(n || ':' || s || ':' || p, ' ' order by n) into v from (
    select invoice_number n, status s, round(import_pending, 2)::text p from public.supplier_invoice
     where import_run_id = v_carga and source = 'traida' and journal_entry_id is not null and import_mark is null
       and payment_entry_id is null and paid_at is null and due_date is null and not vat_non_deductible
    union all
    select number_text, status, round(import_pending, 2)::text from public.customer_invoice
     where import_run_id = v_carga and origin = 'traida' and entry_id is not null and import_mark is null) f;
  if v is distinct from 'A-10:pagada:0.00 ALQ-3:aprobada:1020.00 B-7:aprobada:341.00 F-1:emitida:0.00 F-2:emitida:550.00' then
    raise exception 'PRUEBA N06a · 2: las facturas traídas son «%».', v;
  end if;
  if (select (origin, origin_program, imported_until)::text from public.fiscal_year where company_id = c and code = '2026') <> '(mixed,ERP10,2026-03-31)' then
    raise exception 'PRUEBA N06a · 2: el ejercicio 2026 no ha quedado traído hasta el 31/03.';
  end if;
  -- Lo aprendido, como propuesta en la ficha (no a mano).
  if (select string_agg(s.etiqueta, ' | ' order by s.etiqueta) from public.supplier_learning s join public.supplier p on p.id = s.supplier_id
       where p.import_run_id = v_carga and s.campo = 'tax_rates' and not s.a_mano) is distinct from 'IVA al 10 % y al 21 % | IVA al 21 % | IVA al 21 %' then
    raise exception 'PRUEBA N06a · 2: lo aprendido no es lo esperado.';
  end if;
  -- Una carga es una: la madre y una lectura por fichero.
  if (select count(*) from public.import_run where parent_id = v_carga) <> 8 then
    raise exception 'PRUEBA N06a · 2: la carga no tiene sus 8 lecturas.';
  end if;
end $$;

-- 3 · Lo traído no se valida a mano, no se le propone asiento y no genera nada -------------------------
set local role authenticated;
do $$
declare c uuid := current_setting('n06a.empresa')::uuid; v_carga uuid := current_setting('n06a.carga')::uuid; v uuid; v_msg text; v_hint text;
begin
  select id into v from public.journal_entry where import_run_id = v_carga order by entry_date limit 1;
  begin
    perform public.journal_entry_validar(v, 'Prueba N06a');
    raise exception 'PRUEBA N06a · 3: un asiento de la carga en prueba se ha validado a mano.';
  exception when check_violation then get stacked diagnostics v_msg = message_text;
  end;
  if v_msg not like '%Este asiento es de lo traído que está en prueba: se valida todo junto al darlo por bueno.%' then
    raise exception 'PRUEBA N06a · 3: el motivo es «%».', v_msg;
  end if;
  select id into v from public.supplier_invoice where import_run_id = v_carga and invoice_number = 'B-7';
  begin
    perform public.journal_entry_proponer(c, jsonb_build_object('series', 2, 'fecha', '2026-02-05', 'concepto', 'Otra vez', 'source_type', 'supplier_invoice',
      'source_id', v, 'confianza', 'seguro', 'porque', 'Prueba N06a'),
      '[{"cuenta":"60000000","debe":341,"haber":0},{"cuenta":"40000000","debe":0,"haber":341}]', null, 'Prueba N06a');
    raise exception 'PRUEBA N06a · 3: a una factura traída se le ha propuesto otro asiento.';
  exception when check_violation then get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'factura_traida' then raise exception 'PRUEBA N06a · 3: al proponer otro asiento a una traída: «%».', v_msg; end if;
end $$;
reset role;
do $$
declare c uuid := current_setting('n06a.empresa')::uuid; v_carga uuid := current_setting('n06a.carga')::uuid;
begin
  perform public._conta_facturas_apuntar(c);
  if exists (select 1 from public.journal_entry e join public.supplier_invoice i on i.id = e.source_id
              where e.source_type = 'supplier_invoice' and i.import_run_id = v_carga) then
    raise exception 'PRUEBA N06a · 3: la pasada de las recibidas ha propuesto asiento a una traída.';
  end if;
  if exists (select 1 from public.document_activity a join public.supplier_invoice i on i.id = a.supplier_invoice_id where i.import_run_id = v_carga)
     or exists (select 1 from public.supplier_invoice_auto a join public.supplier_invoice i on i.id = a.invoice_id where i.import_run_id = v_carga) then
    raise exception 'PRUEBA N06a · 3: una factura traída ha generado actividad o avisos.';
  end if;
end $$;

-- 4 · No dos a la vez; otra cuenta no la ve; «Dejarlas fuera» ------------------------------------------
set local role authenticated;
do $$
declare c uuid := current_setting('n06a.empresa')::uuid; v_msg text; v_carga uuid := current_setting('n06a.carga')::uuid; r jsonb; v uuid;
begin
  begin
    perform public.conta_traer_cargar(c, null, current_setting('n06a.datos')::jsonb, 'Prueba N06a');
    raise exception 'PRUEBA N06a · 4: se han traído dos cargas a la vez.';
  exception when check_violation then get stacked diagnostics v_msg = message_text;
  end;
  if v_msg is distinct from format('Ya hay una carga en prueba de esta empresa, del %s. Dala por buena o deshazla antes de traer otra.', to_char(now() at time zone 'Europe/Madrid', 'DD/MM')) then
    raise exception 'PRUEBA N06a · 4: el motivo es «%».', v_msg;
  end if;
  select id into v from public.customer_invoice where import_run_id = v_carga and number_text = 'F-2';
  r := public.conta_traer_dejar_fuera(v_carga, array[v], true);
  if r->>'texto' is distinct from 'Dejadas fuera 1 factura: siguen en la carga, marcadas «Fuera de esta carga», y no se darán por buenas con ella.'
     or (select import_mark from public.customer_invoice where id = v) is distinct from 'fuera' then
    raise exception 'PRUEBA N06a · 4: dejar fuera: «%».', r->>'texto';
  end if;
  r := public.conta_traer_dejar_fuera(v_carga, array[v], false);
  if (select import_mark from public.customer_invoice where id = v) is not null then raise exception 'PRUEBA N06a · 4: la F-2 no vuelve a la carga.'; end if;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
do $$
declare v_carga uuid := current_setting('n06a.carga')::uuid; v_msg text;
begin
  if exists (select 1 from public.journal_entry where import_run_id = v_carga) or exists (select 1 from public.import_run where id = v_carga)
     or exists (select 1 from public.supplier_invoice where import_run_id = v_carga) then
    raise exception 'PRUEBA N06a · 4: la cuenta B ve la carga de la cuenta A.';
  end if;
  begin
    perform public.conta_traer_deshacer(v_carga, 'Prueba N06a');
    raise exception 'PRUEBA N06a · 4: la cuenta B ha deshecho la carga de la cuenta A.';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

-- 5 · Deshacer: idéntica a antes; traer otra vez y deshacer otra vez ------------------------------------
do $$
declare r jsonb;
begin
  r := public.conta_traer_deshacer(current_setting('n06a.carga')::uuid, 'Prueba N06a');
  if r->>'texto' !~ '^Deshecho: se han quitado 10 asientos, 5 facturas, [0-9]+ cuentas, 4 proveedores y 1 cliente que trajo la carga\. El día de inicio vuelve a estar sin fijar\.$' then
    raise exception 'PRUEBA N06a · 5: el texto es «%».', r->>'texto';
  end if;
  raise notice 'PRUEBA N06a · 5: %', r->>'texto';
end $$;
reset role;
select pg_temp.medir('deshecha');
select pg_temp.iguales('antes', 'deshecha', '5 (deshacer)') as deshacer;
do $$
begin
  if (select status || ' · ' || (detail->'deshecha'->>'por') from public.import_run where id = current_setting('n06a.carga')::uuid) <> 'deshecha · Prueba N06a' then
    raise exception 'PRUEBA N06a · 5: la carga no queda deshecha con quién.';
  end if;
end $$;
set local role authenticated;
do $$
declare c uuid := current_setting('n06a.empresa')::uuid; r jsonb; v_msg text; v_vieja uuid := current_setting('n06a.carga')::uuid;
begin
  r := public.conta_traer_cargar(c, null, current_setting('n06a.datos')::jsonb, 'Prueba N06a');
  if (r->'cuentas'->>'asientos')::int <> 10 or (r->'cuentas'->>'debe')::numeric <> 11499 or (r->'cuentas'->>'casadas')::int <> 5 then
    raise exception 'PRUEBA N06a · 5: la segunda vez no trae lo mismo: %.', r->'cuentas';
  end if;
  perform public.conta_traer_deshacer((r->>'carga')::uuid, 'Prueba N06a');
  begin
    perform public.conta_traer_deshacer(v_vieja, 'Prueba N06a');
    raise exception 'PRUEBA N06a · 5: una carga deshecha se ha deshecho otra vez.';
  exception when check_violation then get stacked diagnostics v_msg = message_text;
  end;
  if v_msg !~ '^Esta carga ya está deshecha \(el [0-9/]+, por Prueba N06a\)\.$' then raise exception 'PRUEBA N06a · 5: el motivo es «%».', v_msg; end if;
end $$;
reset role;
select pg_temp.medir('otra_vez');
select pg_temp.iguales('antes', 'otra_vez', '5 (traer otra vez y deshacer)') as otra_vez;

-- 6 · El ensayo de la regla 10 -------------------------------------------------------------------------
-- Con día de inicio (traída a medias de ERP10 hasta el 31/10) y la decisión de trabajar sin lo anterior.
set local role authenticated;
do $$
declare c uuid := current_setting('n06a.empresa')::uuid;
begin
  perform public.conta_fijar_corte(c, '2026-10-31', 'erp10');
  perform public.conta_trabajar_sin_historico(c, '2026', 'Prueba N06a');
  if public.conta_empresa_dia_de_inicio(c) is distinct from '2026-11-01' then raise exception 'PRUEBA N06a · 6: el día de inicio no es el 01/11/2026.'; end if;
end $$;
reset role;
select pg_temp.medir('antes_r10');
set local role authenticated;
do $$
declare
  c uuid := current_setting('n06a.empresa')::uuid; r jsonb; d jsonb := current_setting('n06a.datos')::jsonb; v uuid; v_i uuid; v_iva uuid; v_e public.journal_entry;
begin
  -- El ejemplo, con un asiento más del 03/11 (de Sumied en adelante: se deja fuera).
  d := jsonb_set(d, '{asientos}', (d->'asientos') || jsonb_build_object('clave', '3.9', 'serie', '3', 'documento', '9', 'fecha', '2026-11-03', 'concepto', 'Del 03/11',
         'apuntesLeidos', 2, 'apuntes', jsonb_build_array(jsonb_build_object('cuenta', '62900000', 'nombre', 'Otros', 'concepto', 'Del 03/11', 'debe', 1000, 'haber', 0),
                                                        jsonb_build_object('cuenta', '57200001', 'nombre', 'Banco', 'concepto', 'Del 03/11', 'debe', 0, 'haber', 1000))));
  r := public.conta_traer_cargar(c, '2026', d, 'Prueba N06a');
  perform set_config('n06a.carga_r10', r->>'carga', true);
  if r->>'texto' !~ 'Del 01/11/2026 en adelante lo lleva ya Sumied: se han dejado fuera 1 asiento y 0 facturas\.' or (r->'cuentas'->>'asientos')::int <> 10 then
    raise exception 'PRUEBA N06a · 6: traer con día de inicio: «%».', r->>'texto';
  end if;
  -- Con la carga en prueba: un asiento a mano del 05/11 y una recibida del 06/11, validados de verdad.
  r := public.journal_entry_proponer(c, jsonb_build_object('series', 3, 'fecha', '2026-11-05', 'concepto', 'Prueba N06a · nuevo', 'source_type', 'manual',
         'confianza', 'seguro', 'porque', 'Prueba N06a'),
         '[{"cuenta":"62900000","debe":100,"haber":0,"comun":true},{"cuenta":"57200000","debe":0,"haber":100,"comun":true}]', null, 'Prueba N06a');
  v := (r->>'id')::uuid;
  perform public.journal_entry_validar(v, 'Prueba N06a');
  perform set_config('n06a.nuevo1', v::text, true);
  select id into v_iva from public.tax_rate where rate = 21 and treatment = 'taxed' and valid_to is null and name like 'IVA%' limit 1;
  insert into public.supplier_invoice (account_id, company_id, invoice_number, invoice_date, status, source, grand_total, tax_base_total, tax_total, created_by_name)
  values ('c01a0000-0000-4000-8000-00000000000a', c, 'N06A-1', '2026-11-06', 'en_revision', 'manual', 121, 100, 21, 'Prueba N06a') returning id into v_i;
  perform set_config('n06a.nueva_recibida', v_i::text, true);
  r := public.journal_entry_proponer(c, jsonb_build_object('series', 2, 'fecha', '2026-11-06', 'concepto', 'Prueba N06a · recibida', 'source_type', 'supplier_invoice',
         'source_id', v_i, 'confianza', 'seguro', 'porque', 'Prueba N06a'),
         jsonb_build_array(jsonb_build_object('cuenta', '60000000', 'debe', 100, 'haber', 0, 'comun', true),
           jsonb_build_object('cuenta', '47200000', 'debe', 21, 'haber', 0, 'comun', true,
             'iva', jsonb_build_object('tipo_id', v_iva, 'base', 100, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
           jsonb_build_object('cuenta', '40000000', 'debe', 0, 'haber', 121, 'comun', true)), null, 'Prueba N06a');
  v := (r->>'id')::uuid;
  perform public.journal_entry_validar(v, 'Prueba N06a');
  perform set_config('n06a.nuevo2', v::text, true);
end $$;
reset role;
do $$
declare v_1 public.journal_entry; v_2 public.journal_entry;
begin
  insert into n06a_fuera values (current_setting('n06a.nuevo1')::uuid), (current_setting('n06a.nuevo2')::uuid), (current_setting('n06a.nueva_recibida')::uuid);
  select * into v_1 from public.journal_entry where id = current_setting('n06a.nuevo1')::uuid;
  select * into v_2 from public.journal_entry where id = current_setting('n06a.nuevo2')::uuid;
  if v_1.status <> 'validado' or v_2.status <> 'validado' or v_1.hash = 'pendiente' or v_2.hash = 'pendiente' then
    raise exception 'PRUEBA N06a · 6: los dos nuevos no han quedado validados con la carga en prueba.';
  end if;
  perform set_config('n06a.nuevos', (select jsonb_agg(to_jsonb(e) - 'updated_at' order by e.id)::text from public.journal_entry e where e.id in (v_1.id, v_2.id)), true);
  perform set_config('n06a.nuevos_apuntes', (select md5(string_agg(to_jsonb(l)::text, '|' order by l.id)) from public.journal_line l where l.entry_id in (v_1.id, v_2.id)), true);
end $$;
set local role authenticated;
select (public.conta_traer_deshacer(current_setting('n06a.carga_r10')::uuid, 'Prueba N06a'))->>'texto' as deshacer_r10;
reset role;
select pg_temp.medir('despues_r10');
do $$
declare v_t text;
begin
  v_t := pg_temp.iguales('antes_r10', 'despues_r10', '6 (regla 10)');
  if (select jsonb_agg(to_jsonb(e) - 'updated_at' order by e.id)::text from public.journal_entry e
       where e.id in (current_setting('n06a.nuevo1')::uuid, current_setting('n06a.nuevo2')::uuid)) is distinct from current_setting('n06a.nuevos')
     or (select md5(string_agg(to_jsonb(l)::text, '|' order by l.id)) from public.journal_line l
          where l.entry_id in (current_setting('n06a.nuevo1')::uuid, current_setting('n06a.nuevo2')::uuid)) is distinct from current_setting('n06a.nuevos_apuntes') then
    raise exception 'PRUEBA N06a · 6: los dos asientos nuevos no han quedado intactos.';
  end if;
  if public.conta_dia_de_inicio(current_setting('n06a.empresa')::uuid) is distinct from '2026-11-01' then
    raise exception 'PRUEBA N06a · 6: deshacer ha tocado el día de inicio, que la carga no fijó.';
  end if;
  raise notice 'PRUEBA N06a · 6: la empresa como antes de traer (%), con sus dos asientos nuevos validados intactos (huella y apuntes).', v_t;
end $$;
select 'PRUEBA N06a: 0 a 6 bien' as resultado;
rollback;
