-- supabase/staging/sql/20261119_n09_pagos_lee_lo_traido_prueba.sql
--
-- SOLO STAGING. Prueba del N09 (20261119T0800_n09_pagos_lee_lo_traido), que el ensayo de staging pone
-- delante en la misma sesión. Todo en una transacción con ROLLBACK: staging no cambia. Datos INVENTADOS
-- (T11): el ejemplo de ERP10 del repositorio con un «Pago B-7» de 100,00 más (la B-7, con pago parcial),
-- tal como lo manda la pantalla (paraLaBase de leerCarga con el casado del N09; tests/conta/n09/regla10.sql
-- lleva la misma carga). Nombra los objetos que cambian: public.conta_recibida_pago,
-- public.bank_facturas_para_casar y public.bank_facturas_recibidas_pendientes.
--
--   1. Se trae y se da por bueno en la primera empresa de la cuenta A sin nada traído, y se apunta una
--      recibida normal de hoy (aprobada, 242,00, con 42,00 pagados en Sumied: un pago parcial de hoy).
--   2. LA REGLA 10, POR SUS CAMINOS: Pagos (conta_pagos_lista y la vista), Bancos (la propuesta de casar
--      un movimiento y las pendientes), el pago a mano (lo que le queda, _conta_pago_pendiente) y Cobros,
--      como los lee la pantalla (como el administrador a1 de la cuenta A), con la versión nueva, con la de
--      antes (la vuelta atrás) y otra vez con la nueva.
--   3. REGLA 31: la recibida normal de hoy, y todas las que no son traídas de todas las cuentas (la huella
--      de «esto no se ha movido», de tabla entera a propósito, regla 9), salen IGUAL con las dos versiones.
--      Las traídas: la B-7 241,00 (antes 341,00) y el alquiler 1.020,00 (antes 1.210,00, con la retención).
--
-- con usuario: el 2 se hace con «set local role authenticated», como el administrador a1 de la cuenta A.
-- Lo demás, como el dueño con los datos del administrador a1 (las funciones lo comprueban con auth.uid).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA N09: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

