-- supabase/staging/sql/20261117_n06b_darlo_por_bueno_prueba.sql
--
-- SOLO STAGING. Prueba del N06b (20261117T2224_n06b_programa_erp10, 2240_n06b_traida_sin_pagar,
-- 2241_n06b_serie_y_listas y 2242_n06b_darlo_por_bueno), que el ensayo de staging pone delante en la misma
-- sesión. Todo en una transacción con ROLLBACK: staging no cambia. Datos INVENTADOS: el ejemplo de ERP10 del
-- repositorio (tests/conta/fixtures/importar/erp10), leído por el módulo del N04 y pasado por paraLaBase,
-- ahora con su sumas y saldos (abajo, entre $carga$; una prueba unitaria comprueba que es exactamente eso),
-- en la primera empresa de la cuenta A sin nada traído. Nombra los objetos que cambian:
-- public.conta_programa_anterior, public.journal_entry, public.conta_pagos_lista,
-- public.bank_facturas_para_casar, public.bank_facturas_recibidas_pendientes,
-- public.banco_facturas_recibidas_pendientes, public.conta_documentos_recibidos, public.conta_factura_cobro,
-- public.conta_traer_cargar, public.conta_traer_deshacer y public.conta_traer_dejar_fuera.
--
--   0. Permisos.
--   1. Las seis listas que cambian, con la versión nueva, con la de antes (las cuatro vueltas atrás) y otra
--      vez la nueva: idénticas (regla 31). La empresa todavía no tiene nada traído.
--   2. Nadie apunta a mano en la serie de lo traído.
--   3. Solo las cuentas y los proveedores: se traen, se dan por buenos, no fijan ni cierran nada, y una
--      recibida que entró sin proveedor encuentra el suyo por el NIF, con su cuenta.
--   4. La carga entera, en prueba: reutiliza esas cuentas; sus asientos, en borrador en la serie 8; sus
--      emitidas no existen todavía; sus recibidas no salen en Pagos ni en Bancos (sí en Facturas recibidas,
--      «traida_en_prueba») y no se pagan, ni a mano ni con un pago apuntado.
--   5. Con un sumas y saldos que no cuadra no se da por bueno, y dice la cuenta; sin él, sí, y lo dice.
--   6. EL ENSAYO DE LA REGLA 10: con día de inicio (01/04/2026), trabajando sin lo anterior y con dos
--      asientos suyos validados después; trae, da por bueno (las cifras del LEEME, la serie 8 del 1 al 10, la
--      cadena, Pagos, Bancos y Cobros, el historial y los saldos de tres cuentas antes y después), y después
--      valida una recibida, paga una traída pendiente y cierra abril; y ya no se deshace.
--   7. La cuenta B no ve ni toca nada.
--   8. Las demás cuentas, tabla a tabla, iguales antes y después.
--
-- con usuario: el 1 (las listas, como las lee la pantalla), el 2 y el 7 se hacen con «set local role
-- authenticated», como el administrador a1 de la cuenta A o como b1 de la B. Lo demás, como el dueño con
-- los datos del administrador a1 (las funciones lo comprueban con auth.uid), para poder preparar y medir.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA N06b: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- El ejemplo de ERP10, como lo manda la pantalla (paraLaBase de leerCarga; importes en céntimos).
select set_config('n06b.datos', $carga${"version":1,"programa":"erp10","ficheros":[{"tipo":"proveedores","nombre":"proveedores.xlsx","haLeido":"4 fichas"},{"tipo":"clientes","nombre":"clientes.xlsx","haLeido":"1 ficha"},{"tipo":"inmovilizado","nombre":"inmovilizado.xlsx","haLeido":"1 elemento"},{"tipo":"plan_cuentas","nombre":"plan_de_cuentas.xlsx","haLeido":"16 cuentas"},{"tipo":"diario","nombre":"diario.xlsx","haLeido":"10 asientos · 26 apuntes"},{"tipo":"expedidas","nombre":"libro_expedidas.xlsx","haLeido":"2 facturas"},{"tipo":"recibidas","nombre":"libro_recibidas.xlsx","haLeido":"3 facturas"},{"tipo":"sumas_saldos","nombre":"sumas_y_saldos.xlsx","haLeido":"15 cuentas"}],"largos":[8],"cuentas":[{"codigo":"10000000","nombre":"Capital social"},{"codigo":"21600000","nombre":"Mobiliario"},{"codigo":"28160000","nombre":"Amortización acumulada de mobiliario"},{"codigo":"40000000","nombre":"Proveedores varios"},{"codigo":"40000001","nombre":"Proveedor Ejemplo Uno, S.L."},{"codigo":"40000002","nombre":"Proveedor Ejemplo Dos, S.A."},{"codigo":"41000001","nombre":"Arrendador Ejemplo"},{"codigo":"43000001","nombre":"Cliente Ejemplo Uno, S.L."},{"codigo":"47200000","nombre":"H.P. IVA soportado"},{"codigo":"47510000","nombre":"H.P. acreedora por retenciones"},{"codigo":"47700000","nombre":"H.P. IVA repercutido"},{"codigo":"57200001","nombre":"Banco de ejemplo"},{"codigo":"60000000","nombre":"Compras de mercaderías"},{"codigo":"62100000","nombre":"Arrendamientos"},{"codigo":"68100000","nombre":"Amortización del inmovilizado material"},{"codigo":"70000000","nombre":"Ventas de mercaderías"}],"terceros":[{"clase":"proveedor","codigo":"40000000","nombre":"Proveedores varios","nombreComercial":"","nif":null},{"clase":"proveedor","codigo":"40000001","nombre":"Proveedor Ejemplo Uno, S.L.","nombreComercial":"Ejemplo Uno","nif":"B00000000"},{"clase":"proveedor","codigo":"40000002","nombre":"Proveedor Ejemplo Dos, S.A.","nombreComercial":"Ejemplo Dos","nif":"A00000000"},{"clase":"proveedor","codigo":"41000001","nombre":"Arrendador Ejemplo","nombreComercial":"Arrendador Ejemplo","nif":"12345678Z"},{"clase":"cliente","codigo":"43000001","nombre":"Cliente Ejemplo Uno, S.L.","nombreComercial":"Cliente Uno","nif":"B12345678"}],"asientos":[{"clave":"3.1","serie":"3","documento":"1","fecha":"2026-01-02","concepto":"Aportación inicial","apuntesLeidos":2,"apuntes":[{"cuenta":"57200001","nombre":"Banco de ejemplo","concepto":"Aportación inicial","debe":500000,"haber":0},{"cuenta":"10000000","nombre":"Capital social","concepto":"Aportación inicial","debe":0,"haber":500000}]},{"clave":"3.2","serie":"3","documento":"2","fecha":"2026-01-05","concepto":"Compra de mobiliario","apuntesLeidos":2,"apuntes":[{"cuenta":"21600000","nombre":"Mobiliario","concepto":"Compra de mobiliario","debe":120000,"haber":0},{"cuenta":"57200001","nombre":"Banco de ejemplo","concepto":"Compra de mobiliario","debe":0,"haber":120000}]},{"clave":"1.1","serie":"1","documento":"1","fecha":"2026-01-15","concepto":"F-1-Cliente Ejemplo Uno","apuntesLeidos":3,"apuntes":[{"cuenta":"43000001","nombre":"Cliente Ejemplo Uno, S.L.","concepto":"F-1-Cliente Ejemplo Uno","debe":110000,"haber":0},{"cuenta":"70000000","nombre":"Ventas de mercaderías","concepto":"F-1-Cliente Ejemplo Uno","debe":0,"haber":100000},{"cuenta":"47700000","nombre":"H.P. IVA repercutido","concepto":"F-1-Cliente Ejemplo Uno","debe":0,"haber":10000,"iva":{"tipo":10,"base":100000,"libro":"issued"}}]},{"clave":"2.1","serie":"2","documento":"1","fecha":"2026-01-20","concepto":"A-10-Proveedor Ejemplo Uno","apuntesLeidos":3,"apuntes":[{"cuenta":"60000000","nombre":"Compras de mercaderías","concepto":"A-10-Proveedor Ejemplo Uno","debe":40000,"haber":0},{"cuenta":"47200000","nombre":"H.P. IVA soportado","concepto":"A-10-Proveedor Ejemplo Uno","debe":8400,"haber":0,"iva":{"tipo":21,"base":40000,"libro":"received"}},{"cuenta":"40000001","nombre":"Proveedor Ejemplo Uno, S.L.","concepto":"A-10-Proveedor Ejemplo Uno","debe":0,"haber":48400}]},{"clave":"3.3","serie":"3","documento":"3","fecha":"2026-01-31","concepto":"Cobro F-1","apuntesLeidos":2,"apuntes":[{"cuenta":"57200001","nombre":"Banco de ejemplo","concepto":"Cobro F-1","debe":110000,"haber":0},{"cuenta":"43000001","nombre":"Cliente Ejemplo Uno, S.L.","concepto":"Cobro F-1","debe":0,"haber":110000}]},{"clave":"2.2","serie":"2","documento":"2","fecha":"2026-02-05","concepto":"B-7-Proveedor Ejemplo Dos","apuntesLeidos":3,"apuntes":[{"cuenta":"60000000","nombre":"Compras de mercaderías","concepto":"B-7-Proveedor Ejemplo Dos","debe":30000,"haber":0},{"cuenta":"47200000","nombre":"H.P. IVA soportado","concepto":"B-7-Proveedor Ejemplo Dos","debe":2100,"haber":0,"iva":{"tipo":21,"base":10000,"libro":"received"}},{"cuenta":"47200000","nombre":"H.P. IVA soportado","concepto":"B-7-Proveedor Ejemplo Dos","debe":2000,"haber":0,"iva":{"tipo":10,"base":20000,"libro":"received"}},{"cuenta":"40000002","nombre":"Proveedor Ejemplo Dos, S.A.","concepto":"B-7-Proveedor Ejemplo Dos","debe":0,"haber":34100}]},{"clave":"1.2","serie":"1","documento":"2","fecha":"2026-02-10","concepto":"F-2-Cliente Ejemplo Uno","apuntesLeidos":3,"apuntes":[{"cuenta":"43000001","nombre":"Cliente Ejemplo Uno, S.L.","concepto":"F-2-Cliente Ejemplo Uno","debe":55000,"haber":0},{"cuenta":"70000000","nombre":"Ventas de mercaderías","concepto":"F-2-Cliente Ejemplo Uno","debe":0,"haber":50000},{"cuenta":"47700000","nombre":"H.P. IVA repercutido","concepto":"F-2-Cliente Ejemplo Uno","debe":0,"haber":5000,"iva":{"tipo":10,"base":50000,"libro":"issued"}}]},{"clave":"3.4","serie":"3","documento":"4","fecha":"2026-02-28","concepto":"Pago A-10","apuntesLeidos":2,"apuntes":[{"cuenta":"40000001","nombre":"Proveedor Ejemplo Uno, S.L.","concepto":"Pago A-10","debe":48400,"haber":0},{"cuenta":"57200001","nombre":"Banco de ejemplo","concepto":"Pago A-10","debe":0,"haber":48400}]},{"clave":"2.3","serie":"2","documento":"3","fecha":"2026-03-01","concepto":"ALQ-3-Arrendador Ejemplo","apuntesLeidos":4,"apuntes":[{"cuenta":"62100000","nombre":"Arrendamientos","concepto":"ALQ-3-Arrendador Ejemplo","debe":100000,"haber":0},{"cuenta":"47200000","nombre":"H.P. IVA soportado","concepto":"ALQ-3-Arrendador Ejemplo","debe":21000,"haber":0,"iva":{"tipo":21,"base":100000,"libro":"received"}},{"cuenta":"47510000","nombre":"H.P. acreedora por retenciones","concepto":"ALQ-3-Arrendador Ejemplo","debe":0,"haber":19000,"retencion":{"tipo":19,"base":100000}},{"cuenta":"41000001","nombre":"Arrendador Ejemplo","concepto":"ALQ-3-Arrendador Ejemplo","debe":0,"haber":102000}]},{"clave":"3.5","serie":"3","documento":"5","fecha":"2026-03-31","concepto":"Amortización del trimestre","apuntesLeidos":2,"apuntes":[{"cuenta":"68100000","nombre":"Amortización del inmovilizado material","concepto":"Amortización del trimestre","debe":3000,"haber":0},{"cuenta":"28160000","nombre":"Amortización acumulada de mobiliario","concepto":"Amortización del trimestre","debe":0,"haber":3000}]}],"facturas":[{"libro":"recibidas","numero":"A-10","serie":null,"numeroSolo":null,"fecha":"2026-01-20","operacion":null,"periodo":"1T","ejercicio":"2026","nif":"B00000000","nombre":"Proveedor Ejemplo Uno, S.L.","tramos":[{"base":40000,"tipo":21,"cuota":8400}],"base":40000,"cuota":8400,"total":48400,"retencion":null,"asiento":"2.1|2026-01-20","pendiente":0},{"libro":"recibidas","numero":"B-7","serie":null,"numeroSolo":null,"fecha":"2026-02-05","operacion":null,"periodo":"1T","ejercicio":"2026","nif":"A00000000","nombre":"Proveedor Ejemplo Dos, S.A.","tramos":[{"base":10000,"tipo":21,"cuota":2100},{"base":20000,"tipo":10,"cuota":2000}],"base":30000,"cuota":4100,"total":34100,"retencion":null,"asiento":"2.2|2026-02-05","pendiente":34100},{"libro":"recibidas","numero":"ALQ-3","serie":null,"numeroSolo":null,"fecha":"2026-03-01","operacion":null,"periodo":"1T","ejercicio":"2026","nif":"12345678Z","nombre":"Arrendador Ejemplo","tramos":[{"base":100000,"tipo":21,"cuota":21000}],"base":100000,"cuota":21000,"total":121000,"retencion":{"tipo":19,"importe":19000},"asiento":"2.3|2026-03-01","pendiente":102000},{"libro":"expedidas","numero":"F-1","serie":"F","numeroSolo":"1","fecha":"2026-01-15","operacion":null,"periodo":"1T","ejercicio":"2026","nif":"B12345678","nombre":"Cliente Ejemplo Uno, S.L.","tramos":[{"base":100000,"tipo":10,"cuota":10000}],"base":100000,"cuota":10000,"total":110000,"retencion":null,"asiento":"1.1|2026-01-15","pendiente":0},{"libro":"expedidas","numero":"F-2","serie":"F","numeroSolo":"2","fecha":"2026-02-10","operacion":null,"periodo":"1T","ejercicio":"2026","nif":"B12345678","nombre":"Cliente Ejemplo Uno, S.L.","tramos":[{"base":50000,"tipo":10,"cuota":5000}],"base":50000,"cuota":5000,"total":55000,"retencion":null,"asiento":"1.2|2026-02-10","pendiente":55000}],"aprendido":[{"codigo":"40000001","gasto":{"cuenta":"60000000","nombre":"Compras de mercaderías"},"tiposIva":[21],"retencion":null,"porque":"Su factura del diario va a Compras de mercaderías · 60000000, con IVA al 21 %."},{"codigo":"40000002","gasto":{"cuenta":"60000000","nombre":"Compras de mercaderías"},"tiposIva":[10,21],"retencion":null,"porque":"Su factura del diario va a Compras de mercaderías · 60000000, con IVA al 10 % y al 21 %."},{"codigo":"41000001","gasto":{"cuenta":"62100000","nombre":"Arrendamientos"},"tiposIva":[21],"retencion":19,"porque":"Su factura del diario va a Arrendamientos · 62100000, con IVA al 21 % y una retención del 19 %."}],"pendientesNoExactos":[],"raros":[{"que":"sin_nif","cuentas":["40000000"],"nif":null,"frase":"40000000 · Proveedores varios: no trae NIF."}],"sumas":[{"cuenta":"10000000","nombre":"Capital social","debe":0,"haber":500000},{"cuenta":"21600000","nombre":"Mobiliario","debe":120000,"haber":0},{"cuenta":"28160000","nombre":"Amortización acumulada de mobiliario","debe":0,"haber":3000},{"cuenta":"40000001","nombre":"Proveedor Ejemplo Uno, S.L.","debe":48400,"haber":48400},{"cuenta":"40000002","nombre":"Proveedor Ejemplo Dos, S.A.","debe":0,"haber":34100},{"cuenta":"41000001","nombre":"Arrendador Ejemplo","debe":0,"haber":102000},{"cuenta":"43000001","nombre":"Cliente Ejemplo Uno, S.L.","debe":165000,"haber":110000},{"cuenta":"47200000","nombre":"H.P. IVA soportado","debe":33500,"haber":0},{"cuenta":"47510000","nombre":"H.P. acreedora por retenciones","debe":0,"haber":19000},{"cuenta":"47700000","nombre":"H.P. IVA repercutido","debe":0,"haber":15000},{"cuenta":"57200001","nombre":"Banco de ejemplo","debe":610000,"haber":168400},{"cuenta":"60000000","nombre":"Compras de mercaderías","debe":70000,"haber":0},{"cuenta":"62100000","nombre":"Arrendamientos","debe":100000,"haber":0},{"cuenta":"68100000","nombre":"Amortización del inmovilizado material","debe":3000,"haber":0},{"cuenta":"70000000","nombre":"Ventas de mercaderías","debe":0,"haber":150000}],"inmovilizado":{"aFecha":"2026-03-31","elementos":[{"codigo":"1","subcuenta":"21600000","descripcion":"Mobiliario de ejemplo","compra":"2026-01-05","baja":null,"precio":120000,"amortizado":3000,"valorContable":117000,"amortizacionFiscal":3000}],"totales":{"precio":120000,"amortizado":3000,"valorContable":117000,"amortizacionFiscal":3000},"avisos":[]},"frases":["40000000 · Proveedores varios: no trae NIF."]}$carga$, true) is not null as datos;

