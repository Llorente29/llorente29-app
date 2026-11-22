-- supabase/staging/sql/20261122_r16_erp10_dia_por_serie_prueba.sql
--
-- SOLO STAGING. Prueba del R16 (20261122T0810_r16_erp10_dia_por_serie_anade), que el ensayo de staging pone delante
-- en la misma sesión. Todo en una transacción con ROLLBACK: staging no cambia.
-- Lo que crea: public._conta_tpv_cliente_cuenta, public.conta_erp10_clientes_tpv y public.conta_erp10_dias_tpv_libro.
--
-- Monta lo mismo que la prueba del R15b (una cuenta inventada, su administrador u y la empresa T, de hostelería, que
-- sube días del TPV: el ejemplo INVENTADO de Revo, con sus dos facturas con NIF B00000000), por sus CAMINOS:
--   1. Lo que crea y los permisos.
--   2. Un día con dos series, dos facturas con NIF (del mismo cliente) y una devolución, contabilizado: su libro
--      repartido (R15b).
--   3. conta_erp10_clientes_tpv: el cliente B00000000 no tiene ficha en Sumied: se crea (tercero, cliente y su 430, la
--      siguiente libre) y lo dice; la segunda vez ya lo tiene y no crea nada.
--   4. conta_erp10_dias_tpv_libro: las cinco filas del libro del día, cada factura con NIF con la 430 de su cliente; y
--      esa 430, con su NIF y su nombre, para las fichas nuevas.
--   5. La vuelta atrás quita las funciones; el cliente dado de alta se queda (es una ficha de Sumied).
--
-- Como el cliente: u en request.jwt.claims, con el rol authenticated.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA R16: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

-- 0 · La cuenta, su administrador y las tres empresas ------------------------------------
do $$
declare
  u constant uuid := 'ae160000-0000-4000-8000-000000000001';
  x constant uuid := 'ae160000-0000-4000-8000-000000000010';
  f constant uuid := 'ae160000-0000-4000-8000-000000000011';
  t constant uuid := 'ae160000-0000-4000-8000-000000000012';
  d constant uuid := 'ae160000-0000-4000-8000-000000000013';
  lf constant uuid := 'ae160000-0000-4000-8000-000000000021';
  lt constant uuid := 'ae160000-0000-4000-8000-000000000022';
  ch constant uuid := 'ae160000-0000-4000-8000-000000000031';
  pg constant uuid := 'ae160000-0000-4000-8000-000000000041';
  e uuid; c uuid;
  r10 uuid := (select id from public.tax_rate where code = 'iva_reducido' and is_system and valid_to is null limit 1);
  r21 uuid := (select id from public.tax_rate where code = 'iva_general' and is_system and valid_to is null limit 1);
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'tpv@r16-prueba.test',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into public.accounts (id, name, slug, status, business_type, product_brand) values (x, 'Prueba R16', 'r16-prueba', 'active', 'otra_actividad', 'contabilidad');
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
  values (u, x, 'admin', true, 'Prueba R16', now(), now());
  insert into public.company (id, account_id, legal_name, tax_id, setup_step) values
    (f, x, 'Prueba R16 Folvy, S.L.', 'A00000000', 'nombre'), (t, x, 'Prueba R16 TPV, S.L.', 'B00000000', 'nombre'), (d, x, 'Prueba R16 Diez, S.L.', 'E00000000', 'nombre');
  insert into public.locations (id, account_id, name) values (lf, x, 'Local de prueba F'), (lt, x, 'Local de prueba T');
  insert into public.location_company (location_id, company_id, account_id) values (lf, f, x), (lt, t, x);
  foreach e in array array[f, t, d] loop
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (x, e, '2026', date '2026-01-01', date '2026-12-31');
    insert into public.company_tax_profile (company_id, account_id, chart_kind, account_digits, sales_tax_rate_code) values (e, x, 'pymes', 8, 'iva_reducido');
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values
      (x, e, 'pymes', '70000000', '700', 'Ventas', 'template', 'serie'),
      (x, e, 'pymes', '47700000', '477', 'IVA repercutido', 'template', 'serie'),
      (x, e, 'pymes', '57000000', '570', 'Caja, efectivo', 'template', 'serie'),
      (x, e, 'pymes', '57200001', '572', 'Banco, tarjeta', 'own', 'manual'),
      (x, e, 'pymes', '43000001', '4300', 'Glovo', 'own', 'manual'),
      (x, e, 'pymes', '43000002', '4300', 'Uber Eats', 'own', 'manual'),
      (x, e, 'pymes', '43000003', '4300', 'Too Good To Go', 'own', 'manual'),
      (x, e, 'pymes', '43000099', '4300', 'Clientes de contado', 'own', 'manual');
    select id into c from public.company_account where company_id = e and code = '47700000';
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source) values
      (x, e, c, 'tax_rate', r10::text, 'repercutido', 'manual'), (x, e, c, 'tax_rate', r21::text, 'repercutido', 'manual');
  end loop;
  -- T y D: a qué cuenta va cada forma de pago (Deliverect, por el canal de cada orden).
  foreach e in array array[t, d] loop
    insert into public.conta_tpv_forma_cuenta (account_id, company_id, forma, canal, company_account_id, created_by_name)
    select x, e, v.forma, v.canal, a.id, 'Prueba R16'
      from (values ('Efectivo', null, '57000000'), ('Tarjeta', null, '57200001'), ('Deliverect', 'Glovo', '43000001'), ('Deliverect', 'UberEats', '43000002')) v(forma, canal, cuenta)
      join public.company_account a on a.company_id = e and a.code = v.cuenta;
  end loop;
  insert into public.conta_diez_envio_empresa (company_id, account_id, enviar) values (d, x, true);
  -- T, con la salida a ERP10 encendida desde el 01/11 (para el 6).
  insert into public.conta_erp10_salida_empresa (company_id, account_id, encendida, codigo_erp10, largo_subcuenta, desde) values (t, x, true, '001', 8, date '2026-11-01');
  -- F vende con Folvy: Glovo, con su 430 por la plataforma, y dos ventas cerradas del 09/11, una del 10/11 y otra del 11/11.
  insert into public.sales_channel (id, account_id, name, slug) values (ch, x, 'Glovo', 'glovo');
  insert into public.party (id, account_id, name) values (pg, x, 'Glovo (prueba R16)');
  insert into public.party_role (account_id, party_id, role, channel_id) values (x, pg, 'platform', ch);
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select x, f, a.id, 'customer', pg::text, 'principal', 'manual' from public.company_account a where a.company_id = f and a.code = '43000001';
  insert into public.sale (account_id, location_id, channel_id, source, external_ref, sold_at, total, taxable_base, tax, status, platform_order_code) values
    (x, lf, ch, 'manual', 'r16-prueba-1', timestamptz '2026-11-09 13:00:00+01', 22.00, 20.00, 2.00, 'closed', 'R07-1'),
    (x, lf, ch, 'manual', 'r16-prueba-2', timestamptz '2026-11-09 14:00:00+01', 11.00, 10.00, 1.00, 'closed', 'R07-2'),
    (x, lf, ch, 'manual', 'r16-prueba-3', timestamptz '2026-11-10 13:00:00+01', 33.00, 30.00, 3.00, 'closed', 'R07-3'),
    (x, lf, ch, 'manual', 'r16-prueba-4', timestamptz '2026-11-11 13:00:00+01', 44.00, 40.00, 4.00, 'closed', 'R07-4');