select set_config('n09.datos', $carga${"version":1,"programa":"erp10","ficheros":[{"tipo":"proveedores","nombre":"proveedores.xlsx","haLeido":"4 fichas"},{"tipo":"clientes","nombre":"clientes.xlsx","haLeido":"1 ficha"},{"tipo":"inmovilizado","nombre":"inmovilizado.xlsx","haLeido":"1 elemento"},{"tipo":"plan_cuentas","nombre":"plan_de_cuentas.xlsx","haLeido":"16 cuentas"},{"tipo":"diario","nombre":"diario.xlsx","haLeido":"11 asientos · 28 apuntes"},{"tipo":"expedidas","nombre":"libro_expedidas.xlsx","haLeido":"2 facturas"},{"tipo":"recibidas","nombre":"libro_recibidas.xlsx","haLeido":"3 facturas"},{"tipo":"sumas_saldos","nombre":"sumas_y_saldos.xlsx","haLeido":"15 cuentas"}],"largos":[8],"cuentas":[{"codigo":"10000000","nombre":"Capital social"},{"codigo":"21600000","nombre":"Mobiliario"},{"codigo":"28160000","nombre":"Amortización acumulada de mobiliario"},{"codigo":"40000000","nombre":"Proveedores varios"},{"codigo":"40000001","nombre":"Proveedor Ejemplo Uno, S.L."},{"codigo":"40000002","nombre":"Proveedor Ejemplo Dos, S.A."},{"codigo":"41000001","nombre":"Arrendador Ejemplo"},{"codigo":"43000001","nombre":"Cliente Ejemplo Uno, S.L."},{"codigo":"47200000","nombre":"H.P. IVA soportado"},{"codigo":"47510000","nombre":"H.P. acreedora por retenciones"},{"codigo":"47700000","nombre":"H.P. IVA repercutido"},{"codigo":"57200001","nombre":"Banco de ejemplo"},{"codigo":"60000000","nombre":"Compras de mercaderías"},{"codigo":"62100000","nombre":"Arrendamientos"},{"codigo":"68100000","nombre":"Amortización del inmovilizado material"},{"codigo":"70000000","nombre":"Ventas de mercaderías"}],"terceros":[{"clase":"proveedor","codigo":"40000000","nombre":"Proveedores varios","nombreComercial":"","nif":null},{"clase":"proveedor","codigo":"40000001","nombre":"Proveedor Ejemplo Uno, S.L.","nombreComercial":"Ejemplo Uno","nif":"B00000000"},{"clase":"proveedor","codigo":"40000002","nombre":"Proveedor Ejemplo Dos, S.A.","nombreComercial":"Ejemplo Dos","nif":"A00000000"},{"clase":"proveedor","codigo":"41000001","nombre":"Arrendador Ejemplo","nombreComercial":"Arrendador Ejemplo","nif":"12345678Z"},{"clase":"cliente","codigo":"43000001","nombre":"Cliente Ejemplo Uno, S.L.","nombreComercial":"Cliente Uno","nif":"B12345678"}],"asientos":[{"clave":"3.1","serie":"3","documento":"1","fecha":"2026-01-02","concepto":"Aportación inicial","apuntesLeidos":2,"apuntes":[{"cuenta":"57200001","nombre":"Banco de ejemplo","concepto":"Aportación inicial","debe":500000,"haber":0},{"cuenta":"10000000","nombre":"Capital social","concepto":"Aportación inicial","debe":0,"haber":500000}]},{"clave":"3.2","serie":"3","documento":"2","fecha":"2026-01-05","concepto":"Compra de mobiliario","apuntesLeidos":2,"apuntes":[{"cuenta":"21600000","nombre":"Mobiliario","concepto":"Compra de mobiliario","debe":120000,"haber":0},{"cuenta":"57200001","nombre":"Banco de ejemplo","concepto":"Compra de mobiliario","debe":0,"haber":120000}]},{"clave":"1.1","serie":"1","documento":"1","fecha":"2026-01-15","concepto":"F-1-Cliente Ejemplo Uno","apuntesLeidos":3,"apuntes":[{"cuenta":"43000001","nombre":"Cliente Ejemplo Uno, S.L.","concepto":"F-1-Cliente Ejemplo Uno","debe":110000,"haber":0},{"cuenta":"70000000","nombre":"Ventas de mercaderías","concepto":"F-1-Cliente Ejemplo Uno","debe":0,"haber":100000},{"cuenta":"47700000","nombre":"H.P. IVA repercutido","concepto":"F-1-Cliente Ejemplo Uno","debe":0,"haber":10000,"iva":{"tipo":10,"base":100000,"libro":"issued"}}]},{"clave":"2.1","serie":"2","documento":"1","fecha":"2026-01-20","concepto":"A-10-Proveedor Ejemplo Uno","apuntesLeidos":3,"apuntes":[{"cuenta":"60000000","nombre":"Compras de mercaderías","concepto":"A-10-Proveedor Ejemplo Uno","debe":40000,"haber":0},{"cuenta":"47200000","nombre":"H.P. IVA soportado","concepto":"A-10-Proveedor Ejemplo Uno","debe":8400,"haber":0,"iva":{"tipo":21,"base":40000,"libro":"received"}},{"cuenta":"40000001","nombre":"Proveedor Ejemplo Uno, S.L.","concepto":"A-10-Proveedor Ejemplo Uno","debe":0,"haber":48400}]},{"clave":"3.3","serie":"3","documento":"3","fecha":"2026-01-31","concepto":"Cobro F-1","apuntesLeidos":2,"apuntes":[{"cuenta":"57200001","nombre":"Banco de ejemplo","concepto":"Cobro F-1","debe":110000,"haber":0},{"cuenta":"43000001","nombre":"Cliente Ejemplo Uno, S.L.","concepto":"Cobro F-1","debe":0,"haber":110000}]},{"clave":"2.2","serie":"2","documento":"2","fecha":"2026-02-05","concepto":"B-7-Proveedor Ejemplo Dos","apuntesLeidos":3,"apuntes":[{"cuenta":"60000000","nombre":"Compras de mercaderías","concepto":"B-7-Proveedor Ejemplo Dos","debe":30000,"haber":0},{"cuenta":"47200000","nombre":"H.P. IVA soportado","concepto":"B-7-Proveedor Ejemplo Dos","debe":2100,"haber":0,"iva":{"tipo":21,"base":10000,"libro":"received"}},{"cuenta":"47200000","nombre":"H.P. IVA soportado","concepto":"B-7-Proveedor Ejemplo Dos","debe":2000,"haber":0,"iva":{"tipo":10,"base":20000,"libro":"received"}},{"cuenta":"40000002","nombre":"Proveedor Ejemplo Dos, S.A.","concepto":"B-7-Proveedor Ejemplo Dos","debe":0,"haber":34100}]},{"clave":"1.2","serie":"1","documento":"2","fecha":"2026-02-10","concepto":"F-2-Cliente Ejemplo Uno","apuntesLeidos":3,"apuntes":[{"cuenta":"43000001","nombre":"Cliente Ejemplo Uno, S.L.","concepto":"F-2-Cliente Ejemplo Uno","debe":55000,"haber":0},{"cuenta":"70000000","nombre":"Ventas de mercaderías","concepto":"F-2-Cliente Ejemplo Uno","debe":0,"haber":50000},{"cuenta":"47700000","nombre":"H.P. IVA repercutido","concepto":"F-2-Cliente Ejemplo Uno","debe":0,"haber":5000,"iva":{"tipo":10,"base":50000,"libro":"issued"}}]},{"clave":"3.4","serie":"3","documento":"4","fecha":"2026-02-28","concepto":"Pago A-10","apuntesLeidos":2,"apuntes":[{"cuenta":"40000001","nombre":"Proveedor Ejemplo Uno, S.L.","concepto":"Pago A-10","debe":48400,"haber":0},{"cuenta":"57200001","nombre":"Banco de ejemplo","concepto":"Pago A-10","debe":0,"haber":48400}]},{"clave":"2.3","serie":"2","documento":"3","fecha":"2026-03-01","concepto":"ALQ-3-Arrendador Ejemplo","apuntesLeidos":4,"apuntes":[{"cuenta":"62100000","nombre":"Arrendamientos","concepto":"ALQ-3-Arrendador Ejemplo","debe":100000,"haber":0},{"cuenta":"47200000","nombre":"H.P. IVA soportado","concepto":"ALQ-3-Arrendador Ejemplo","debe":21000,"haber":0,"iva":{"tipo":21,"base":100000,"libro":"received"}},{"cuenta":"47510000","nombre":"H.P. acreedora por retenciones","concepto":"ALQ-3-Arrendador Ejemplo","debe":0,"haber":19000,"retencion":{"tipo":19,"base":100000}},{"cuenta":"41000001","nombre":"Arrendador Ejemplo","concepto":"ALQ-3-Arrendador Ejemplo","debe":0,"haber":102000}]},{"clave":"3.5","serie":"3","documento":"5","fecha":"2026-03-31","concepto":"Amortización del trimestre","apuntesLeidos":2,"apuntes":[{"cuenta":"68100000","nombre":"Amortización del inmovilizado material","concepto":"Amortización del trimestre","debe":3000,"haber":0},{"cuenta":"28160000","nombre":"Amortización acumulada de mobiliario","concepto":"Amortización del trimestre","debe":0,"haber":3000}]},{"clave":"3.6","serie":"3","documento":"6","fecha":"2026-03-04","concepto":"Pago B-7","apuntesLeidos":2,"apuntes":[{"cuenta":"40000002","nombre":"Proveedor Ejemplo Dos, S.A.","concepto":"Pago B-7","debe":10000,"haber":0},{"cuenta":"57200001","nombre":"Banco de ejemplo","concepto":"Pago B-7","debe":0,"haber":10000}]}],"facturas":[{"libro":"recibidas","numero":"A-10","serie":null,"numeroSolo":null,"fecha":"2026-01-20","operacion":null,"periodo":"1T","ejercicio":"2026","nif":"B00000000","nombre":"Proveedor Ejemplo Uno, S.L.","tramos":[{"base":40000,"tipo":21,"cuota":8400}],"base":40000,"cuota":8400,"total":48400,"retencion":null,"asiento":"2.1|2026-01-20","pendiente":0},{"libro":"recibidas","numero":"B-7","serie":null,"numeroSolo":null,"fecha":"2026-02-05","operacion":null,"periodo":"1T","ejercicio":"2026","nif":"A00000000","nombre":"Proveedor Ejemplo Dos, S.A.","tramos":[{"base":10000,"tipo":21,"cuota":2100},{"base":20000,"tipo":10,"cuota":2000}],"base":30000,"cuota":4100,"total":34100,"retencion":null,"asiento":"2.2|2026-02-05","pendiente":24100},{"libro":"recibidas","numero":"ALQ-3","serie":null,"numeroSolo":null,"fecha":"2026-03-01","operacion":null,"periodo":"1T","ejercicio":"2026","nif":"12345678Z","nombre":"Arrendador Ejemplo","tramos":[{"base":100000,"tipo":21,"cuota":21000}],"base":100000,"cuota":21000,"total":121000,"retencion":{"tipo":19,"importe":19000},"asiento":"2.3|2026-03-01","pendiente":102000},{"libro":"expedidas","numero":"F-1","serie":"F","numeroSolo":"1","fecha":"2026-01-15","operacion":null,"periodo":"1T","ejercicio":"2026","nif":"B12345678","nombre":"Cliente Ejemplo Uno, S.L.","tramos":[{"base":100000,"tipo":10,"cuota":10000}],"base":100000,"cuota":10000,"total":110000,"retencion":null,"asiento":"1.1|2026-01-15","pendiente":0},{"libro":"expedidas","numero":"F-2","serie":"F","numeroSolo":"2","fecha":"2026-02-10","operacion":null,"periodo":"1T","ejercicio":"2026","nif":"B12345678","nombre":"Cliente Ejemplo Uno, S.L.","tramos":[{"base":50000,"tipo":10,"cuota":5000}],"base":50000,"cuota":5000,"total":55000,"retencion":null,"asiento":"1.2|2026-02-10","pendiente":55000}],"aprendido":[{"codigo":"40000001","gasto":{"cuenta":"60000000","nombre":"Compras de mercaderías"},"tiposIva":[21],"retencion":null,"porque":"Su factura del diario va a Compras de mercaderías · 60000000, con IVA al 21 %."},{"codigo":"40000002","gasto":{"cuenta":"60000000","nombre":"Compras de mercaderías"},"tiposIva":[10,21],"retencion":null,"porque":"Su factura del diario va a Compras de mercaderías · 60000000, con IVA al 10 % y al 21 %."},{"codigo":"41000001","gasto":{"cuenta":"62100000","nombre":"Arrendamientos"},"tiposIva":[21],"retencion":19,"porque":"Su factura del diario va a Arrendamientos · 62100000, con IVA al 21 % y una retención del 19 %."}],"pendientesNoExactos":[],"raros":[{"que":"sin_nif","cuentas":["40000000"],"nif":null,"frase":"40000000 · Proveedores varios: no trae NIF."}],"sumas":[{"cuenta":"10000000","nombre":"Capital social","debe":0,"haber":500000},{"cuenta":"21600000","nombre":"Mobiliario","debe":120000,"haber":0},{"cuenta":"28160000","nombre":"Amortización acumulada de mobiliario","debe":0,"haber":3000},{"cuenta":"40000001","nombre":"Proveedor Ejemplo Uno, S.L.","debe":48400,"haber":48400},{"cuenta":"40000002","nombre":"Proveedor Ejemplo Dos, S.A.","debe":10000,"haber":34100},{"cuenta":"41000001","nombre":"Arrendador Ejemplo","debe":0,"haber":102000},{"cuenta":"43000001","nombre":"Cliente Ejemplo Uno, S.L.","debe":165000,"haber":110000},{"cuenta":"47200000","nombre":"H.P. IVA soportado","debe":33500,"haber":0},{"cuenta":"47510000","nombre":"H.P. acreedora por retenciones","debe":0,"haber":19000},{"cuenta":"47700000","nombre":"H.P. IVA repercutido","debe":0,"haber":15000},{"cuenta":"57200001","nombre":"Banco de ejemplo","debe":610000,"haber":178400},{"cuenta":"60000000","nombre":"Compras de mercaderías","debe":70000,"haber":0},{"cuenta":"62100000","nombre":"Arrendamientos","debe":100000,"haber":0},{"cuenta":"68100000","nombre":"Amortización del inmovilizado material","debe":3000,"haber":0},{"cuenta":"70000000","nombre":"Ventas de mercaderías","debe":0,"haber":150000}],"inmovilizado":{"aFecha":"2026-03-31","elementos":[{"codigo":"1","subcuenta":"21600000","descripcion":"Mobiliario de ejemplo","compra":"2026-01-05","baja":null,"precio":120000,"amortizado":3000,"valorContable":117000,"amortizacionFiscal":3000}],"totales":{"precio":120000,"amortizado":3000,"valorContable":117000,"amortizacionFiscal":3000},"avisos":[]},"frases":["40000000 · Proveedores varios: no trae NIF."]}$carga$, true) is not null as datos;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

