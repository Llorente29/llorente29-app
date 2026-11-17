-- supabase/staging/sql/20261117_r03_ventas_tpv_prueba.sql
--
-- SOLO STAGING. Prueba del R03 (20261117T0950_r03_ventas_tpv_tablas y
-- 20261117T0951_r03_ventas_tpv_funciones), que el ensayo de staging pone delante
-- en la misma sesión. Todo en una transacción con ROLLBACK: staging no cambia.
-- Nombra lo que crea: public.conta_tpv_dia, public.conta_tpv_documento,
-- public.conta_tpv_impuesto, public.conta_tpv_cobro, public.conta_tpv_forma_cuenta,
-- public.company_tax_profile (ventas_por_dia), public.conta_tpv_dia_guardar y
-- public.conta_tpv_dia_leer.
--
-- Monta, dentro de la transacción, una cuenta inventada con DOS empresas (E1 y
-- E2) y un administrador (u1), y otra cuenta con su administrador (u2). Los
-- datos son los del ejemplo INVENTADO de Revo (revo_ejemplo, 16/11: NIF
-- B00000000, «Cliente de ejemplo N»), escritos aquí como valores: el lector de
-- CSV y los ficheros van en el PR 2.
--
--   1. Lo que crea: el interruptor apagado en todas las empresas; RLS en las
--      cinco tablas; las cuatro del día, solo de lectura para un usuario (la
--      única puerta es la función); anon no ejecuta las funciones.
--   2. El día del ejemplo entra en E1 (como u1): 48 facturas, de la 5001 a la
--      5048, 1.100,00 € de total, 999,99 de base y 100,01 de cuota; por forma
--      de pago 500 (Deliverect), 180 (Efectivo) y 420 (Tarjeta); 48 renglones de
--      IVA y 49 cobros (la 700028, en dos veces); la devolución (−11,00, Glovo)
--      en negativo; dos facturas con NIF; «--» guardado como «local». La
--      tolerancia: la cuota (100,01) se aleja 1 céntimo de la base × 10 %
--      (100,00), dentro de los 26 que da floor(0,55 · 48 + 0,5).
--   3. Subirlo otra vez lo sustituye: el mismo día (mismo id), las mismas filas
--      y lo mismo leído (huella de conta_tpv_dia_leer sin la hora de subida).
--   4. Una empresa no ve el día de la otra: el mismo día en E2 es otra fila;
--      E1 sigue igual; leer E1 y E2 da cada una lo suyo; u2 (otra cuenta) no
--      lee E1 ni lo ve en las tablas, y no puede guardar en ella.
--   5. Las cuatro paradas paran de verdad, con su frase y su pista, y no dejan
--      nada: los totales (faltan y sobran), la numeración (falta y repetida),
--      el día de inicio y el día contabilizado. Y la tolerancia de redondeo
--      para cuando se pasa.
--   6. Las dos vueltas atrás, sobre estos datos: quitados los días de la prueba
--      (la de la 0950 para si hay días guardados, a propósito: eso se probó en
--      la base local, porque aquí su error abortaría la transacción entera),
--      la 0951 y la 0950 dejan la base sin las funciones, sin las cinco tablas
--      y sin el interruptor.
--
-- Como el cliente: u1 y u2 en request.jwt.claims, con el rol authenticated.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA R03: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 0 · Las dos cuentas, sus administradores y las empresas -------------------------------
do $$
declare
  u1 constant uuid := 'ae030000-0000-4000-8000-000000000001';
  u2 constant uuid := 'ae030000-0000-4000-8000-000000000002';
  x  constant uuid := 'ae030000-0000-4000-8000-000000000010';
  y  constant uuid := 'ae030000-0000-4000-8000-000000000020';
  u uuid;
begin
  foreach u in array array[u1, u2] loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'tpv-' || right(u::text, 1) || '@r03-prueba.test',
      extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  end loop;
  insert into public.accounts (id, name, slug, status, business_type, product_brand) values
    (x, 'Prueba TPV', 'r03-prueba-tpv', 'active', 'otra_actividad', 'contabilidad'),
    (y, 'Prueba TPV ajena', 'r03-prueba-tpv-ajena', 'active', 'otra_actividad', 'contabilidad');
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at) values
    (u1, x, 'admin', true, 'Prueba TPV', now(), now()),
    (u2, y, 'admin', true, 'Prueba TPV ajena', now(), now());
  insert into public.company (id, account_id, legal_name, setup_step) values
    ('ae030000-0000-4000-8000-000000000011', x, 'Prueba TPV Uno, S.L.', 'nombre'),
    ('ae030000-0000-4000-8000-000000000012', x, 'Prueba TPV Dos, S.L.', 'nombre'),
    ('ae030000-0000-4000-8000-000000000013', x, 'Prueba TPV Tres, S.L.', 'nombre'),
    ('ae030000-0000-4000-8000-000000000021', y, 'Prueba TPV Ajena, S.L.', 'nombre');
  insert into public.company_tax_profile (company_id, account_id, chart_kind, account_digits)
  values ('ae030000-0000-4000-8000-000000000011', x, 'pymes', 8);
  -- E3 empieza en Sumied el 01/12/2026 (corte del banco): el 09/11 es del programa de antes.
  insert into public.bank_settings (company_id, account_id, cutover_date) values ('ae030000-0000-4000-8000-000000000013', x, date '2026-12-01');
end $$;