end $$;

-- El día del ejemplo, como lo da el lector (R04).
create temp table _prueba_r16 (clave text primary key, j jsonb) on commit drop;
insert into _prueba_r16 values ('ejemplo', $ejemplo$
  {"documentos": [
    {"numero":5001,"contador":"Facturas","fecha":"2026-11-09 12:40:30","orden":"700001","canal":"UberEats","nif":null,"cliente":null,"base":30.23,"cuota":3.02,"total":33.25},
    {"numero":5002,"contador":"Facturas","fecha":"2026-11-09 12:53:30","orden":"700002","canal":"UberEats","nif":null,"cliente":null,"base":18.12,"cuota":1.81,"total":19.93},
    {"numero":5003,"contador":"Facturas","fecha":"2026-11-09 13:06:30","orden":"700003","canal":"Glovo","nif":null,"cliente":null,"base":15.78,"cuota":1.58,"total":17.36},
    {"numero":5004,"contador":"Facturas","fecha":"2026-11-09 13:19:30","orden":"700004","canal":"Glovo","nif":null,"cliente":null,"base":32.05,"cuota":3.21,"total":35.26},
    {"numero":5005,"contador":"Facturas","fecha":"2026-11-09 13:32:30","orden":"700005","canal":"--","nif":null,"cliente":null,"base":15.67,"cuota":1.57,"total":17.24},
    {"numero":5006,"contador":"Facturas","fecha":"2026-11-09 13:45:30","orden":"700006","canal":"--","nif":null,"cliente":null,"base":16.19,"cuota":1.62,"total":17.81},
    {"numero":5007,"contador":"Facturas","fecha":"2026-11-09 13:58:30","orden":"700007","canal":"--","nif":"B00000000","cliente":"Cliente de ejemplo 7","base":36.44,"cuota":3.64,"total":40.08},
    {"numero":5008,"contador":"Facturas","fecha":"2026-11-09 14:11:30","orden":"700008","canal":"--","nif":null,"cliente":null,"base":11.22,"cuota":1.12,"total":12.34},
    {"numero":5009,"contador":"Facturas","fecha":"2026-11-09 14:24:30","orden":"700009","canal":"UberEats","nif":null,"cliente":null,"base":19.59,"cuota":1.96,"total":21.55},
    {"numero":5010,"contador":"Facturas","fecha":"2026-11-09 14:37:30","orden":"700010","canal":"--","nif":null,"cliente":null,"base":25.77,"cuota":2.58,"total":28.35},
    {"numero":5011,"contador":"Facturas","fecha":"2026-11-09 14:50:30","orden":"700011","canal":"Glovo","nif":null,"cliente":null,"base":28.1,"cuota":2.81,"total":30.91},
    {"numero":5012,"contador":"Facturas","fecha":"2026-11-09 15:03:30","orden":"700012","canal":"--","nif":null,"cliente":null,"base":35.89,"cuota":3.59,"total":39.48},
    {"numero":5013,"contador":"Facturas","fecha":"2026-11-09 15:16:30","orden":"700013","canal":"UberEats","nif":null,"cliente":null,"base":12.73,"cuota":1.27,"total":14},
    {"numero":5014,"contador":"Facturas","fecha":"2026-11-09 15:29:30","orden":"700014","canal":"--","nif":null,"cliente":null,"base":29.13,"cuota":2.91,"total":32.04},
    {"numero":5015,"contador":"Facturas","fecha":"2026-11-09 15:42:30","orden":"700015","canal":"--","nif":null,"cliente":null,"base":17.75,"cuota":1.77,"total":19.52},
    {"numero":5016,"contador":"Facturas","fecha":"2026-11-09 15:55:30","orden":"700016","canal":"--","nif":null,"cliente":null,"base":23.4,"cuota":2.34,"total":25.74},
    {"numero":5017,"contador":"Facturas","fecha":"2026-11-09 16:08:30","orden":"700017","canal":"--","nif":null,"cliente":null,"base":26.95,"cuota":2.7,"total":29.65},
    {"numero":5018,"contador":"Facturas","fecha":"2026-11-09 16:21:30","orden":"700018","canal":"UberEats","nif":null,"cliente":null,"base":9.84,"cuota":0.98,"total":10.82},
    {"numero":5019,"contador":"Facturas","fecha":"2026-11-09 16:34:30","orden":"700019","canal":"Glovo","nif":null,"cliente":null,"base":34.85,"cuota":3.49,"total":38.34},
    {"numero":5020,"contador":"Facturas","fecha":"2026-11-09 16:47:30","orden":"700020","canal":"--","nif":"B00000000","cliente":"Cliente de ejemplo 20","base":15.57,"cuota":1.56,"total":17.13},
    {"numero":5021,"contador":"Facturas","fecha":"2026-11-09 17:00:30","orden":"700021","canal":"--","nif":null,"cliente":null,"base":17.04,"cuota":1.7,"total":18.74},
    {"numero":5022,"contador":"Facturas","fecha":"2026-11-09 17:13:30","orden":"700022","canal":"UberEats","nif":null,"cliente":null,"base":8.53,"cuota":0.85,"total":9.38},
    {"numero":5023,"contador":"Facturas","fecha":"2026-11-09 17:26:30","orden":"700023","canal":"--","nif":null,"cliente":null,"base":20.5,"cuota":2.05,"total":22.55},
    {"numero":5024,"contador":"Facturas","fecha":"2026-11-09 17:39:30","orden":"700024","canal":"UberEats","nif":null,"cliente":null,"base":27.36,"cuota":2.74,"total":30.1},
    {"numero":5025,"contador":"Facturas","fecha":"2026-11-09 17:52:30","orden":"700025","canal":"--","nif":null,"cliente":null,"base":14.13,"cuota":1.41,"total":15.54},
    {"numero":5026,"contador":"Facturas","fecha":"2026-11-09 18:05:30","orden":"700026","canal":"UberEats","nif":null,"cliente":null,"base":30.1,"cuota":3.01,"total":33.11},
    {"numero":5027,"contador":"Facturas","fecha":"2026-11-09 18:18:30","orden":"700027","canal":"Glovo","nif":null,"cliente":null,"base":13.93,"cuota":1.39,"total":15.32},
    {"numero":5028,"contador":"Facturas","fecha":"2026-11-09 18:31:30","orden":"700028","canal":"--","nif":null,"cliente":null,"base":40,"cuota":4,"total":44},
    {"numero":5029,"contador":"Facturas","fecha":"2026-11-09 18:44:30","orden":"700029","canal":"--","nif":null,"cliente":null,"base":13.26,"cuota":1.33,"total":14.59},
    {"numero":5030,"contador":"Facturas","fecha":"2026-11-09 18:57:30","orden":"700030","canal":"--","nif":null,"cliente":null,"base":24.21,"cuota":2.42,"total":26.63},
    {"numero":5031,"contador":"Facturas","fecha":"2026-11-09 19:10:30","orden":"700031","canal":"Glovo","nif":null,"cliente":null,"base":26.58,"cuota":2.66,"total":29.24},
    {"numero":5032,"contador":"Facturas","fecha":"2026-11-09 19:23:30","orden":"700032","canal":"--","nif":null,"cliente":null,"base":11.35,"cuota":1.14,"total":12.49},
    {"numero":5033,"contador":"Facturas","fecha":"2026-11-09 19:36:30","orden":"700033","canal":"--","nif":null,"cliente":null,"base":20.47,"cuota":2.05,"total":22.52},
    {"numero":5034,"contador":"Facturas","fecha":"2026-11-09 19:49:30","orden":"700034","canal":"--","nif":null,"cliente":null,"base":12.89,"cuota":1.29,"total":14.18},
    {"numero":5035,"contador":"Facturas","fecha":"2026-11-09 20:02:30","orden":"700035","canal":"--","nif":null,"cliente":null,"base":22.48,"cuota":2.25,"total":24.73},
    {"numero":5036,"contador":"Facturas","fecha":"2026-11-09 20:15:30","orden":"700036","canal":"Glovo","nif":null,"cliente":null,"base":8.79,"cuota":0.88,"total":9.67},
    {"numero":5037,"contador":"Facturas","fecha":"2026-11-09 20:28:30","orden":"700037","canal":"--","nif":null,"cliente":null,"base":10.87,"cuota":1.09,"total":11.96},
    {"numero":5038,"contador":"Facturas","fecha":"2026-11-09 20:41:30","orden":"700038","canal":"UberEats","nif":null,"cliente":null,"base":25.33,"cuota":2.53,"total":27.86},
    {"numero":5039,"contador":"Facturas","fecha":"2026-11-09 20:54:30","orden":"700039","canal":"Glovo","nif":null,"cliente":null,"base":32.39,"cuota":3.24,"total":35.63},
    {"numero":5040,"contador":"Facturas","fecha":"2026-11-09 21:07:30","orden":"700040","canal":"Glovo","nif":null,"cliente":null,"base":21.7,"cuota":2.17,"total":23.87},
    {"numero":5041,"contador":"Facturas","fecha":"2026-11-09 21:20:30","orden":"700041","canal":"--","nif":null,"cliente":null,"base":32.51,"cuota":3.25,"total":35.76},
    {"numero":5042,"contador":"Facturas","fecha":"2026-11-09 21:33:30","orden":"700042","canal":"--","nif":null,"cliente":null,"base":15.12,"cuota":1.51,"total":16.63},
    {"numero":5043,"contador":"Facturas","fecha":"2026-11-09 21:46:30","orden":"700043","canal":"Glovo","nif":null,"cliente":null,"base":18.94,"cuota":1.89,"total":20.83},
    {"numero":5044,"contador":"Facturas","fecha":"2026-11-09 21:59:30","orden":"700044","canal":"--","nif":null,"cliente":null,"base":18.36,"cuota":1.84,"total":20.2},
    {"numero":5045,"contador":"Facturas","fecha":"2026-11-09 22:12:30","orden":"700045","canal":"Glovo","nif":null,"cliente":null,"base":26.55,"cuota":2.65,"total":29.2},
    {"numero":5046,"contador":"Facturas","fecha":"2026-11-09 22:25:30","orden":"700046","canal":"--","nif":null,"cliente":null,"base":18.27,"cuota":1.83,"total":20.1},
    {"numero":5047,"contador":"Facturas","fecha":"2026-11-09 22:38:30","orden":"700047","canal":"Glovo","nif":null,"cliente":null,"base":-10,"cuota":-1,"total":-11},
    {"numero":5048,"contador":"Facturas","fecha":"2026-11-09 22:51:30","orden":"700048","canal":"Glovo","nif":null,"cliente":null,"base":23.06,"cuota":2.31,"total":25.37}
  ],
  "impuestos": [
    {"orden":"700001","tipo":10,"base":30.23,"cuota":3.02},
    {"orden":"700002","tipo":10,"base":18.12,"cuota":1.81},
    {"orden":"700003","tipo":10,"base":15.78,"cuota":1.58},
    {"orden":"700004","tipo":10,"base":32.05,"cuota":3.21},
    {"orden":"700005","tipo":10,"base":15.67,"cuota":1.57},
    {"orden":"700006","tipo":10,"base":16.19,"cuota":1.62},
    {"orden":"700007","tipo":10,"base":36.44,"cuota":3.64},
    {"orden":"700008","tipo":10,"base":11.22,"cuota":1.12},
    {"orden":"700009","tipo":10,"base":19.59,"cuota":1.96},
    {"orden":"700010","tipo":10,"base":25.77,"cuota":2.58},
    {"orden":"700011","tipo":10,"base":28.1,"cuota":2.81},
    {"orden":"700012","tipo":10,"base":35.89,"cuota":3.59},
    {"orden":"700013","tipo":10,"base":12.73,"cuota":1.27},
    {"orden":"700014","tipo":10,"base":29.13,"cuota":2.91},
    {"orden":"700015","tipo":10,"base":17.75,"cuota":1.77},
    {"orden":"700016","tipo":10,"base":23.4,"cuota":2.34},
    {"orden":"700017","tipo":10,"base":26.95,"cuota":2.7},
    {"orden":"700018","tipo":10,"base":9.84,"cuota":0.98},
    {"orden":"700019","tipo":10,"base":34.85,"cuota":3.49},
    {"orden":"700020","tipo":10,"base":15.57,"cuota":1.56},
    {"orden":"700021","tipo":10,"base":17.04,"cuota":1.7},
    {"orden":"700022","tipo":10,"base":8.53,"cuota":0.85},
    {"orden":"700023","tipo":10,"base":20.5,"cuota":2.05},
    {"orden":"700024","tipo":10,"base":27.36,"cuota":2.74},
    {"orden":"700025","tipo":10,"base":14.13,"cuota":1.41},
    {"orden":"700026","tipo":10,"base":30.1,"cuota":3.01},
    {"orden":"700027","tipo":10,"base":13.93,"cuota":1.39},
    {"orden":"700028","tipo":10,"base":40,"cuota":4},
    {"orden":"700029","tipo":10,"base":13.26,"cuota":1.33},
    {"orden":"700030","tipo":10,"base":24.21,"cuota":2.42},
    {"orden":"700031","tipo":10,"base":26.58,"cuota":2.66},
    {"orden":"700032","tipo":10,"base":11.35,"cuota":1.14},
    {"orden":"700033","tipo":10,"base":20.47,"cuota":2.05},
    {"orden":"700034","tipo":10,"base":12.89,"cuota":1.29},
    {"orden":"700035","tipo":10,"base":22.48,"cuota":2.25},
    {"orden":"700036","tipo":10,"base":8.79,"cuota":0.88},
    {"orden":"700037","tipo":10,"base":10.87,"cuota":1.09},
    {"orden":"700038","tipo":10,"base":25.33,"cuota":2.53},
    {"orden":"700039","tipo":10,"base":32.39,"cuota":3.24},
    {"orden":"700040","tipo":10,"base":21.7,"cuota":2.17},
    {"orden":"700041","tipo":10,"base":32.51,"cuota":3.25},
    {"orden":"700042","tipo":10,"base":15.12,"cuota":1.51},
    {"orden":"700043","tipo":10,"base":18.94,"cuota":1.89},
    {"orden":"700044","tipo":10,"base":18.36,"cuota":1.84},
    {"orden":"700045","tipo":10,"base":26.55,"cuota":2.65},
    {"orden":"700046","tipo":10,"base":18.27,"cuota":1.83},
    {"orden":"700047","tipo":10,"base":-10,"cuota":-1},
    {"orden":"700048","tipo":10,"base":23.06,"cuota":2.31}
  ],
  "cobros": [
    {"fila":2,"orden":"700001","forma":"Deliverect","importe":33.25},
    {"fila":3,"orden":"700002","forma":"Deliverect","importe":19.93},
    {"fila":4,"orden":"700003","forma":"Deliverect","importe":17.36},
    {"fila":5,"orden":"700004","forma":"Deliverect","importe":35.26},
    {"fila":6,"orden":"700005","forma":"Efectivo","importe":17.24},
    {"fila":7,"orden":"700006","forma":"Efectivo","importe":17.81},
    {"fila":8,"orden":"700007","forma":"Tarjeta","importe":40.08},
    {"fila":9,"orden":"700008","forma":"Efectivo","importe":12.34},
    {"fila":10,"orden":"700009","forma":"Deliverect","importe":21.55},
    {"fila":11,"orden":"700010","forma":"Tarjeta","importe":28.35},
    {"fila":12,"orden":"700011","forma":"Deliverect","importe":30.91},
    {"fila":13,"orden":"700012","forma":"Tarjeta","importe":39.48},
    {"fila":14,"orden":"700013","forma":"Deliverect","importe":14},
    {"fila":15,"orden":"700014","forma":"Tarjeta","importe":32.04},
    {"fila":16,"orden":"700015","forma":"Efectivo","importe":19.52},
    {"fila":17,"orden":"700016","forma":"Efectivo","importe":25.74},
    {"fila":18,"orden":"700017","forma":"Tarjeta","importe":29.65},
    {"fila":19,"orden":"700018","forma":"Deliverect","importe":10.82},
    {"fila":20,"orden":"700019","forma":"Deliverect","importe":38.34},
    {"fila":21,"orden":"700020","forma":"Tarjeta","importe":17.13},
    {"fila":22,"orden":"700021","forma":"Tarjeta","importe":18.74},
    {"fila":23,"orden":"700022","forma":"Deliverect","importe":9.38},
    {"fila":24,"orden":"700023","forma":"Tarjeta","importe":22.55},
    {"fila":25,"orden":"700024","forma":"Deliverect","importe":30.1},
    {"fila":26,"orden":"700025","forma":"Tarjeta","importe":15.54},
    {"fila":27,"orden":"700026","forma":"Deliverect","importe":33.11},
    {"fila":28,"orden":"700027","forma":"Deliverect","importe":15.32},
    {"fila":29,"orden":"700028","forma":"Efectivo","importe":20},
    {"fila":30,"orden":"700028","forma":"Tarjeta","importe":24},
    {"fila":31,"orden":"700029","forma":"Tarjeta","importe":14.59},
    {"fila":32,"orden":"700030","forma":"Tarjeta","importe":26.63},
    {"fila":33,"orden":"700031","forma":"Deliverect","importe":29.24},
    {"fila":34,"orden":"700032","forma":"Tarjeta","importe":12.49},
    {"fila":35,"orden":"700033","forma":"Efectivo","importe":22.52},
    {"fila":36,"orden":"700034","forma":"Tarjeta","importe":14.18},
    {"fila":37,"orden":"700035","forma":"Efectivo","importe":24.73},
    {"fila":38,"orden":"700036","forma":"Deliverect","importe":9.67},
    {"fila":39,"orden":"700037","forma":"Tarjeta","importe":11.96},
    {"fila":40,"orden":"700038","forma":"Deliverect","importe":27.86},
    {"fila":41,"orden":"700039","forma":"Deliverect","importe":35.63},
    {"fila":42,"orden":"700040","forma":"Deliverect","importe":23.87},
    {"fila":43,"orden":"700041","forma":"Tarjeta","importe":35.76},
    {"fila":44,"orden":"700042","forma":"Tarjeta","importe":16.63},
    {"fila":45,"orden":"700043","forma":"Deliverect","importe":20.83},
    {"fila":46,"orden":"700044","forma":"Tarjeta","importe":20.2},
    {"fila":47,"orden":"700045","forma":"Deliverect","importe":29.2},
    {"fila":48,"orden":"700046","forma":"Efectivo","importe":20.1},
    {"fila":49,"orden":"700047","forma":"Deliverect","importe":-11},
    {"fila":50,"orden":"700048","forma":"Deliverect","importe":25.37}
  ]}
$ejemplo$::jsonb);
grant select, insert on _prueba_r16 to authenticated;