-- 1 · La empresa, lo traído (dado por bueno) y la recibida normal de hoy ---------------------------------
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; r jsonb; v_carga uuid; v_sup uuid; v_hoy uuid; n int;
begin
  select co.id into c from public.company co
   where co.account_id = v_acc and not exists (select 1 from public.journal_entry e where e.company_id = co.id and e.source_type = 'migrated')
     and (select account_digits from public.company_tax_profile where company_id = co.id) = 8
   order by co.created_at, co.id limit 1;
  if c is null then raise exception 'PRUEBA N09: la cuenta A no tiene ninguna empresa de 8 dígitos sin nada traído.'; end if;
  perform set_config('n09.empresa', c::text, true);
  if not exists (select 1 from public.fiscal_year where company_id = c and starts_on = '2026-01-01' and ends_on = '2026-12-31') then
    if exists (select 1 from public.fiscal_year where company_id = c and starts_on <= '2026-12-31' and ends_on >= '2026-01-01') then
      raise exception 'PRUEBA N09: el ejercicio de 2026 de la empresa no va del 01/01 al 31/12.';
    end if;
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31');
  end if;
  update public.bank_settings set cutover_date = null where company_id = c;
  perform public.conta_fijar_corte(c, null, 'erp10');
  update public.fiscal_year set history_imported_at = null, works_without_history_at = null where company_id = c;
  -- Staging lo usan las e2e: las cuentas de terceros del ejemplo, sueltas aquí (dentro del ROLLBACK), como el N06b.
  delete from public.company_account_link l using public.company_account a
   where a.id = l.company_account_id and l.company_id = c and l.role = 'principal'
     and a.code in ('40000000', '40000001', '40000002', '41000001', '43000001');
  r := public.conta_traer_cargar(c, '2026', current_setting('n09.datos')::jsonb, 'Prueba N09');
  v_carga := (r->>'carga')::uuid;
  perform set_config('n09.carga', v_carga::text, true);
  select count(*) into n from public.supplier_invoice where import_run_id = v_carga;
  if n <> 3 then raise exception 'PRUEBA N09 · 1: se han traído % recibidas, y el ejemplo trae 3 (¿ya estaban en la cuenta?).', n; end if;
  r := public.conta_traer_dar_por_bueno(v_carga, 'Prueba N09');
  raise notice 'PRUEBA N09 · 1: dado por bueno: %', r->>'texto';
  -- La recibida normal de hoy: aprobada, 242,00, de un proveedor de la cuenta, con 42,00 pagados en Sumied.
  select id into v_sup from public.supplier where account_id = v_acc order by created_at, id limit 1;
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, due_date, status, source, grand_total, tax_base_total, tax_total, created_by_name)
  values (v_acc, c, v_sup, 'N09-HOY-1', current_date, current_date + 30, 'aprobada', 'manual', 242, 200, 42, 'Prueba N09') returning id into v_hoy;
  insert into public.supplier_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, created_by_name)
  values (v_acc, c, v_hoy, current_date, 42, 'transfer', 'Prueba N09');
  perform set_config('n09.hoy', v_hoy::text, true);