-- El día del ejemplo, tal como lo mandará el lector del PR 2.
create temp table _prueba_r03 (clave text primary key, j jsonb) on commit drop;
insert into _prueba_r03 values ('ejemplo', $ejemplo$
  {"documentos": [
    {"numero":5001,"contador":"Facturas","fecha":"2026-11-09 12:40:30","orden":"700001","canal":"UberEats","nif":null,"cliente":"Cliente de ejemplo 1","base":30.23,"cuota":3.02,"total":33.25},
    {"numero":5002,"contador":"Facturas","fecha":"2026-11-09 12:53:30","orden":"700002","canal":"UberEats","nif":null,"cliente":"Cliente de ejemplo 2","base":18.12,"cuota":1.81,"total":19.93},
    {"numero":5003,"contador":"Facturas","fecha":"2026-11-09 13:06:30","orden":"700003","canal":"Glovo","nif":null,"cliente":"Cliente de ejemplo 3","base":15.78,"cuota":1.58,"total":17.36},
    {"numero":5004,"contador":"Facturas","fecha":"2026-11-09 13:19:30","orden":"700004","canal":"Glovo","nif":null,"cliente":"Cliente de ejemplo 4","base":32.05,"cuota":3.21,"total":35.26},
    {"numero":5005,"contador":"Facturas","fecha":"2026-11-09 13:32:30","orden":"700005","canal":"--","nif":null,"cliente":null,"base":15.67,"cuota":1.57,"total":17.24},
    {"numero":5006,"contador":"Facturas","fecha":"2026-11-09 13:45:30","orden":"700006","canal":"--","nif":null,"cliente":null,"base":16.19,"cuota":1.62,"total":17.81},
    {"numero":5007,"contador":"Facturas","fecha":"2026-11-09 13:58:30","orden":"700007","canal":"--","nif":"B00000000","cliente":"Cliente de ejemplo 7","base":36.44,"cuota":3.64,"total":40.08},
    {"numero":5008,"contador":"Facturas","fecha":"2026-11-09 14:11:30","orden":"700008","canal":"--","nif":null,"cliente":null,"base":11.22,"cuota":1.12,"total":12.34},
    {"numero":5009,"contador":"Facturas","fecha":"2026-11-09 14:24:30","orden":"700009","canal":"UberEats","nif":null,"cliente":"Cliente de ejemplo 9","base":19.59,"cuota":1.96,"total":21.55},
    {"numero":5010,"contador":"Facturas","fecha":"2026-11-09 14:37:30","orden":"700010","canal":"--","nif":null,"cliente":null,"base":25.77,"cuota":2.58,"total":28.35},
    {"numero":5011,"contador":"Facturas","fecha":"2026-11-09 14:50:30","orden":"700011","canal":"Glovo","nif":null,"cliente":"Cliente de ejemplo 11","base":28.1,"cuota":2.81,"total":30.91},
    {"numero":5012,"contador":"Facturas","fecha":"2026-11-09 15:03:30","orden":"700012","canal":"--","nif":null,"cliente":null,"base":35.89,"cuota":3.59,"total":39.48},
    {"numero":5013,"contador":"Facturas","fecha":"2026-11-09 15:16:30","orden":"700013","canal":"UberEats","nif":null,"cliente":"Cliente de ejemplo 13","base":12.73,"cuota":1.27,"total":14.0},
    {"numero":5014,"contador":"Facturas","fecha":"2026-11-09 15:29:30","orden":"700014","canal":"--","nif":null,"cliente":null,"base":29.13,"cuota":2.91,"total":32.04},
    {"numero":5015,"contador":"Facturas","fecha":"2026-11-09 15:42:30","orden":"700015","canal":"--","nif":null,"cliente":null,"base":17.75,"cuota":1.77,"total":19.52},
    {"numero":5016,"contador":"Facturas","fecha":"2026-11-09 15:55:30","orden":"700016","canal":"--","nif":null,"cliente":null,"base":23.4,"cuota":2.34,"total":25.74},
    {"numero":5017,"contador":"Facturas","fecha":"2026-11-09 16:08:30","orden":"700017","canal":"--","nif":null,"cliente":null,"base":26.95,"cuota":2.7,"total":29.65},
    {"numero":5018,"contador":"Facturas","fecha":"2026-11-09 16:21:30","orden":"700018","canal":"UberEats","nif":null,"cliente":"Cliente de ejemplo 18","base":9.84,"cuota":0.98,"total":10.82},
    {"numero":5019,"contador":"Facturas","fecha":"2026-11-09 16:34:30","orden":"700019","canal":"Glovo","nif":null,"cliente":"Cliente de ejemplo 19","base":34.85,"cuota":3.49,"total":38.34},
    {"numero":5020,"contador":"Facturas","fecha":"2026-11-09 16:47:30","orden":"700020","canal":"--","nif":"B00000000","cliente":"Cliente de ejemplo 20","base":15.57,"cuota":1.56,"total":17.13},
    {"numero":5021,"contador":"Facturas","fecha":"2026-11-09 17:00:30","orden":"700021","canal":"--","nif":null,"cliente":null,"base":17.04,"cuota":1.7,"total":18.74},
    {"numero":5022,"contador":"Facturas","fecha":"2026-11-09 17:13:30","orden":"700022","canal":"UberEats","nif":null,"cliente":"Cliente de ejemplo 22","base":8.53,"cuota":0.85,"total":9.38},
    {"numero":5023,"contador":"Facturas","fecha":"2026-11-09 17:26:30","orden":"700023","canal":"--","nif":null,"cliente":null,"base":20.5,"cuota":2.05,"total":22.55},
    {"numero":5024,"contador":"Facturas","fecha":"2026-11-09 17:39:30","orden":"700024","canal":"UberEats","nif":null,"cliente":"Cliente de ejemplo 24","base":27.36,"cuota":2.74,"total":30.1},
    {"numero":5025,"contador":"Facturas","fecha":"2026-11-09 17:52:30","orden":"700025","canal":"--","nif":null,"cliente":null,"base":14.13,"cuota":1.41,"total":15.54},
    {"numero":5026,"contador":"Facturas","fecha":"2026-11-09 18:05:30","orden":"700026","canal":"UberEats","nif":null,"cliente":"Cliente de ejemplo 26","base":30.1,"cuota":3.01,"total":33.11},
    {"numero":5027,"contador":"Facturas","fecha":"2026-11-09 18:18:30","orden":"700027","canal":"Glovo","nif":null,"cliente":"Cliente de ejemplo 27","base":13.93,"cuota":1.39,"total":15.32},
    {"numero":5028,"contador":"Facturas","fecha":"2026-11-09 18:31:30","orden":"700028","canal":"--","nif":null,"cliente":null,"base":40.0,"cuota":4.0,"total":44.0},
    {"numero":5029,"contador":"Facturas","fecha":"2026-11-09 18:44:30","orden":"700029","canal":"--","nif":null,"cliente":null,"base":13.26,"cuota":1.33,"total":14.59},
    {"numero":5030,"contador":"Facturas","fecha":"2026-11-09 18:57:30","orden":"700030","canal":"--","nif":null,"cliente":null,"base":24.21,"cuota":2.42,"total":26.63},
    {"numero":5031,"contador":"Facturas","fecha":"2026-11-09 19:10:30","orden":"700031","canal":"Glovo","nif":null,"cliente":"Cliente de ejemplo 31","base":26.58,"cuota":2.66,"total":29.24},
    {"numero":5032,"contador":"Facturas","fecha":"2026-11-09 19:23:30","orden":"700032","canal":"--","nif":null,"cliente":null,"base":11.35,"cuota":1.14,"total":12.49},
    {"numero":5033,"contador":"Facturas","fecha":"2026-11-09 19:36:30","orden":"700033","canal":"--","nif":null,"cliente":null,"base":20.47,"cuota":2.05,"total":22.52},
    {"numero":5034,"contador":"Facturas","fecha":"2026-11-09 19:49:30","orden":"700034","canal":"--","nif":null,"cliente":null,"base":12.89,"cuota":1.29,"total":14.18},
    {"numero":5035,"contador":"Facturas","fecha":"2026-11-09 20:02:30","orden":"700035","canal":"--","nif":null,"cliente":null,"base":22.48,"cuota":2.25,"total":24.73},
    {"numero":5036,"contador":"Facturas","fecha":"2026-11-09 20:15:30","orden":"700036","canal":"Glovo","nif":null,"cliente":"Cliente de ejemplo 36","base":8.79,"cuota":0.88,"total":9.67},
    {"numero":5037,"contador":"Facturas","fecha":"2026-11-09 20:28:30","orden":"700037","canal":"--","nif":null,"cliente":null,"base":10.87,"cuota":1.09,"total":11.96},
    {"numero":5038,"contador":"Facturas","fecha":"2026-11-09 20:41:30","orden":"700038","canal":"UberEats","nif":null,"cliente":"Cliente de ejemplo 38","base":25.33,"cuota":2.53,"total":27.86},
    {"numero":5039,"contador":"Facturas","fecha":"2026-11-09 20:54:30","orden":"700039","canal":"Glovo","nif":null,"cliente":"Cliente de ejemplo 39","base":32.39,"cuota":3.24,"total":35.63},
    {"numero":5040,"contador":"Facturas","fecha":"2026-11-09 21:07:30","orden":"700040","canal":"Glovo","nif":null,"cliente":"Cliente de ejemplo 40","base":21.7,"cuota":2.17,"total":23.87},
    {"numero":5041,"contador":"Facturas","fecha":"2026-11-09 21:20:30","orden":"700041","canal":"--","nif":null,"cliente":null,"base":32.51,"cuota":3.25,"total":35.76},
    {"numero":5042,"contador":"Facturas","fecha":"2026-11-09 21:33:30","orden":"700042","canal":"--","nif":null,"cliente":null,"base":15.12,"cuota":1.51,"total":16.63},
    {"numero":5043,"contador":"Facturas","fecha":"2026-11-09 21:46:30","orden":"700043","canal":"Glovo","nif":null,"cliente":"Cliente de ejemplo 43","base":18.94,"cuota":1.89,"total":20.83},
    {"numero":5044,"contador":"Facturas","fecha":"2026-11-09 21:59:30","orden":"700044","canal":"--","nif":null,"cliente":null,"base":18.36,"cuota":1.84,"total":20.2},
    {"numero":5045,"contador":"Facturas","fecha":"2026-11-09 22:12:30","orden":"700045","canal":"Glovo","nif":null,"cliente":"Cliente de ejemplo 45","base":26.55,"cuota":2.65,"total":29.2},
    {"numero":5046,"contador":"Facturas","fecha":"2026-11-09 22:25:30","orden":"700046","canal":"--","nif":null,"cliente":null,"base":18.27,"cuota":1.83,"total":20.1},
    {"numero":5047,"contador":"Facturas","fecha":"2026-11-09 22:38:30","orden":"700047","canal":"Glovo","nif":null,"cliente":"Cliente de ejemplo 47","base":-10.0,"cuota":-1.0,"total":-11.0},
    {"numero":5048,"contador":"Facturas","fecha":"2026-11-09 22:51:30","orden":"700048","canal":"Glovo","nif":null,"cliente":"Cliente de ejemplo 48","base":23.06,"cuota":2.31,"total":25.37}
  ],
  "impuestos": [
    {"orden":"700001","tipo":10.0,"base":30.23,"cuota":3.02},
    {"orden":"700002","tipo":10.0,"base":18.12,"cuota":1.81},
    {"orden":"700003","tipo":10.0,"base":15.78,"cuota":1.58},
    {"orden":"700004","tipo":10.0,"base":32.05,"cuota":3.21},
    {"orden":"700005","tipo":10.0,"base":15.67,"cuota":1.57},
    {"orden":"700006","tipo":10.0,"base":16.19,"cuota":1.62},
    {"orden":"700007","tipo":10.0,"base":36.44,"cuota":3.64},
    {"orden":"700008","tipo":10.0,"base":11.22,"cuota":1.12},
    {"orden":"700009","tipo":10.0,"base":19.59,"cuota":1.96},
    {"orden":"700010","tipo":10.0,"base":25.77,"cuota":2.58},
    {"orden":"700011","tipo":10.0,"base":28.1,"cuota":2.81},
    {"orden":"700012","tipo":10.0,"base":35.89,"cuota":3.59},
    {"orden":"700013","tipo":10.0,"base":12.73,"cuota":1.27},
    {"orden":"700014","tipo":10.0,"base":29.13,"cuota":2.91},
    {"orden":"700015","tipo":10.0,"base":17.75,"cuota":1.77},
    {"orden":"700016","tipo":10.0,"base":23.4,"cuota":2.34},
    {"orden":"700017","tipo":10.0,"base":26.95,"cuota":2.7},
    {"orden":"700018","tipo":10.0,"base":9.84,"cuota":0.98},
    {"orden":"700019","tipo":10.0,"base":34.85,"cuota":3.49},
    {"orden":"700020","tipo":10.0,"base":15.57,"cuota":1.56},
    {"orden":"700021","tipo":10.0,"base":17.04,"cuota":1.7},
    {"orden":"700022","tipo":10.0,"base":8.53,"cuota":0.85},
    {"orden":"700023","tipo":10.0,"base":20.5,"cuota":2.05},
    {"orden":"700024","tipo":10.0,"base":27.36,"cuota":2.74},
    {"orden":"700025","tipo":10.0,"base":14.13,"cuota":1.41},
    {"orden":"700026","tipo":10.0,"base":30.1,"cuota":3.01},
    {"orden":"700027","tipo":10.0,"base":13.93,"cuota":1.39},
    {"orden":"700028","tipo":10.0,"base":40.0,"cuota":4.0},
    {"orden":"700029","tipo":10.0,"base":13.26,"cuota":1.33},
    {"orden":"700030","tipo":10.0,"base":24.21,"cuota":2.42},
    {"orden":"700031","tipo":10.0,"base":26.58,"cuota":2.66},
    {"orden":"700032","tipo":10.0,"base":11.35,"cuota":1.14},
    {"orden":"700033","tipo":10.0,"base":20.47,"cuota":2.05},
    {"orden":"700034","tipo":10.0,"base":12.89,"cuota":1.29},
    {"orden":"700035","tipo":10.0,"base":22.48,"cuota":2.25},
    {"orden":"700036","tipo":10.0,"base":8.79,"cuota":0.88},
    {"orden":"700037","tipo":10.0,"base":10.87,"cuota":1.09},
    {"orden":"700038","tipo":10.0,"base":25.33,"cuota":2.53},
    {"orden":"700039","tipo":10.0,"base":32.39,"cuota":3.24},
    {"orden":"700040","tipo":10.0,"base":21.7,"cuota":2.17},
    {"orden":"700041","tipo":10.0,"base":32.51,"cuota":3.25},
    {"orden":"700042","tipo":10.0,"base":15.12,"cuota":1.51},
    {"orden":"700043","tipo":10.0,"base":18.94,"cuota":1.89},
    {"orden":"700044","tipo":10.0,"base":18.36,"cuota":1.84},
    {"orden":"700045","tipo":10.0,"base":26.55,"cuota":2.65},
    {"orden":"700046","tipo":10.0,"base":18.27,"cuota":1.83},
    {"orden":"700047","tipo":10.0,"base":-10.0,"cuota":-1.0},
    {"orden":"700048","tipo":10.0,"base":23.06,"cuota":2.31}
  ],
  "cobros": [
    {"fila":1,"orden":"700001","forma":"Deliverect","importe":33.25},
    {"fila":2,"orden":"700002","forma":"Deliverect","importe":19.93},
    {"fila":3,"orden":"700003","forma":"Deliverect","importe":17.36},
    {"fila":4,"orden":"700004","forma":"Deliverect","importe":35.26},
    {"fila":5,"orden":"700005","forma":"Efectivo","importe":17.24},
    {"fila":6,"orden":"700006","forma":"Efectivo","importe":17.81},
    {"fila":7,"orden":"700007","forma":"Tarjeta","importe":40.08},
    {"fila":8,"orden":"700008","forma":"Efectivo","importe":12.34},
    {"fila":9,"orden":"700009","forma":"Deliverect","importe":21.55},
    {"fila":10,"orden":"700010","forma":"Tarjeta","importe":28.35},
    {"fila":11,"orden":"700011","forma":"Deliverect","importe":30.91},
    {"fila":12,"orden":"700012","forma":"Tarjeta","importe":39.48},
    {"fila":13,"orden":"700013","forma":"Deliverect","importe":14.0},
    {"fila":14,"orden":"700014","forma":"Tarjeta","importe":32.04},
    {"fila":15,"orden":"700015","forma":"Efectivo","importe":19.52},
    {"fila":16,"orden":"700016","forma":"Efectivo","importe":25.74},
    {"fila":17,"orden":"700017","forma":"Tarjeta","importe":29.65},
    {"fila":18,"orden":"700018","forma":"Deliverect","importe":10.82},
    {"fila":19,"orden":"700019","forma":"Deliverect","importe":38.34},
    {"fila":20,"orden":"700020","forma":"Tarjeta","importe":17.13},
    {"fila":21,"orden":"700021","forma":"Tarjeta","importe":18.74},
    {"fila":22,"orden":"700022","forma":"Deliverect","importe":9.38},
    {"fila":23,"orden":"700023","forma":"Tarjeta","importe":22.55},
    {"fila":24,"orden":"700024","forma":"Deliverect","importe":30.1},
    {"fila":25,"orden":"700025","forma":"Tarjeta","importe":15.54},
    {"fila":26,"orden":"700026","forma":"Deliverect","importe":33.11},
    {"fila":27,"orden":"700027","forma":"Deliverect","importe":15.32},
    {"fila":28,"orden":"700028","forma":"Efectivo","importe":20.0},
    {"fila":29,"orden":"700028","forma":"Tarjeta","importe":24.0},
    {"fila":30,"orden":"700029","forma":"Tarjeta","importe":14.59},
    {"fila":31,"orden":"700030","forma":"Tarjeta","importe":26.63},
    {"fila":32,"orden":"700031","forma":"Deliverect","importe":29.24},
    {"fila":33,"orden":"700032","forma":"Tarjeta","importe":12.49},
    {"fila":34,"orden":"700033","forma":"Efectivo","importe":22.52},
    {"fila":35,"orden":"700034","forma":"Tarjeta","importe":14.18},
    {"fila":36,"orden":"700035","forma":"Efectivo","importe":24.73},
    {"fila":37,"orden":"700036","forma":"Deliverect","importe":9.67},
    {"fila":38,"orden":"700037","forma":"Tarjeta","importe":11.96},
    {"fila":39,"orden":"700038","forma":"Deliverect","importe":27.86},
    {"fila":40,"orden":"700039","forma":"Deliverect","importe":35.63},
    {"fila":41,"orden":"700040","forma":"Deliverect","importe":23.87},
    {"fila":42,"orden":"700041","forma":"Tarjeta","importe":35.76},
    {"fila":43,"orden":"700042","forma":"Tarjeta","importe":16.63},
    {"fila":44,"orden":"700043","forma":"Deliverect","importe":20.83},
    {"fila":45,"orden":"700044","forma":"Tarjeta","importe":20.2},
    {"fila":46,"orden":"700045","forma":"Deliverect","importe":29.2},
    {"fila":47,"orden":"700046","forma":"Efectivo","importe":20.1},
    {"fila":48,"orden":"700047","forma":"Deliverect","importe":-11.0},
    {"fila":49,"orden":"700048","forma":"Deliverect","importe":25.37}
  ]}
$ejemplo$::jsonb);
grant select on _prueba_r03 to authenticated;