-- Simula la subida de un PDF al bucket (como 20261021_conta_documentos_prueba.sql).
create function pg_temp.r16_pdf(p_cuenta uuid, p_entry uuid, p_sha text, p_bytes int) returns text language plpgsql security definer as $f$
declare r text := p_cuenta || '/' || p_entry || '/' || left(p_sha, 16) || '.pdf';
begin
  insert into storage.objects (bucket_id, name, metadata) values ('conta-documentos', r, jsonb_build_object('size', p_bytes, 'mimetype', 'application/pdf'));
  return r;
end $f$;
-- El asiento en líneas, para pegarlo.
create function pg_temp.r16_asiento(p_entry uuid) returns text language sql as $f$
  select e.number || ' · ' || e.status || ' · ' || e.concept || E'\n' || string_agg(
           format('    %s %-22s %10s %10s  %s', a.code, left(a.name, 22), case when l.debit <> 0 then to_char(l.debit, 'FM999990.00') else '' end,
                  case when l.credit <> 0 then to_char(l.credit, 'FM999990.00') else '' end, l.concept), E'\n' order by l.position)
    from public.journal_entry e join public.journal_line l on l.entry_id = e.id join public.company_account a on a.id = l.company_account_id
   where e.id = p_entry group by e.number, e.status, e.concept