end $$;

-- 2 · Lo que enseñan Pagos, Bancos, el pago a mano y Cobros (como la pantalla) ---------------------------
create or replace function pg_temp.medir() returns jsonb language sql as $f$
  with c as (select current_setting('n09.empresa')::uuid as id),
       traidas as (select si.id from public.supplier_invoice si where si.import_run_id = current_setting('n09.carga')::uuid)
  select jsonb_build_object(
    'vista', (select jsonb_object_agg(coalesce(si.invoice_number, si.id::text), jsonb_build_object('total', r.total, 'pagado', r.pagado, 'pendiente', r.pendiente, 'estado', r.estado))
                from public.conta_recibida_pago r join public.supplier_invoice si on si.id = r.invoice_id, c where r.company_id = c.id),
    'pagos', (select jsonb_object_agg(x->>'numero', jsonb_build_object('total', x->'total', 'pagado', x->'pagado', 'pendiente', x->'pendiente', 'estado', x->'estado'))
                from c, jsonb_array_elements(public.conta_pagos_lista(c.id, current_date)->'filas') x),
    'casar', (select jsonb_object_agg(coalesce(b.numero, b.id::text), (b.total - b.pagado)::numeric(14,2)) from c, public.bank_facturas_para_casar(c.id) b),
    'pendientes', (select jsonb_object_agg(coalesce(b.numero, b.id::text), (b.total - b.pagado)::numeric(14,2)) from c, public.bank_facturas_recibidas_pendientes(c.id) b),
    'cobros', (select jsonb_object_agg(ci.number_text, jsonb_build_object('pendiente', f.pendiente, 'estado', f.estado))
                 from public.conta_factura_cobro f join public.customer_invoice ci on ci.id = f.invoice_id, c where ci.import_run_id = current_setting('n09.carga')::uuid))