-- Una parada: tiene que parar con esa pista y esa frase, y no dejar nada.
create function pg_temp.r03_para(p_company uuid, p_dia date, p_j jsonb, p_hint text, p_frase text, p_que text) returns void
language plpgsql as $f$
declare v_msg text; v_hint text;
begin
  begin
    perform public.conta_tpv_dia_guardar(p_company, p_dia, 'revo', p_j, 'Prueba R03');
  exception when others then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
    if v_hint is distinct from p_hint or v_msg is distinct from p_frase then
      raise exception 'PRUEBA R03 · %: esperaba «%» (%) y salió «%» (%).', p_que, p_frase, p_hint, v_msg, v_hint;
    end if;
    raise notice '% OK: «%»', p_que, v_msg;
    return;
  end;
  raise exception 'PRUEBA R03 · %: no ha parado.', p_que;
end $f$;

-- 1 · Lo que crea -------------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from public.company_tax_profile where ventas_por_dia) then
    raise exception 'PRUEBA R03 · 1: hay empresas con «ventas por día» encendido; tiene que nacer apagado en todas.';
  end if;
  foreach t in array array['conta_tpv_dia', 'conta_tpv_documento', 'conta_tpv_impuesto', 'conta_tpv_cobro', 'conta_tpv_forma_cuenta'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception 'PRUEBA R03 · 1: % no tiene permisos por fila.', t;
    end if;
    if not has_table_privilege('authenticated', 'public.' || t, 'select') or has_table_privilege('anon', 'public.' || t, 'select') then
      raise exception 'PRUEBA R03 · 1: % no se lee como se espera (authenticated sí, anon no).', t;
    end if;
    if t <> 'conta_tpv_forma_cuenta' and (has_table_privilege('authenticated', 'public.' || t, 'insert')
        or has_table_privilege('authenticated', 'public.' || t, 'update') or has_table_privilege('authenticated', 'public.' || t, 'delete')) then
      raise exception 'PRUEBA R03 · 1: un usuario puede escribir en % sin pasar por conta_tpv_dia_guardar.', t;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.conta_tpv_dia_guardar(uuid, date, text, jsonb, text)', 'execute')
     or has_function_privilege('anon', 'public.conta_tpv_dia_leer(uuid, date, text)', 'execute')
     or has_function_privilege('authenticated', 'public._conta_tpv_lista(text[])', 'execute') then
    raise exception 'PRUEBA R03 · 1: anon ejecuta una función del TPV, o un usuario la interna.';
  end if;
  raise notice '1 OK: interruptor apagado en las % empresas con perfil; RLS en las cinco tablas; las del día, solo por la función.',
    (select count(*) from public.company_tax_profile);
end $$;

-- 2 · El día del ejemplo entra en E1 -----------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'ae030000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb; e1 constant uuid := 'ae030000-0000-4000-8000-000000000011'; v_id uuid;
begin
  r := public.conta_tpv_dia_guardar(e1, date '2026-11-09', 'revo', (select j from _prueba_r03 where clave = 'ejemplo'), 'Prueba R03');
  raise notice '2 · devuelve: %', r ->> 'texto';
  if (r ->> 'documentos')::int <> 48 or (r ->> 'primero')::bigint <> 5001 or (r ->> 'ultimo')::bigint <> 5048
     or (r ->> 'total')::numeric <> 1100 or (r ->> 'base')::numeric <> 999.99 or (r ->> 'cuota')::numeric <> 100.01
     or (r ->> 'sustituido')::boolean then
    raise exception 'PRUEBA R03 · 2: el día no es el del ejemplo: %', r;
  end if;
  if r -> 'por_forma' <> '[{"forma":"Deliverect","importe":500.00},{"forma":"Efectivo","importe":180.00},{"forma":"Tarjeta","importe":420.00}]'::jsonb then
    raise exception 'PRUEBA R03 · 2: por forma de pago sale %', r -> 'por_forma';
  end if;
  if r ->> 'texto' <> 'Guardadas las ventas del 09/11/2026: 48 facturas, de la 5001 a la 5048, 1.100,00 € (base 999,99 € e IVA 100,01 €). Por forma de pago: Deliverect 500,00 € · Efectivo 180,00 € · Tarjeta 420,00 €.' then
    raise exception 'PRUEBA R03 · 2: la frase es «%».', r ->> 'texto';
  end if;
  v_id := (r ->> 'id')::uuid;
  if (select count(*) from public.conta_tpv_documento where dia_id = v_id) <> 48
     or (select count(*) from public.conta_tpv_impuesto i join public.conta_tpv_documento d on d.id = i.documento_id where d.dia_id = v_id) <> 48
     or (select count(*) from public.conta_tpv_cobro where dia_id = v_id) <> 49 then
    raise exception 'PRUEBA R03 · 2: no están las 48 facturas, los 48 renglones de IVA y los 49 cobros.';
  end if;
  if (select string_agg(forma || ' ' || importe, ' + ' order by fila) from public.conta_tpv_cobro where dia_id = v_id and orden = '700028') <> 'Efectivo 20.00 + Tarjeta 24.00' then
    raise exception 'PRUEBA R03 · 2: la orden pagada en dos veces no son dos cobros (Efectivo 20 + Tarjeta 24).';
  end if;
  if (select numero || ' ' || canal || ' ' || total from public.conta_tpv_documento where dia_id = v_id and total < 0) <> '5047 Glovo -11.00' then
    raise exception 'PRUEBA R03 · 2: la devolución no es la 5047 de Glovo en negativo.';
  end if;
  if (select string_agg(numero::text, ',' order by numero) from public.conta_tpv_documento where dia_id = v_id and cliente_nif = 'B00000000') <> '5007,5020' then
    raise exception 'PRUEBA R03 · 2: las facturas con NIF no son la 5007 y la 5020.';
  end if;
  r := public.conta_tpv_dia_leer(e1, date '2026-11-09');
  -- Sin depender del orden: staging y la base local ordenan el texto distinto («local» y «UberEats»).
  if (select jsonb_object_agg(x ->> 'canal', (x ->> 'total')::numeric) from jsonb_array_elements(r -> 'por_canal') x)
       <> '{"Glovo":300.00,"UberEats":200.00,"local":600.00}'::jsonb then
    raise exception 'PRUEBA R03 · 2: por canal sale %', r -> 'por_canal';
  end if;
  if r -> 'por_tipo' <> '[{"tipo":10.00,"base":999.99,"cuota":100.01}]'::jsonb or jsonb_array_length(r -> 'facturas') <> 48 or jsonb_array_length(r -> 'cobros') <> 49 then
    raise exception 'PRUEBA R03 · 2: leer el día no da lo guardado (por tipo %).', r -> 'por_tipo';
  end if;
  raise notice '2 OK: 48 facturas (5001 a 5048), 1.100,00 € = 999,99 + 100,01; Deliverect 500, Efectivo 180, Tarjeta 420; por canal %; la 700028 en dos cobros; la 5047 en negativo; NIF en la 5007 y la 5020.',
    (select string_agg((x ->> 'canal') || ' ' || (x ->> 'total'), ', ') from jsonb_array_elements(r -> 'por_canal') x);
end $$;

-- 3 · Subirlo otra vez lo sustituye y deja lo mismo -----------------------------------------
do $$
declare r jsonb; e1 constant uuid := 'ae030000-0000-4000-8000-000000000011'; v_antes text; v_despues text; v_id uuid;
begin
  v_id := (public.conta_tpv_dia_leer(e1, date '2026-11-09') ->> 'id')::uuid;
  v_antes := md5((public.conta_tpv_dia_leer(e1, date '2026-11-09') - 'subido_en')::text);
  r := public.conta_tpv_dia_guardar(e1, date '2026-11-09', 'revo', (select j from _prueba_r03 where clave = 'ejemplo'), 'Prueba R03');
  v_despues := md5((public.conta_tpv_dia_leer(e1, date '2026-11-09') - 'subido_en')::text);
  if not (r ->> 'sustituido')::boolean or (r ->> 'id')::uuid <> v_id or v_antes <> v_despues then
    raise exception 'PRUEBA R03 · 3: subirlo otra vez no deja lo mismo (id % → %, huella % → %).', v_id, r ->> 'id', v_antes, v_despues;
  end if;
  if (select count(*) from public.conta_tpv_dia where company_id = e1) <> 1 or (select count(*) from public.conta_tpv_documento where company_id = e1) <> 48
     or (select count(*) from public.conta_tpv_impuesto where company_id = e1) <> 48 or (select count(*) from public.conta_tpv_cobro where company_id = e1) <> 49 then
    raise exception 'PRUEBA R03 · 3: subirlo otra vez ha duplicado filas.';
  end if;
  raise notice '3 OK: «%» Mismo día, misma huella (%), 1 día, 48 facturas, 48 de IVA y 49 cobros.', r ->> 'texto', v_despues;
end $$;

-- 4 · Una empresa no ve el día de la otra ---------------------------------------------------
do $$
declare r jsonb; e1 constant uuid := 'ae030000-0000-4000-8000-000000000011'; e2 constant uuid := 'ae030000-0000-4000-8000-000000000012';
  v_e1 text; v_otra jsonb;
begin
  v_e1 := md5((public.conta_tpv_dia_leer(e1, date '2026-11-09') - 'subido_en')::text);
  if public.conta_tpv_dia_leer(e2, date '2026-11-09') is not null then
    raise exception 'PRUEBA R03 · 4: E2 lee el día de E1 antes de tener el suyo.';
  end if;
  -- El mismo día en E2, con la devolución quitada (otro día distinto del de E1).
  v_otra := jsonb_build_object(
    'documentos', (select jsonb_agg(d) from jsonb_array_elements((select j from _prueba_r03 where clave = 'ejemplo') -> 'documentos') d where d ->> 'orden' <> '700047'),
    'impuestos', (select jsonb_agg(i) from jsonb_array_elements((select j from _prueba_r03 where clave = 'ejemplo') -> 'impuestos') i where i ->> 'orden' <> '700047'),
    'cobros', (select jsonb_agg(c) from jsonb_array_elements((select j from _prueba_r03 where clave = 'ejemplo') -> 'cobros') c where c ->> 'orden' <> '700047'));
  -- Sin la 5047 hay un salto: se renumeran la 5048 a la 5047 para que sea un día que cuadra.
  v_otra := jsonb_set(v_otra, '{documentos}', (select jsonb_agg(case when (d ->> 'numero')::int = 5048 then jsonb_set(d, '{numero}', '5047') else d end)
                                                  from jsonb_array_elements(v_otra -> 'documentos') d));
  r := public.conta_tpv_dia_guardar(e2, date '2026-11-09', 'revo', v_otra, 'Prueba R03');
  if (r ->> 'documentos')::int <> 47 or (r ->> 'total')::numeric <> 1111 or (r ->> 'sustituido')::boolean then
    raise exception 'PRUEBA R03 · 4: el día de E2 no es el suyo: %', r;
  end if;
  if md5((public.conta_tpv_dia_leer(e1, date '2026-11-09') - 'subido_en')::text) <> v_e1 or (public.conta_tpv_dia_leer(e1, date '2026-11-09') ->> 'total')::numeric <> 1100
     or (public.conta_tpv_dia_leer(e2, date '2026-11-09') ->> 'total')::numeric <> 1111
     or (select count(*) from public.conta_tpv_dia where dia = date '2026-11-09' and company_id in (e1, e2)) <> 2 then
    raise exception 'PRUEBA R03 · 4: guardar en E2 ha cambiado E1, o leer no da a cada una lo suyo.';
  end if;
  raise notice '4 OK: E1 sigue con 1.100,00 € (misma huella) y E2 tiene lo suyo: «%»', r ->> 'texto';
end $$;
reset role;

-- …y otra cuenta no lo ve ni lo toca (u2).
select set_config('request.jwt.claims', json_build_object('sub', 'ae030000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare e1 constant uuid := 'ae030000-0000-4000-8000-000000000011'; v_msg text;
begin
  if exists (select 1 from public.conta_tpv_dia where company_id = e1) or exists (select 1 from public.conta_tpv_documento where company_id = e1)
     or exists (select 1 from public.conta_tpv_cobro where company_id = e1) then
    raise exception 'PRUEBA R03 · 4: un usuario de otra cuenta ve las ventas de E1 en las tablas.';
  end if;
  begin
    perform public.conta_tpv_dia_leer(e1, date '2026-11-09');
    raise exception 'PRUEBA R03 · 4: un usuario de otra cuenta lee el día de E1.';
  exception when sqlstate 'P0002' then v_msg := sqlerrm;
  end;
  begin
    perform public.conta_tpv_dia_guardar(e1, date '2026-11-10', 'revo', (select j from _prueba_r03 where clave = 'ejemplo'), 'Prueba R03');
    raise exception 'PRUEBA R03 · 4: un usuario de otra cuenta guarda en E1.';
  exception when sqlstate 'P0002' then null;
  end;
  raise notice '4 OK: otra cuenta no ve las filas de E1, y leer o guardar en E1 le dice «%».', v_msg;
end $$;
reset role;

-- 5 · Las paradas ---------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'ae030000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare e1 constant uuid := 'ae030000-0000-4000-8000-000000000011'; e2 constant uuid := 'ae030000-0000-4000-8000-000000000012';
  e3 constant uuid := 'ae030000-0000-4000-8000-000000000013';
  j jsonb := (select j from _prueba_r03 where clave = 'ejemplo'); v_antes text; v_n int;
begin
  v_antes := md5((public.conta_tpv_dia_leer(e1, date '2026-11-09') - 'subido_en')::text);
  -- a · Los totales: un pago de 11,00 € de menos (la 700001 cobrada en 22,25 en vez de 33,25)…
  perform pg_temp.r03_para(e1, date '2026-11-09',
    jsonb_set(j, '{cobros}', (select jsonb_agg(case when (c ->> 'fila')::int = 1 then jsonb_set(c, '{importe}', '22.25') else c end) from jsonb_array_elements(j -> 'cobros') c)),
    'r03:cuadre', 'Los pagos suman 1.089,00 € y las facturas 1.100,00 €. Faltan 11,00 €. Mira la orden 700001.', '5a · pagos de menos');
  -- …y sin el pago de la devolución (−11,00), sobran.
  perform pg_temp.r03_para(e1, date '2026-11-09',
    jsonb_set(j, '{cobros}', (select jsonb_agg(c) from jsonb_array_elements(j -> 'cobros') c where c ->> 'orden' <> '700047')),
    'r03:cuadre', 'Los pagos suman 1.111,00 € y las facturas 1.100,00 €. Sobran 11,00 €. Mira la orden 700047.', '5a · pagos de más');
  -- …y el IVA desglosado sin la orden 700001.
  perform pg_temp.r03_para(e1, date '2026-11-09',
    jsonb_set(j, '{impuestos}', (select jsonb_agg(i) from jsonb_array_elements(j -> 'impuestos') i where i ->> 'orden' <> '700001')),
    'r03:cuadre', 'El IVA desglosado suma 1.066,75 € y las facturas 1.100,00 €. Faltan 33,25 €.', '5a · IVA de menos');
  -- b · La numeración: sin la factura 5013…
  perform pg_temp.r03_para(e1, date '2026-11-09',
    jsonb_set(j, '{documentos}', (select jsonb_agg(d) from jsonb_array_elements(j -> 'documentos') d where (d ->> 'numero')::int <> 5013)),
    'r03:numeracion', 'Falta la factura 5013.', '5b · falta una');
  -- …y con la 5013 dos veces.
  perform pg_temp.r03_para(e1, date '2026-11-09',
    jsonb_set(j, '{documentos}', (j -> 'documentos') || (select jsonb_agg(d) from jsonb_array_elements(j -> 'documentos') d where (d ->> 'numero')::int = 5013)),
    'r03:numeracion', 'La factura 5013 está dos veces (sube los ficheros de una sola exportación).', '5b · repetida');
  -- c · El día de inicio: E3 empieza el 01/12/2026.
  perform pg_temp.r03_para(e3, date '2026-11-09', j, 'r03:dia_de_inicio',
    'Las ventas del 09/11/2026 son de antes de tu día de inicio en Sumied (01/12/2026): son del programa de antes y no se guardan.', '5c · antes del día de inicio');
  -- e · La tolerancia de redondeo: una factura de 11,50 € con 1,50 € de IVA al 10 % (1,00 €) se pasa.
  perform pg_temp.r03_para(e2, date '2026-11-10',
    '{"documentos":[{"numero":1,"contador":"Facturas","fecha":"2026-11-10 13:00:00","orden":"1","canal":"--","base":10.00,"cuota":1.50,"total":11.50}],
      "impuestos":[{"orden":"1","tipo":10,"base":10.00,"cuota":1.50}],"cobros":[{"fila":1,"orden":"1","forma":"Efectivo","importe":11.50}]}'::jsonb,
    'r03:cuadre', 'El IVA al 10 % (1,50 €) no sale de su base (10,00 € × 10 % = 1,00 €): se aleja más de medio céntimo por factura.', '5e · redondeo de más');
  -- Ninguna parada ha dejado nada.
  if md5((public.conta_tpv_dia_leer(e1, date '2026-11-09') - 'subido_en')::text) <> v_antes
     or exists (select 1 from public.conta_tpv_dia where company_id in (e2, e3) and dia <> date '2026-11-09' or company_id = e3) then
    raise exception 'PRUEBA R03 · 5: una parada ha dejado algo guardado o ha cambiado E1.';
  end if;
  raise notice '5 OK: las paradas a, b, c y e no dejan nada; E1 sigue con su huella.';
end $$;
reset role;

-- d · El día contabilizado (lo marcará el PR 3; aquí se pone a mano) ya no se sustituye.
update public.conta_tpv_dia set estado = 'contabilizado' where company_id = 'ae030000-0000-4000-8000-000000000011' and dia = date '2026-11-09';
set local role authenticated;
do $$
declare e1 constant uuid := 'ae030000-0000-4000-8000-000000000011'; v_antes text;
begin
  v_antes := md5((public.conta_tpv_dia_leer(e1, date '2026-11-09') - 'subido_en')::text);
  perform pg_temp.r03_para(e1, date '2026-11-09', (select j from _prueba_r03 where clave = 'ejemplo'), 'r03:contabilizado',
    'Las ventas del 09/11/2026 ya están contabilizadas: no se cambian. Si hay que corregir algo, se hace desde su asiento.', '5d · ya contabilizado');
  if md5((public.conta_tpv_dia_leer(e1, date '2026-11-09') - 'subido_en')::text) <> v_antes then
    raise exception 'PRUEBA R03 · 5d: el día contabilizado ha cambiado.';
  end if;
  raise notice '5 OK: el día contabilizado sigue igual.';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 6 · Las vueltas atrás, sobre estos datos ----------------------------------------------
delete from public.conta_tpv_dia where account_id = 'ae030000-0000-4000-8000-000000000010';
\i supabase/vuelta-atras/20261117T0951_r03_ventas_tpv_funciones.down.sql
\i supabase/vuelta-atras/20261117T0950_r03_ventas_tpv_tablas.down.sql
do $$ begin
  if to_regprocedure('public.conta_tpv_dia_guardar(uuid, date, text, jsonb, text)') is not null
     or to_regprocedure('public.conta_tpv_dia_leer(uuid, date, text)') is not null or to_regprocedure('public._conta_tpv_lista(text[])') is not null then
    raise exception 'PRUEBA R03 · 6: la vuelta atrás dejó alguna función.';
  end if;
  if to_regclass('public.conta_tpv_dia') is not null or to_regclass('public.conta_tpv_documento') is not null or to_regclass('public.conta_tpv_impuesto') is not null
     or to_regclass('public.conta_tpv_cobro') is not null or to_regclass('public.conta_tpv_forma_cuenta') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company_tax_profile' and column_name = 'ventas_por_dia') then
    raise exception 'PRUEBA R03 · 6: la vuelta atrás dejó alguna tabla o el interruptor.';
  end if;
  raise notice 'PRUEBA R03: 6 de 6 bien.';
end $$;

rollback;