$f$;
grant execute on function pg_temp.r16_pdf(uuid, uuid, text, int) to authenticated;
grant execute on function pg_temp.r16_asiento(uuid) to authenticated;
-- Los saldos de unos asientos, cuenta a cuenta (la vara de la regla 31, la misma a los dos lados).
create function pg_temp.r16_saldos(p_ids uuid[], p_sin text default null) returns text language sql as $f$
  select coalesce(string_agg(x.code || ' ' || to_char(x.neto, 'FM999990.00'), ' · ' order by x.code), '')
    from (select a.code, sum(l.debit - l.credit) as neto from public.journal_line l join public.company_account a on a.id = l.company_account_id
           where l.entry_id = any (p_ids) and a.code is distinct from p_sin group by a.code having sum(l.debit - l.credit) <> 0) x
$f$;
grant execute on function pg_temp.r16_saldos(uuid[], text) to authenticated;


-- 1 · Lo que crea, y los permisos -----------------------------------------------------------------
update public.company set sector = 'hosteleria' where id = 'ae160000-0000-4000-8000-000000000012';
do $$ begin
  if to_regprocedure('public.conta_erp10_clientes_tpv(uuid, date, text)') is null or to_regprocedure('public.conta_erp10_dias_tpv_libro(uuid, date)') is null
     or to_regprocedure('public._conta_tpv_cliente_cuenta(uuid, text, text, text)') is null then
    raise exception 'PRUEBA R16 · 1: falta lo que crea la 0810.';
  end if;
  if has_function_privilege('anon', 'public.conta_erp10_clientes_tpv(uuid, date, text)', 'execute')
     or has_function_privilege('anon', 'public.conta_erp10_dias_tpv_libro(uuid, date)', 'execute')
     or has_function_privilege('authenticated', 'public._conta_tpv_cliente_cuenta(uuid, text, text, text)', 'execute') then
    raise exception 'PRUEBA R16 · 1: los permisos no son los esperados.';
  end if;
  raise notice '1 OK: lo que crea la 0810 y los permisos.';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', 'ae160000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