$f$;
-- Lo que le queda para el pago a mano (_conta_pago_pendiente, que la llama conta_pago_a_mano por dentro: no la ejecuta un
-- usuario, así que se mide como el dueño).
create or replace function pg_temp.a_mano() returns jsonb language sql as $f$
  select jsonb_build_object('a_mano', (select jsonb_object_agg(si.invoice_number, public._conta_pago_pendiente(si.id)) from public.supplier_invoice si
     where si.company_id = current_setting('n09.empresa')::uuid and si.status = 'aprobada'
       and (si.import_run_id = current_setting('n09.carga')::uuid or si.id = current_setting('n09.hoy')::uuid)))
$f$;
-- Todas las recibidas que no son traídas, de todas las cuentas (a propósito, regla 9: la huella de «no se ha movido»).
create or replace function pg_temp.huella_de_hoy() returns text language sql as $f$
  select count(*) || ' recibidas · ' || md5(coalesce(string_agg(r.invoice_id || '|' || r.total || '|' || r.pagado || '|' || r.pendiente || '|' || r.estado || '|' || coalesce(r.dias_vencida::text, ''), ',' order by r.invoice_id), ''))
    from public.conta_recibida_pago r join public.supplier_invoice si on si.id = r.invoice_id where si.source is distinct from 'traida'