-- ── Para preparar y medir (como el dueño) ──────────────────────────────────────────────────────────
create temp table n06b_h (paso text, tabla text, filas bigint, huella text) on commit drop;
-- Las demás cuentas, tabla a tabla (sin updated_at): iguales al principio y al final (regla 31).
create or replace function pg_temp.medir_otras(p_paso text) returns void language plpgsql as $f$
declare t text;
begin
  foreach t in array array['journal_entry', 'journal_line', 'supplier_invoice', 'supplier_invoice_tax', 'supplier_invoice_payment', 'customer_invoice',
                           'company_account', 'company_account_link', 'supplier', 'party', 'party_role', 'customer_fiscal', 'supplier_learning',
                           'document_activity', 'fiscal_year', 'fiscal_period_lock', 'import_run', 'conta_pago_remesa_linea'] loop
    execute format('insert into n06b_h select %L, %L, count(*), md5(coalesce(string_agg((to_jsonb(x) - ''updated_at'')::text, ''|'' '
                   || 'order by (to_jsonb(x) - ''updated_at'')::text), '''')) from public.%I x where x.account_id <> $1', p_paso, t, t)
      using 'c01a0000-0000-4000-8000-00000000000a'::uuid;
  end loop;
end $f$;
-- Lo que enseñan las seis listas que cambian (2241), para medirlas con la versión de antes y con la nueva.
create or replace function pg_temp.listas() returns jsonb language sql as $f$
  select jsonb_build_object(
    'pagos', public.conta_pagos_lista(current_setting('n06b.empresa')::uuid, '2026-11-01'),
    'casar', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from public.bank_facturas_para_casar(current_setting('n06b.empresa')::uuid) x),
    'pendientes', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from public.bank_facturas_recibidas_pendientes(current_setting('n06b.empresa')::uuid) x),
    'banco', (select coalesce(jsonb_agg(to_jsonb(x) order by x.invoice_id), '[]') from public.banco_facturas_recibidas_pendientes(current_setting('n06b.empresa')::uuid, null) x),
    'recibidas', public.conta_documentos_recibidos(current_setting('n06b.empresa')::uuid, '2026-01-01', '2026-12-31'),
    'cobro', (select coalesce(jsonb_agg(to_jsonb(c) order by c.invoice_id), '[]') from public.conta_factura_cobro c where c.company_id = current_setting('n06b.empresa')::uuid))
$f$;
-- El saldo (debe − haber) de una subcuenta, con lo validado.
create or replace function pg_temp.saldo(p_code text) returns numeric language sql as $f$
  select coalesce(sum(l.debit - l.credit), 0) from public.journal_line l join public.journal_entry e on e.id = l.entry_id
    join public.company_account a on a.id = l.company_account_id
   where e.company_id = current_setting('n06b.empresa')::uuid and e.status = 'validado' and a.code = p_code
$f$;
create or replace function pg_temp.en(p_lista jsonb, p_id uuid) returns boolean language sql as $f$
  select exists (select 1 from jsonb_array_elements(coalesce(p_lista, '[]')) f where f->>'id' = p_id::text or f->>'invoice_id' = p_id::text)
$f$;

-- La empresa: la primera de la cuenta A sin nada traído, con su ejercicio 2026 y sin día de inicio.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; d jsonb := current_setting('n06b.datos')::jsonb;
begin
  select co.id into c from public.company co
   where co.account_id = v_acc and not exists (select 1 from public.journal_entry e where e.company_id = co.id and e.source_type = 'migrated')
   order by co.created_at, co.id limit 1;
  if c is null then raise exception 'PRUEBA N06b: la cuenta A no tiene ninguna empresa sin asientos traídos.'; end if;
  perform set_config('n06b.empresa', c::text, true);
  if (select account_digits from public.company_tax_profile where company_id = c) is distinct from 8 then
    raise exception 'PRUEBA N06b: la empresa de la cuenta A no tiene cuentas de 8 dígitos, y el ejemplo de ERP10 sí.';
  end if;
  if not exists (select 1 from public.fiscal_year where company_id = c and starts_on = '2026-01-01' and ends_on = '2026-12-31') then
    if exists (select 1 from public.fiscal_year where company_id = c and starts_on <= '2026-12-31' and ends_on >= '2026-01-01') then
      raise exception 'PRUEBA N06b: el ejercicio de 2026 de la empresa no va del 01/01 al 31/12.';
    end if;
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31');
  end if;
  update public.bank_settings set cutover_date = null where company_id = c;
  perform public.conta_fijar_corte(c, null, 'erp10');
  update public.fiscal_year set history_imported_at = null, works_without_history_at = null where company_id = c;
  if exists (select 1 from public.journal_entry e where e.company_id = c and e.status in ('borrador', 'validado') and e.entry_date between '2026-01-01' and '2026-03-31') then
    raise exception 'PRUEBA N06b: la empresa ya tiene asientos del primer trimestre de 2026: el ejemplo pararía.';
  end if;
  -- Solo las cuentas y los terceros del ejemplo (lo que sale de subir el plan y los dos listados).
  perform set_config('n06b.solo_plan', ((d - array['asientos', 'facturas', 'aprendido', 'sumas', 'pendientesNoExactos', 'inmovilizado'])
    || jsonb_build_object('asientos', '[]'::jsonb, 'facturas', '[]'::jsonb, 'aprendido', '[]'::jsonb, 'sumas', '[]'::jsonb, 'pendientesNoExactos', '[]'::jsonb,
                          'ficheros', (select jsonb_agg(x) from jsonb_array_elements(d->'ficheros') x where x->>'tipo' in ('plan_cuentas', 'proveedores', 'clientes'))))::text, true);
  -- El mismo ejemplo con un sumas y saldos que no cuadra en la 57200001 (10,00 más al debe), y sin sumas y saldos.
  perform set_config('n06b.no_cuadra', jsonb_set(d, '{sumas}', (select jsonb_agg(case when s->>'cuenta' = '57200001'
    then s || jsonb_build_object('debe', (s->>'debe')::int + 1000) else s end) from jsonb_array_elements(d->'sumas') s))::text, true);
  perform set_config('n06b.sin_sumas', jsonb_set(d, '{sumas}', '[]'::jsonb)::text, true);
  -- Una recibida que entró por correo SIN PROVEEDOR, con el NIF del 40000001 del ejemplo.
  insert into public.supplier_invoice (account_id, company_id, invoice_number, invoice_date, status, source, grand_total, tax_base_total, tax_total,
                                       created_by_name, reading)
  values (v_acc, c, 'N06B-SIN-1', '2026-11-10', 'en_revision', 'ocr', 121, 100, 21, 'Prueba N06b',
          '{"factura": {"proveedor": {"nif": "B00000000", "nombre": "Proveedor Ejemplo Uno"}}}')
  returning id into c;
  perform set_config('n06b.sin_proveedor', c::text, true);
end $$;
select pg_temp.medir_otras('antes');

-- 0 · Permisos -----------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['conta_traer_dar_por_bueno(uuid,text)', 'conta_traer_antes_de_dar_por_bueno(uuid)'] loop
    if not has_function_privilege('authenticated', 'public.' || f, 'execute') or has_function_privilege('anon', 'public.' || f, 'execute') then
      raise exception 'PRUEBA N06b · 0: % no es solo para usuarios.', f;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public._conta_traer_comparar(uuid)', 'execute') then
    raise exception 'PRUEBA N06b · 0: _conta_traer_comparar la puede ejecutar un usuario.';
  end if;
end $$;

-- 1 · Las listas, antes y después del cambio (regla 31), y las cuatro vueltas atrás -------------------
set local role authenticated;
select set_config('n06b.listas_nuevas', pg_temp.listas()::text, true) is not null as listas_con_lo_nuevo;
reset role;
\i supabase/vuelta-atras/20261117T2242_n06b_darlo_por_bueno.down.sql
\i supabase/vuelta-atras/20261117T2241_n06b_serie_y_listas.down.sql
\i supabase/vuelta-atras/20261117T2240_n06b_traida_sin_pagar.down.sql
\i supabase/vuelta-atras/20261117T2224_n06b_programa_erp10.down.sql
do $$
begin
  if exists (select 1 from pg_proc where prosrc ~ 'N06b') or to_regprocedure('public.conta_traer_dar_por_bueno(uuid,text)') is not null
     or exists (select 1 from pg_trigger where tgname ~ 'n06b')
     or pg_get_constraintdef((select oid from pg_constraint where conname = 'journal_entry_series_check')) ~ '8'
     or pg_get_constraintdef((select oid from pg_constraint where conname = 'conta_programa_anterior_programa')) ~ 'erp10'
     or strpos(pg_get_viewdef('public.conta_factura_cobro'::regclass), 'import_pending') > 0 then
    raise exception 'PRUEBA N06b · 1: las vueltas atrás no han dejado todo como antes.';
  end if;
end $$;
set local role authenticated;
select set_config('n06b.listas_viejas', pg_temp.listas()::text, true) is not null as listas_con_lo_de_antes;
reset role;
\i supabase/migrations/20261117T2224_n06b_programa_erp10.sql
\i supabase/migrations/20261117T2240_n06b_traida_sin_pagar.sql
\i supabase/migrations/20261117T2241_n06b_serie_y_listas.sql
\i supabase/migrations/20261117T2242_n06b_darlo_por_bueno.sql
do $$
declare v_n jsonb := current_setting('n06b.listas_nuevas')::jsonb; v_v jsonb := current_setting('n06b.listas_viejas')::jsonb; k text;
begin
  foreach k in array array['pagos', 'casar', 'pendientes', 'banco', 'recibidas', 'cobro'] loop
    if v_n->k is distinct from v_v->k then raise exception 'PRUEBA N06b · 1: «%» no enseña lo mismo con la versión nueva.', k; end if;
  end loop;
  raise notice 'PRUEBA N06b · 1: las seis listas que cambian (Pagos, casar, pendientes, banco, recibidas y lo cobrado), idénticas con la versión de antes y la nueva: % filas de recibidas.',
    jsonb_array_length(coalesce(v_n->'recibidas'->'filas', '[]'));
end $$;

-- 2 · La serie de lo traído es solo de lo traído ------------------------------------------------------
set local role authenticated;
do $$
declare v_msg text;
begin
  begin
    perform public.journal_entry_proponer(current_setting('n06b.empresa')::uuid,
      jsonb_build_object('series', 8, 'fecha', '2026-11-05', 'concepto', 'A mano en la 8', 'source_type', 'manual', 'confianza', 'seguro', 'porque', 'Prueba N06b'),
      '[{"cuenta":"62900000","debe":1,"haber":0},{"cuenta":"57200000","debe":0,"haber":1}]', null, 'Prueba N06b');
    raise exception 'PRUEBA N06b · 2: se ha apuntado a mano en la serie de lo traído.';
  exception when check_violation then get stacked diagnostics v_msg = message_text;
  end;
  if v_msg !~ 'journal_entry_series_check|no está en el plan' then raise exception 'PRUEBA N06b · 2: «%».', v_msg; end if;
end $$;
reset role;

-- 3 · Solo las cuentas y los proveedores: se trae, se da por bueno, y la recibida sin proveedor lo encuentra
do $$
declare c uuid := current_setting('n06b.empresa')::uuid; r jsonb; v_carga uuid; v_s uuid;
begin
  r := public.conta_traer_cargar(c, null, current_setting('n06b.solo_plan')::jsonb, 'Prueba N06b');
  v_carga := (r->>'carga')::uuid;
  if r->>'texto' is distinct from 'He traído 16 cuentas, 4 proveedores y 1 cliente. Lo de antes sigue sin traer.' then
    raise exception 'PRUEBA N06b · 3: traer solo las cuentas: «%».', r->>'texto';
  end if;
  if public.conta_dia_de_inicio(c) is not null then raise exception 'PRUEBA N06b · 3: traer solo las cuentas ha fijado el día de inicio.'; end if;
  r := public.conta_traer_antes_de_dar_por_bueno(v_carga);
  if r->>'texto' is distinct from 'Vas a dar por bueno lo traído de ERP10: 16 cuentas, 4 proveedores y 1 cliente. Después ya no se podrá deshacer.' then
    raise exception 'PRUEBA N06b · 3: antes de darlo por bueno: «%».', r->>'texto';
  end if;
  r := public.conta_traer_dar_por_bueno(v_carga, 'Prueba N06b');
  if r->>'texto' is distinct from 'Hecho. Lo traído de ERP10 ya es parte de tu contabilidad: 16 cuentas, 4 proveedores y 1 cliente. 1 factura que había entrado sin proveedor ya lo tiene.' then
    raise exception 'PRUEBA N06b · 3: dar por bueno solo las cuentas: «%».', r->>'texto';
  end if;
  select i.supplier_id into v_s from public.supplier_invoice i where i.id = current_setting('n06b.sin_proveedor')::uuid;
  if v_s is null or not exists (select 1 from public.company_account_link l join public.company_account a on a.id = l.company_account_id
                                  where l.entity = 'supplier' and l.entity_id = v_s::text and l.role = 'principal' and a.code = '40000001') then
    raise exception 'PRUEBA N06b · 3: la recibida sin proveedor no ha encontrado el suyo, con su cuenta 40000001.';
  end if;
  if not exists (select 1 from public.document_activity d where d.supplier_invoice_id = current_setting('n06b.sin_proveedor')::uuid
                   and d.text like 'Sumied le ha puesto su proveedor, %, al dar por bueno lo traído de ERP10: tienen el mismo NIF.') then
    raise exception 'PRUEBA N06b · 3: la recibida no dice por qué tiene proveedor.';
  end if;
  if public.conta_dia_de_inicio(c) is not null or exists (select 1 from public.fiscal_period_lock where company_id = c)
     or exists (select 1 from public.fiscal_year where company_id = c and history_imported_at is not null) then
    raise exception 'PRUEBA N06b · 3: dar por buenas solo las cuentas ha fijado, cerrado o marcado algo.';
  end if;
  raise notice 'PRUEBA N06b · 3: %', r->>'texto';
end $$;

-- 4 · La carga entera, en prueba: reutiliza esas cuentas y esos terceros, y no se paga, casa ni cobra ---
do $$
declare c uuid := current_setting('n06b.empresa')::uuid; r jsonb; v_carga uuid; v_b7 uuid; v_l jsonb; v_msg text; v_hint text; v_t uuid;
begin
  r := public.conta_traer_cargar(c, null, current_setting('n06b.datos')::jsonb, 'Prueba N06b');
  v_carga := (r->>'carga')::uuid; perform set_config('n06b.carga', v_carga::text, true);
  if (r->'cuentas'->>'asientos')::int <> 10 or (r->'cuentas'->>'cuentas_nuevas')::int <> 0 or (r->'cuentas'->>'cuentas_estaban')::int <> 16 then
    raise exception 'PRUEBA N06b · 4: la carga entera no reutiliza las cuentas: %.', r->'cuentas';
  end if;
  if (select count(*) from public.journal_entry where import_run_id = v_carga and series = 8 and status = 'borrador') <> 10 then
    raise exception 'PRUEBA N06b · 4: los 10 asientos no están en borrador en la serie de lo traído.';
  end if;
  if exists (select 1 from public.customer_invoice where import_run_id = v_carga) then
    raise exception 'PRUEBA N06b · 4: las emitidas traídas existen en Sumied con la carga en prueba.';
  end if;
  select id into v_b7 from public.supplier_invoice where import_run_id = v_carga and invoice_number = 'B-7';
  v_l := pg_temp.listas();
  if pg_temp.en(v_l->'pagos'->'filas', v_b7) or pg_temp.en(v_l->'casar', v_b7) or pg_temp.en(v_l->'pendientes', v_b7) or pg_temp.en(v_l->'banco', v_b7)
     or exists (select 1 from jsonb_array_elements(v_l->'cobro') x join public.customer_invoice ci on ci.id = (x->>'invoice_id')::uuid where ci.import_run_id = v_carga) then
    raise exception 'PRUEBA N06b · 4: una traída en prueba sale en Pagos, en Bancos o en Cobros.';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_l->'recibidas'->'filas') x where x->>'id' = v_b7::text and x->>'estado' = 'traida_en_prueba') then
    raise exception 'PRUEBA N06b · 4: la B-7 no sale en Facturas recibidas como «traida_en_prueba».';
  end if;
  -- Pagarla: ni a mano, ni con un pago apuntado.
  insert into public.treasury_account (account_id, company_id, kind, name, is_active) values ('c01a0000-0000-4000-8000-00000000000a', c, 'cash', 'Caja de la prueba N06b', true)
  returning id into v_t;
  perform set_config('n06b.caja', v_t::text, true);
  begin
    perform public.conta_pago_a_mano(c, v_b7, v_t, '2026-11-10', 341);
    raise exception 'PRUEBA N06b · 4: una traída en prueba se ha pagado a mano.';
  exception when check_violation then get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'traida_en_prueba' then raise exception 'PRUEBA N06b · 4: pagarla a mano: «%».', v_msg; end if;
  begin
    insert into public.supplier_invoice_payment (account_id, company_id, invoice_id, paid_on, amount) values ('c01a0000-0000-4000-8000-00000000000a', c, v_b7, '2026-11-10', 341);
    raise exception 'PRUEBA N06b · 4: se ha apuntado un pago a una traída en prueba.';
  exception when check_violation then get stacked diagnostics v_msg = message_text;
  end;
  if v_msg is distinct from 'La factura B-7 es de lo traído que todavía está en prueba: se paga cuando lo des por bueno.' then
    raise exception 'PRUEBA N06b · 4: el pago: «%».', v_msg;
  end if;
end $$;

-- 5 · Con un sumas y saldos que no cuadra no se da por bueno; sin él, sí, y se dice ----------------------
do $$
declare c uuid := current_setting('n06b.empresa')::uuid; r jsonb; v_carga uuid; v_msg text; v_hint text;
begin
  perform public.conta_traer_deshacer(current_setting('n06b.carga')::uuid, 'Prueba N06b');
  r := public.conta_traer_cargar(c, null, current_setting('n06b.no_cuadra')::jsonb, 'Prueba N06b'); v_carga := (r->>'carga')::uuid;
  r := public.conta_traer_antes_de_dar_por_bueno(v_carga);
  if (r->>'puede')::boolean or r->>'texto' is distinct from 'No cuadra con el sumas y saldos de ERP10 en 1 cuenta. Míralas antes de darlo por bueno.'
     or r->'diferencias' is distinct from '[{"cuenta": "57200001", "nombre": "Banco de ejemplo", "alli_debe": 6110, "alli_haber": 1684, "traido_debe": 6100.00, "traido_haber": 1684.00}]'::jsonb then
    raise exception 'PRUEBA N06b · 5: no cuadra: «%» %.', r->>'texto', r->'diferencias';
  end if;
  begin
    perform public.conta_traer_dar_por_bueno(v_carga, 'Prueba N06b');
    raise exception 'PRUEBA N06b · 5: se ha dado por bueno sin cuadrar.';
  exception when check_violation then get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'no_cuadra' then raise exception 'PRUEBA N06b · 5: «%».', v_msg; end if;
  perform public.conta_traer_deshacer(v_carga, 'Prueba N06b');
  r := public.conta_traer_cargar(c, null, current_setting('n06b.sin_sumas')::jsonb, 'Prueba N06b'); v_carga := (r->>'carga')::uuid;
  r := public.conta_traer_antes_de_dar_por_bueno(v_carga);
  if not (r->>'puede')::boolean or r->>'texto' is distinct from 'Vas a dar por bueno lo traído de ERP10: 10 asientos y 5 facturas, hasta el 31/03/2026. No se ha podido comparar con el sumas y saldos, porque no se trajo. Después ya no se podrá deshacer.' then
    raise exception 'PRUEBA N06b · 5: sin sumas y saldos: «%».', r->>'texto';
  end if;
  perform public.conta_traer_deshacer(v_carga, 'Prueba N06b');
  raise notice 'PRUEBA N06b · 5: no cuadra en la 57200001 (allí 6.110,00 al debe, traído 6.100,00) y no deja; sin sumas y saldos, deja y lo dice.';
end $$;

-- 6 · EL ENSAYO DE LA REGLA 10 ------------------------------------------------------------------------
-- La empresa con día de inicio (01/04/2026, traída a medias de ERP10 hasta el 31/03), trabajando sin lo
-- anterior y con dos asientos suyos ya validados después del día de inicio.
do $$
declare c uuid := current_setting('n06b.empresa')::uuid; r jsonb; v uuid; v_i uuid; v_iva uuid; v_p uuid;
begin
  perform public.conta_fijar_corte(c, '2026-03-31', 'erp10');
  perform public.conta_trabajar_sin_historico(c, '2026', 'Prueba N06b');
  select id into v_iva from public.tax_rate where rate = 21 and treatment = 'taxed' and valid_to is null and name like 'IVA%' limit 1;
  select pr.party_id into v_p from public.supplier s join public.party_role pr on pr.supplier_id = s.id and pr.role = 'supplier'
   where s.account_id = 'c01a0000-0000-4000-8000-00000000000a' and public.party_nif(s.tax_id) = 'A00000000' limit 1;
  r := public.journal_entry_proponer(c, jsonb_build_object('series', 3, 'fecha', '2026-04-05', 'concepto', 'Prueba N06b · pago a cuenta', 'source_type', 'manual',
         'confianza', 'seguro', 'porque', 'Prueba N06b'),
         jsonb_build_array(jsonb_build_object('cuenta', '40000002', 'debe', 100, 'haber', 0, 'comun', true, 'tercero_id', v_p),
                           jsonb_build_object('cuenta', '57200001', 'debe', 0, 'haber', 100, 'comun', true)), null, 'Prueba N06b');
  perform public.journal_entry_validar((r->>'id')::uuid, 'Prueba N06b');
  insert into public.supplier_invoice (account_id, company_id, invoice_number, invoice_date, status, source, grand_total, tax_base_total, tax_total, created_by_name)
  values ('c01a0000-0000-4000-8000-00000000000a', c, 'N06B-1', '2026-04-06', 'en_revision', 'manual', 121, 100, 21, 'Prueba N06b') returning id into v_i;
  r := public.journal_entry_proponer(c, jsonb_build_object('series', 2, 'fecha', '2026-04-06', 'concepto', 'Prueba N06b · recibida', 'source_type', 'supplier_invoice',
         'source_id', v_i, 'confianza', 'seguro', 'porque', 'Prueba N06b'),
         jsonb_build_array(jsonb_build_object('cuenta', '60000000', 'debe', 100, 'haber', 0, 'comun', true),
           jsonb_build_object('cuenta', '47200000', 'debe', 21, 'haber', 0, 'comun', true,
             'iva', jsonb_build_object('tipo_id', v_iva, 'base', 100, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
           jsonb_build_object('cuenta', '40000002', 'debe', 0, 'haber', 121, 'comun', true, 'tercero_id', v_p)), null, 'Prueba N06b');
  perform public.journal_entry_validar((r->>'id')::uuid, 'Prueba N06b');
  perform set_config('n06b.saldos_antes', jsonb_build_object('40000002', pg_temp.saldo('40000002'), '57200001', pg_temp.saldo('57200001'),
                                                             '47200000', pg_temp.saldo('47200000'))::text, true);
end $$;
do $$
declare c uuid := current_setting('n06b.empresa')::uuid; r jsonb; v_carga uuid; a jsonb := current_setting('n06b.saldos_antes')::jsonb; d jsonb; v text;
        v_l jsonb; v_b7 uuid; v_alq uuid; v_f2 uuid; v_f1 uuid;
begin
  r := public.conta_traer_cargar(c, '2026', current_setting('n06b.datos')::jsonb, 'Prueba N06b'); v_carga := (r->>'carga')::uuid;
  perform set_config('n06b.carga', v_carga::text, true);
  r := public.conta_traer_antes_de_dar_por_bueno(v_carga);
  if r->>'texto' is distinct from 'Vas a dar por bueno lo traído de ERP10: 10 asientos y 5 facturas, hasta el 31/03/2026. Cuadra con el sumas y saldos. Después ya no se podrá deshacer.' then
    raise exception 'PRUEBA N06b · 6: antes de darlo por bueno: «%».', r->>'texto';
  end if;
  r := public.conta_traer_dar_por_bueno(v_carga, 'Prueba N06b');
  if r->>'texto' is distinct from 'Hecho. 10 asientos de antes del 01/04/2026 ya están en tu contabilidad, y 3 facturas pendientes han pasado: 2 a Pagos y 1 a Cobros.' then
    raise exception 'PRUEBA N06b · 6: dar por bueno: «%».', r->>'texto';
  end if;
  raise notice 'PRUEBA N06b · 6: %', r->>'texto';
  -- Los 10, validados en la serie de lo traído, del 1 al 10 por fecha; 11.499,00 al debe y al haber.
  select string_agg(e.number::text, ',' order by e.entry_date, e.number) into v from public.journal_entry e where e.import_run_id = v_carga and e.series = 8 and e.status = 'validado';
  if v is distinct from '1,2,3,4,5,6,7,8,9,10'
     or (select sum(l.debit)::text || '/' || sum(l.credit)::text from public.journal_line l join public.journal_entry e on e.id = l.entry_id where e.import_run_id = v_carga) <> '11499.00/11499.00' then
    raise exception 'PRUEBA N06b · 6: los traídos no quedan validados del 1 al 10 con 11.499,00 (% ).', v;
  end if;
  -- La cadena sigue el orden en que se valida (los dos de Sumied, primero); el libro, el de la fecha.
  select string_agg(to_char(e.entry_date, 'DD/MM') || ' ' || case e.series when 8 then 'Lo traído' when 2 then 'Compras' when 3 then 'Banco' end || ' ' || e.number
                    || coalesce(' (n.º en ERP10 ' || e.external_series || '/' || e.external_number || ')', '') || ' · cadena ' || e.chain_seq, E'\n' order by e.entry_date, e.series, e.number)
    into v from public.journal_entry e where e.company_id = c and e.status = 'validado';
  raise notice E'PRUEBA N06b · 6: el libro diario, por fecha, con su cadena:\n%', v;
  -- Pagos y Bancos: la B-7 y la ALQ-3; Cobros: la F-2 por cobrar y la F-1 cobrada.
  select id into v_b7 from public.supplier_invoice where import_run_id = v_carga and invoice_number = 'B-7';
  select id into v_alq from public.supplier_invoice where import_run_id = v_carga and invoice_number = 'ALQ-3';
  select id into v_f2 from public.customer_invoice where import_run_id = v_carga and number_text = 'F-2';
  select id into v_f1 from public.customer_invoice where import_run_id = v_carga and number_text = 'F-1';
  v_l := pg_temp.listas();
  if not (pg_temp.en(v_l->'pagos'->'filas', v_b7) and pg_temp.en(v_l->'pagos'->'filas', v_alq) and pg_temp.en(v_l->'pendientes', v_b7) and pg_temp.en(v_l->'casar', v_alq)) then
    raise exception 'PRUEBA N06b · 6: la B-7 y la ALQ-3 no han pasado a Pagos y a Bancos.';
  end if;
  if (select string_agg(x->>'estado' || ' ' || (x->>'pendiente'), ', ' order by (x->>'total')::numeric) from jsonb_array_elements(v_l->'cobro') x
       where (x->>'invoice_id')::uuid in (v_f1, v_f2)) is distinct from 'por_cobrar 550.00, cobrada 0.00' then
    raise exception 'PRUEBA N06b · 6: Cobros no enseña la F-2 por cobrar y la F-1 cobrada: %.', v_l->'cobro';
  end if;
  -- El historial, traído; los meses de antes, cerrados; la decisión de trabajar sin lo anterior, escrita y ya sin efecto.
  if (select history_imported_at is null or works_without_history_at is null from public.fiscal_year where company_id = c and code = '2026')
     or (select count(*) from public.fiscal_period_lock where company_id = c and kind = 'migrated' and reopened_at is null) <> 3 then
    raise exception 'PRUEBA N06b · 6: el historial no queda traído o los tres meses de antes no siguen cerrados.';
  end if;
  -- Los saldos de las tres cuentas, antes y después: lo de Sumied más lo traído.
  d := jsonb_build_object('40000002', pg_temp.saldo('40000002'), '57200001', pg_temp.saldo('57200001'), '47200000', pg_temp.saldo('47200000'));
  if (d->>'40000002')::numeric <> (a->>'40000002')::numeric - 341 or (d->>'57200001')::numeric <> (a->>'57200001')::numeric + 4416
     or (d->>'47200000')::numeric <> (a->>'47200000')::numeric + 335 then
    raise exception 'PRUEBA N06b · 6: los saldos no son lo de Sumied más lo traído: antes %, después %.', a, d;
  end if;
  raise notice 'PRUEBA N06b · 6: saldos (debe − haber) antes → después: proveedor 40000002 % → %; banco 57200001 % → %; IVA soportado 47200000 % → %.',
    a->>'40000002', d->>'40000002', a->>'57200001', d->>'57200001', a->>'47200000', d->>'47200000';
end $$;
-- Y después: se valida una recibida nueva, se paga una traída pendiente y se cierra el mes.
do $$
declare c uuid := current_setting('n06b.empresa')::uuid; r jsonb; v_i uuid; v_iva uuid; v_b7 uuid; v_msg text;
begin
  select id into v_iva from public.tax_rate where rate = 21 and treatment = 'taxed' and valid_to is null and name like 'IVA%' limit 1;
  insert into public.supplier_invoice (account_id, company_id, invoice_number, invoice_date, status, source, grand_total, tax_base_total, tax_total, created_by_name)
  values ('c01a0000-0000-4000-8000-00000000000a', c, 'N06B-2', '2026-04-20', 'en_revision', 'manual', 242, 200, 42, 'Prueba N06b') returning id into v_i;
  r := public.journal_entry_proponer(c, jsonb_build_object('series', 2, 'fecha', '2026-04-20', 'concepto', 'Prueba N06b · recibida después', 'source_type', 'supplier_invoice',
         'source_id', v_i, 'confianza', 'seguro', 'porque', 'Prueba N06b'),
         jsonb_build_array(jsonb_build_object('cuenta', '60000000', 'debe', 200, 'haber', 0, 'comun', true),
           jsonb_build_object('cuenta', '47200000', 'debe', 42, 'haber', 0, 'comun', true,
             'iva', jsonb_build_object('tipo_id', v_iva, 'base', 200, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
           jsonb_build_object('cuenta', '40000002', 'debe', 0, 'haber', 242, 'comun', true)), null, 'Prueba N06b');
  r := public.journal_entry_validar((r->>'id')::uuid, 'Prueba N06b');
  perform set_config('n06b.numero_nueva', r->>'numero', true);
  select id into v_b7 from public.supplier_invoice where import_run_id = current_setting('n06b.carga')::uuid and invoice_number = 'B-7';
  r := public.conta_pago_a_mano(c, v_b7, current_setting('n06b.caja')::uuid, '2026-04-25', 341);
  if r->>'frase' not like 'Apuntado: % el 25/04 desde Caja de la prueba N06b.%' then raise exception 'PRUEBA N06b · 6: pagar la B-7: «%».', r->>'frase'; end if;
  r := public.conta_cerrar_mes(c, '2026-04-01');
  if not exists (select 1 from public.fiscal_period_lock where company_id = c and month = '2026-04-01' and reopened_at is null) then
    raise exception 'PRUEBA N06b · 6: abril no ha quedado cerrado.';
  end if;
  begin
    perform public.conta_traer_deshacer(current_setting('n06b.carga')::uuid, 'Prueba N06b');
    raise exception 'PRUEBA N06b · 6: una carga dada por buena se ha deshecho.';
  exception when check_violation then get stacked diagnostics v_msg = message_text;
  end;
  raise notice 'PRUEBA N06b · 6: después, una recibida validada (Compras %), la B-7 en un pago a mano y abril cerrado. Deshacer: «%»', current_setting('n06b.numero_nueva'), v_msg;
  raise notice 'PRUEBA N06b · 6: queda — % asientos validados (% traídos en la serie 8 y % de Sumied), % meses cerrados, % facturas traídas, % en Pagos por pagar.',
    (select count(*) from public.journal_entry where company_id = c and status = 'validado'),
    (select count(*) from public.journal_entry where company_id = c and status = 'validado' and series = 8),
    (select count(*) from public.journal_entry where company_id = c and status = 'validado' and series <> 8),
    (select count(*) from public.fiscal_period_lock where company_id = c and reopened_at is null),
    (select count(*) from public.supplier_invoice where company_id = c and source = 'traida') + (select count(*) from public.customer_invoice where company_id = c and origin = 'traida'),
    (select count(*) from public.supplier_invoice where company_id = c and source = 'traida' and status = 'aprobada');
end $$;
reset role;

-- 7 · La cuenta B no ve ni toca nada -------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_carga uuid := current_setting('n06b.carga')::uuid;
begin
  if exists (select 1 from public.import_run where id = v_carga) or exists (select 1 from public.journal_entry where import_run_id = v_carga)
     or exists (select 1 from public.customer_invoice where import_run_id = v_carga) then
    raise exception 'PRUEBA N06b · 7: la cuenta B ve lo traído de la cuenta A.';
  end if;
  begin
    perform public.conta_traer_antes_de_dar_por_bueno(v_carga);
    raise exception 'PRUEBA N06b · 7: la cuenta B lee la confirmación de la cuenta A.';
  exception when no_data_found then null;
  end;
  begin
    perform public.conta_traer_dar_por_bueno(v_carga, 'Prueba N06b');
    raise exception 'PRUEBA N06b · 7: la cuenta B da por buena la carga de la cuenta A.';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 8 · Las demás cuentas, iguales -----------------------------------------------------------------------
select pg_temp.medir_otras('despues');
do $$
declare v_mal text;
begin
  select string_agg(a.tabla, ', ') into v_mal from n06b_h a left join n06b_h d on d.paso = 'despues' and d.tabla = a.tabla
   where a.paso = 'antes' and d.huella is distinct from a.huella;
  if v_mal is not null then raise exception 'PRUEBA N06b · 8: han cambiado tablas de otras cuentas: %.', v_mal; end if;
  raise notice 'PRUEBA N06b · 8: las demás cuentas, 18 tablas iguales huella a huella (% filas).', (select sum(filas) from n06b_h where paso = 'antes');
end $$;
select 'PRUEBA N06b: 0 a 8 bien' as resultado;
rollback;