-- 2 · Un día con dos series, dos facturas con NIF y una devolución, contabilizado ------------------------------
do $$
declare
  t constant uuid := 'ae160000-0000-4000-8000-000000000012';
  v_entry constant uuid := 'ae160000-0000-4000-8000-0000000000e2'; v_sha text := repeat('cd', 32);
  j jsonb; d9 uuid; p jsonb; n int;
begin
  perform public.conta_tpv_factura_guardar(t, '43000099', 'Prueba R16');
  j := (select x.j from _prueba_r16 x where clave = 'ejemplo');
  j := jsonb_set(j, '{documentos}', (select jsonb_agg(case when (e ->> 'numero')::int > 5030 then jsonb_set(e, '{contador}', '"Barra"') else e end)
                                       from jsonb_array_elements(j -> 'documentos') e));
  d9 := (public.conta_tpv_dia_guardar(t, date '2026-11-09', 'revo', j, 'Prueba R16') ->> 'id')::uuid;
  p := public.conta_tpv_dia_para_validar(d9);
  perform public.conta_tpv_dia_validar(d9, v_entry, (p ->> 'numero_previsto')::int, pg_temp.r16_pdf('ae160000-0000-4000-8000-000000000010', v_entry, v_sha, 4321),
                                       'ResumenDeVentas_TPV_2026-11-09.pdf', v_sha, 4321, 'Prueba R16');
  select count(*) into n from public.vat_book_entry where entry_id = v_entry and book = 'issued' and voided_at is null;
  if n <> 5 then raise exception 'PRUEBA R16 · 2: el libro del día no está repartido (% filas).', n; end if;
  raise notice '2 OK: el 09/11 contabilizado, con su libro en 5 filas (dos series, dos F1 y una R5).';