$f$;

set local role authenticated;
select set_config('n09.nueva', pg_temp.medir()::text, true) is not null as con_lo_nuevo;
reset role;
select set_config('n09.nueva', (current_setting('n09.nueva')::jsonb || pg_temp.a_mano())::text, true) is not null as y_el_pago_a_mano;
select set_config('n09.huella_nueva', pg_temp.huella_de_hoy(), true) is not null as huella_con_lo_nuevo;
\i supabase/vuelta-atras/20261119T0800_n09_pagos_lee_lo_traido.down.sql
do $$ begin
  if strpos(pg_get_viewdef('public.conta_recibida_pago'::regclass), 'import_pending') > 0 or exists (select 1 from pg_proc where prosrc like '%N09 · lo pagado en el programa de antes%') then
    raise exception 'PRUEBA N09 · 2: la vuelta atrás no ha dejado la vista y las dos funciones como antes.';
  end if;
end $$;
set local role authenticated;
select set_config('n09.vieja', pg_temp.medir()::text, true) is not null as con_lo_de_antes;
reset role;
select set_config('n09.vieja', (current_setting('n09.vieja')::jsonb || pg_temp.a_mano())::text, true) is not null as y_el_pago_a_mano;
select set_config('n09.huella_vieja', pg_temp.huella_de_hoy(), true) is not null as huella_con_lo_de_antes;
\i supabase/migrations/20261119T0800_n09_pagos_lee_lo_traido.sql
set local role authenticated;
select set_config('n09.otra_vez', pg_temp.medir()::text, true) is not null as con_lo_nuevo_otra_vez;
reset role;
select set_config('n09.otra_vez', (current_setting('n09.otra_vez')::jsonb || pg_temp.a_mano())::text, true) is not null as y_el_pago_a_mano;