end $$;

-- 3 · Los clientes con NIF del mes, con su 430 --------------------------------------------------------------
do $$
declare t constant uuid := 'ae160000-0000-4000-8000-000000000012'; r jsonb; r2 jsonb;
begin
  if exists (select 1 from public.party where account_id = 'ae160000-0000-4000-8000-000000000010' and tax_id = 'B00000000') then
    raise exception 'PRUEBA R16 · 3: el cliente ya tenía ficha antes de la salida.';
  end if;
  r := public.conta_erp10_clientes_tpv(t, date '2026-11-01', 'Prueba R16');
  raise notice '3 · la primera vez: %', r;
  if jsonb_array_length(r) <> 1 or r -> 0 ->> 'nif' <> 'B00000000' or not (r -> 0 ->> 'nuevo')::boolean or r -> 0 ->> 'codigo' !~ '^4300\d{4}$' then
    raise exception 'PRUEBA R16 · 3: no da de alta al cliente con su 430: %', r;
  end if;
  if not exists (select 1 from public.company_account_link k join public.company_account a on a.id = k.company_account_id
                  where k.company_id = t and k.entity = 'customer' and k.role = 'principal' and a.code = r -> 0 ->> 'codigo') then
    raise exception 'PRUEBA R16 · 3: su 430 no está enlazada al cliente.';
  end if;
  r2 := public.conta_erp10_clientes_tpv(t, date '2026-11-01', 'Prueba R16');
  if (r2 -> 0 ->> 'nuevo')::boolean or r2 -> 0 ->> 'codigo' <> r -> 0 ->> 'codigo'
     or (select count(*) from public.party where account_id = 'ae160000-0000-4000-8000-000000000010' and tax_id = 'B00000000') <> 1 then
    raise exception 'PRUEBA R16 · 3: la segunda vez vuelve a crear: %', r2;
  end if;
  insert into _prueba_r16 values ('cliente', r -> 0);
  raise notice '3 OK: B00000000 dado de alta con la % (nuevo); la segunda vez, la misma y sin crear nada.', r -> 0 ->> 'codigo';