-- 3 · Las cifras, antes y después ------------------------------------------------------------------------
do $$
declare
  n jsonb := current_setting('n09.nueva')::jsonb; v jsonb := current_setting('n09.vieja')::jsonb; k text; x text;
  hoy constant text := 'N09-HOY-1';
begin
  if n is distinct from current_setting('n09.otra_vez')::jsonb then raise exception 'PRUEBA N09 · 3: la versión nueva no enseña lo mismo la segunda vez.'; end if;
  -- La recibida normal de hoy, igual en las cinco (regla 31), y las pegamos.
  foreach k in array array['vista', 'pagos', 'casar', 'pendientes', 'a_mano'] loop
    if n->k->hoy is distinct from v->k->hoy then raise exception 'PRUEBA N09 · 3: la recibida de hoy cambia en «%»: antes %, ahora %.', k, v->k->hoy, n->k->hoy; end if;
    raise notice 'PRUEBA N09 · 3: la recibida de hoy en «%»: antes % · después %', k, v->k->hoy, n->k->hoy;
  end loop;
  -- En Pagos y en el pago a mano le quedan 200,00 (242,00 − 42,00). Bancos solo descuenta lo casado en el banco, no un pago
  -- apuntado a mano: le da 242,00, hoy igual que antes (no es de este cambio; se dice en el PR).
  if (n->'vista'->hoy->>'pendiente')::numeric <> 200 or (n->'a_mano'->>hoy)::numeric <> 200 or (n->'casar'->>hoy)::numeric <> 242 then
    raise exception 'PRUEBA N09 · 3: la recibida de hoy: %.', jsonb_build_object('vista', n->'vista'->hoy, 'a_mano', n->'a_mano'->hoy, 'casar', n->'casar'->hoy);
  end if;
  -- Las demás que no son traídas, de todas las cuentas: la misma huella.
  if current_setting('n09.huella_nueva') <> current_setting('n09.huella_vieja') then
    raise exception 'PRUEBA N09 · 3: las recibidas que no son traídas cambian: antes %, después %.', current_setting('n09.huella_vieja'), current_setting('n09.huella_nueva');
  end if;
  raise notice 'PRUEBA N09 · 3: todas las cuentas · las recibidas que no son traídas en la vista de Pagos: antes % · después %', current_setting('n09.huella_vieja'), current_setting('n09.huella_nueva');
  -- En la empresa de la prueba, todo lo que no es traído, igual en cada lista.
  foreach k in array array['vista', 'pagos', 'casar', 'pendientes'] loop
    if (coalesce(n->k, '{}') - array['A-10', 'B-7', 'ALQ-3']) is distinct from (coalesce(v->k, '{}') - array['A-10', 'B-7', 'ALQ-3']) then
      raise exception 'PRUEBA N09 · 3: en «%» cambia algo que no es traído.', k;
    end if;
  end loop;
  -- Las traídas: la B-7 con pago parcial y el alquiler, lo que de verdad les queda.
  for x, k in select * from (values ('B-7', 'vista'), ('ALQ-3', 'vista'), ('B-7', 'pagos'), ('ALQ-3', 'pagos')) t loop
    raise notice 'PRUEBA N09 · 3: la traída % en «%»: antes % · después %', x, k, v->k->x->>'pendiente', n->k->x->>'pendiente';
  end loop;
  foreach k in array array['casar', 'pendientes', 'a_mano'] loop
    raise notice 'PRUEBA N09 · 3: «%»: B-7 antes % · después %; ALQ-3 antes % · después %', k, v->k->>'B-7', n->k->>'B-7', v->k->>'ALQ-3', n->k->>'ALQ-3';
  end loop;
  if (n->'vista'->'B-7'->>'pendiente')::numeric <> 241 or (n->'pagos'->'B-7'->>'pendiente')::numeric <> 241 or (n->'casar'->>'B-7')::numeric <> 241
     or (n->'pendientes'->>'B-7')::numeric <> 241 or (n->'a_mano'->>'B-7')::numeric <> 241
     or (n->'vista'->'B-7'->>'estado') <> 'pagada_parte' then
    raise exception 'PRUEBA N09 · 3: a la B-7 le quedan 241,00, con pago parcial: %.', jsonb_build_object('vista', n->'vista'->'B-7', 'casar', n->'casar'->'B-7', 'a_mano', n->'a_mano'->'B-7');
  end if;
  if (n->'vista'->'ALQ-3'->>'pendiente')::numeric <> 1020 or (n->'casar'->>'ALQ-3')::numeric <> 1020 or (n->'a_mano'->>'ALQ-3')::numeric <> 1020 then
    raise exception 'PRUEBA N09 · 3: al alquiler le quedan 1.020,00 (sin la retención): %.', n->'vista'->'ALQ-3';
  end if;
  if (v->'vista'->'B-7'->>'pendiente')::numeric <> 341 or (v->'vista'->'ALQ-3'->>'pendiente')::numeric <> 1210 then
    raise exception 'PRUEBA N09 · 3: con la versión de antes, la B-7 y el alquiler salían enteros (341,00 y 1.210,00): %.', v->'vista';
  end if;
  if (n->'vista'->'A-10'->>'estado') <> 'pagada' or n->'casar' ? 'A-10' then
    raise exception 'PRUEBA N09 · 3: la A-10, pagada en ERP10, no se paga ni se casa: %.', n->'vista'->'A-10';
  end if;
  -- Cobros: ya lo leía (N06b); igual con las dos.
  if n->'cobros' is distinct from v->'cobros' or (n->'cobros'->'F-2'->>'pendiente')::numeric <> 550 or (n->'cobros'->'F-1'->>'estado') <> 'cobrada' then
    raise exception 'PRUEBA N09 · 3: Cobros: antes %, después %.', v->'cobros', n->'cobros';
  end if;
  raise notice 'PRUEBA N09 · 3: Cobros, igual con las dos: %', n->'cobros';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);
rollback;