end $$;

-- 4 · El libro de cada día del mes, para el fichero de ERP10 -----------------------------------------------
do $$
declare t constant uuid := 'ae160000-0000-4000-8000-000000000012'; r jsonb; f jsonb; v_cli text := (select j ->> 'codigo' from _prueba_r16 where clave = 'cliente');
begin
  r := public.conta_erp10_dias_tpv_libro(t, date '2026-11-01');
  f := r -> 'dias' -> 'ae160000-0000-4000-8000-0000000000e2';
  if jsonb_array_length(f) <> 5 then raise exception 'PRUEBA R16 · 4: las filas del día: %', f; end if;
  if (select string_agg(x ->> 'tipo' || ' ' || coalesce(x ->> 'serie', '') || ' ' || (x ->> 'numero') || coalesce('-' || (x ->> 'hasta'), '') || ' ' || coalesce(x ->> 'cliente', '·'), ' | '
        order by case when x ->> 'tipo' in ('F4', 'F2') then 1 when x ->> 'tipo' = 'F1' then 2 else 3 end, x ->> 'serie', x ->> 'numero') from jsonb_array_elements(f) x)
     <> format('F4 Barra 5031-5048 · | F4 Facturas 5001-5030 · | F1 Facturas 5007 %s | F1 Facturas 5020 %s | R5 Barra 5047 ·', v_cli, v_cli) then
    raise exception 'PRUEBA R16 · 4: las filas con su cliente: %', f;
  end if;
  if jsonb_array_length(r -> 'cuentas') <> 1 or r -> 'cuentas' -> 0 ->> 'codigo' <> v_cli or r -> 'cuentas' -> 0 ->> 'nif' <> 'B00000000' then
    raise exception 'PRUEBA R16 · 4: la cuenta del cliente para las fichas nuevas: %', r -> 'cuentas';
  end if;
  raise notice '4 OK: las 5 filas del libro, las dos F1 con la % de su cliente; y esa cuenta, con B00000000, para las fichas nuevas.', v_cli;
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

-- 5 · La vuelta atrás ---------------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261122T0810_r16_erp10_dia_por_serie_anade.down.sql
do $$ begin
  if to_regprocedure('public.conta_erp10_clientes_tpv(uuid, date, text)') is not null or to_regprocedure('public.conta_erp10_dias_tpv_libro(uuid, date)') is not null
     or to_regprocedure('public._conta_tpv_cliente_cuenta(uuid, text, text, text)') is not null then
    raise exception 'PRUEBA R16 · 5: la vuelta atrás no quita las funciones.';
  end if;
  if not exists (select 1 from public.party where account_id = 'ae160000-0000-4000-8000-000000000010' and tax_id = 'B00000000') then
    raise exception 'PRUEBA R16 · 5: la vuelta atrás ha quitado el cliente.';
  end if;
  raise notice '5 OK: la vuelta atrás quita las tres funciones; el cliente dado de alta se queda.';
end $$;

rollback;
