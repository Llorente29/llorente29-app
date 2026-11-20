-- supabase/staging/sql/20261120_r07_factura_y_cobro_prueba.sql
--
-- SOLO STAGING. Prueba del R07 (20261119T1405_r07_cuenta_factura_del_dia y
-- 20261120T0900_r07_factura_y_cobro_del_dia), que el ensayo de staging pone
-- delante en la misma sesión. Todo en una transacción con ROLLBACK: staging no
-- cambia.
-- Nombra lo que cambia: public.journal_entry (el CHECK del origen y el
-- disparador nuevo trg_journal_entry_dia_cobro_junto), public._conta_tpv_propuesta,
-- public.conta_tpv_dia_para_validar, public.conta_tpv_dia_validar,
-- public.conta_proponer_dias y public.conta_erp10_dias_tpv_por_salir; y lo que
-- crea: public.conta_tpv_factura_cuenta (y su columna desde), public.conta_dia_cobro,
-- public._conta_dia_partir, public._conta_dia_proponer, public._conta_dia_cobro_junto,
-- public.conta_tpv_factura_de y public.conta_tpv_factura_guardar.
--
-- Monta, dentro de la transacción, la misma cuenta inventada que la prueba del
-- R05 (con otros identificadores): F vende con Folvy (Glovo, ventas del 09, 10 y
-- 11/11) y T sube días del TPV (el ejemplo INVENTADO de Revo, NIF B00000000).
-- Cada empresa tiene una «Clientes de contado» inventada, la 43000099.
--
--   1. Lo que crea, y los permisos.
--   2. Elegir la cuenta: la propuesta (la 430 «contado»), una que no está no vale,
--      y guardarla dice desde cuándo.
--   3. Sin la cuenta, el día del TPV no se valida: «Falta la cuenta de la
--      factura del día.».
--   4. Regla 10: el día del TPV se valida de verdad, en DOS asientos unidos: la
--      factura (Clientes de contado 1.100 al debe, ventas e IVA al haber, el libro
--      de IVA de la 5001 a la 5048 solo aquí) y su cobro (cada forma de pago contra
--      Clientes de contado, que queda a cero). Se pegan los dos.
--   5. Regla 31: los saldos de los dos asientos, sin Clientes de contado, son los
--      del asiento único del R05, con la misma vara; y el libro de IVA, el mismo.
--   6. La salida a ERP10: la factura del día sale como expedida con la cuenta
--      elegida como Clientes de contado, y su cobro como asiento.
--   7. Anular la factura anula su cobro y el día vuelve a «guardado»; se vuelve a
--      subir y a validar.
--   8. Regla 10, Folvy: sin la cuenta, el cierre del día (conta_proponer_dias, el
--      camino del cron) propone un asiento por día, como siempre; se valida el
--      09/11. Con la cuenta desde el 10/11: el 09/11 validado no se toca, y el
--      10/11 y el 11/11 salen en dos asientos unidos. Regla 31: los saldos del
--      10/11 en dos asientos son los del asiento único.
--   9. Validar la factura del 10/11 valida su cobro; descartar el cobro del 11/11
--      quita la factura y descarta el día (el cierre siguiente no lo vuelve a
--      proponer).
--  10. Las vueltas atrás: la de la 0900 para si hay cobros del día; sin ellos,
--      las cinco funciones vuelven byte a byte (_restaurar_funcion compara la
--      huella) y se va lo nuevo; después, la de la 1405.
--
-- Como el cliente: u en request.jwt.claims, con el rol authenticated.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA R07: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

-- 0 · La cuenta, su administrador y las tres empresas ------------------------------------
do $$
declare
  u constant uuid := 'ae070000-0000-4000-8000-000000000001';
  x constant uuid := 'ae070000-0000-4000-8000-000000000010';
  f constant uuid := 'ae070000-0000-4000-8000-000000000011';
  t constant uuid := 'ae070000-0000-4000-8000-000000000012';
  d constant uuid := 'ae070000-0000-4000-8000-000000000013';
  lf constant uuid := 'ae070000-0000-4000-8000-000000000021';
  lt constant uuid := 'ae070000-0000-4000-8000-000000000022';
  ch constant uuid := 'ae070000-0000-4000-8000-000000000031';
  pg constant uuid := 'ae070000-0000-4000-8000-000000000041';
  e uuid; c uuid;
  r10 uuid := (select id from public.tax_rate where code = 'iva_reducido' and is_system and valid_to is null limit 1);
  r21 uuid := (select id from public.tax_rate where code = 'iva_general' and is_system and valid_to is null limit 1);
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'tpv@r07-prueba.test',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into public.accounts (id, name, slug, status, business_type, product_brand) values (x, 'Prueba R07', 'r07-prueba', 'active', 'otra_actividad', 'contabilidad');
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
  values (u, x, 'admin', true, 'Prueba R07', now(), now());
  insert into public.company (id, account_id, legal_name, tax_id, setup_step) values
    (f, x, 'Prueba R07 Folvy, S.L.', 'A00000000', 'nombre'), (t, x, 'Prueba R07 TPV, S.L.', 'B00000000', 'nombre'), (d, x, 'Prueba R07 Diez, S.L.', 'E00000000', 'nombre');
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
    select x, e, v.forma, v.canal, a.id, 'Prueba R07'
      from (values ('Efectivo', null, '57000000'), ('Tarjeta', null, '57200001'), ('Deliverect', 'Glovo', '43000001'), ('Deliverect', 'UberEats', '43000002')) v(forma, canal, cuenta)
      join public.company_account a on a.company_id = e and a.code = v.cuenta;
  end loop;
  insert into public.conta_diez_envio_empresa (company_id, account_id, enviar) values (d, x, true);
  -- T, con la salida a ERP10 encendida desde el 01/11 (para el 6).
  insert into public.conta_erp10_salida_empresa (company_id, account_id, encendida, codigo_erp10, largo_subcuenta, desde) values (t, x, true, '001', 8, date '2026-11-01');
  -- F vende con Folvy: Glovo, con su 430 por la plataforma, y dos ventas cerradas del 09/11, una del 10/11 y otra del 11/11.
  insert into public.sales_channel (id, account_id, name, slug) values (ch, x, 'Glovo', 'glovo');
  insert into public.party (id, account_id, name) values (pg, x, 'Glovo (prueba R07)');
  insert into public.party_role (account_id, party_id, role, channel_id) values (x, pg, 'platform', ch);
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select x, f, a.id, 'customer', pg::text, 'principal', 'manual' from public.company_account a where a.company_id = f and a.code = '43000001';
  insert into public.sale (account_id, location_id, channel_id, source, external_ref, sold_at, total, taxable_base, tax, status, platform_order_code) values
    (x, lf, ch, 'manual', 'r07-prueba-1', timestamptz '2026-11-09 13:00:00+01', 22.00, 20.00, 2.00, 'closed', 'R07-1'),
    (x, lf, ch, 'manual', 'r07-prueba-2', timestamptz '2026-11-09 14:00:00+01', 11.00, 10.00, 1.00, 'closed', 'R07-2'),
    (x, lf, ch, 'manual', 'r07-prueba-3', timestamptz '2026-11-10 13:00:00+01', 33.00, 30.00, 3.00, 'closed', 'R07-3'),
    (x, lf, ch, 'manual', 'r07-prueba-4', timestamptz '2026-11-11 13:00:00+01', 44.00, 40.00, 4.00, 'closed', 'R07-4');
end $$;

-- El día del ejemplo, como lo da el lector (R04).
create temp table _prueba_r07 (clave text primary key, j jsonb) on commit drop;
insert into _prueba_r07 values ('ejemplo', $ejemplo$
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
grant select on _prueba_r07 to authenticated;

-- Simula la subida de un PDF al bucket (como 20261021_conta_documentos_prueba.sql).
create function pg_temp.r07_pdf(p_cuenta uuid, p_entry uuid, p_sha text, p_bytes int) returns text language plpgsql security definer as $f$
declare r text := p_cuenta || '/' || p_entry || '/' || left(p_sha, 16) || '.pdf';
begin
  insert into storage.objects (bucket_id, name, metadata) values ('conta-documentos', r, jsonb_build_object('size', p_bytes, 'mimetype', 'application/pdf'));
  return r;
end $f$;
-- El asiento en líneas, para pegarlo.
create function pg_temp.r07_asiento(p_entry uuid) returns text language sql as $f$
  select e.number || ' · ' || e.status || ' · ' || e.concept || E'\n' || string_agg(
           format('    %s %-22s %10s %10s  %s', a.code, left(a.name, 22), case when l.debit <> 0 then to_char(l.debit, 'FM999990.00') else '' end,
                  case when l.credit <> 0 then to_char(l.credit, 'FM999990.00') else '' end, l.concept), E'\n' order by l.position)
    from public.journal_entry e join public.journal_line l on l.entry_id = e.id join public.company_account a on a.id = l.company_account_id
   where e.id = p_entry group by e.number, e.status, e.concept
$f$;
grant execute on function pg_temp.r07_pdf(uuid, uuid, text, int) to authenticated;
grant execute on function pg_temp.r07_asiento(uuid) to authenticated;
-- Los saldos de unos asientos, cuenta a cuenta (la vara de la regla 31, la misma a los dos lados).
create function pg_temp.r07_saldos(p_ids uuid[], p_sin text default null) returns text language sql as $f$
  select coalesce(string_agg(x.code || ' ' || to_char(x.neto, 'FM999990.00'), ' · ' order by x.code), '')
    from (select a.code, sum(l.debit - l.credit) as neto from public.journal_line l join public.company_account a on a.id = l.company_account_id
           where l.entry_id = any (p_ids) and a.code is distinct from p_sin group by a.code having sum(l.debit - l.credit) <> 0) x
$f$;
grant execute on function pg_temp.r07_saldos(uuid[], text) to authenticated;

-- 1 · Lo que crea, y los permisos -----------------------------------------------------------------
do $$ begin
  if to_regclass('public.conta_dia_cobro') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_tpv_factura_cuenta' and column_name = 'desde')
     or not exists (select 1 from pg_trigger where tgrelid = 'public.journal_entry'::regclass and tgname = 'trg_journal_entry_dia_cobro_junto')
     or pg_get_constraintdef((select oid from pg_constraint where conrelid = 'public.journal_entry'::regclass and conname = 'journal_entry_source_type_check')) not like '%sales_day_payment%' then
    raise exception 'PRUEBA R07 · 1: falta el enlace, la columna desde, el disparador o el origen sales_day_payment.';
  end if;
  if has_function_privilege('anon', 'public.conta_tpv_factura_guardar(uuid, text, text)', 'execute')
     or has_function_privilege('anon', 'public.conta_tpv_factura_de(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._conta_dia_proponer(uuid, jsonb, text)', 'execute')
     or has_function_privilege('authenticated', 'public._conta_dia_partir(jsonb, text)', 'execute')
     or has_table_privilege('authenticated', 'public.conta_dia_cobro', 'insert') then
    raise exception 'PRUEBA R07 · 1: anon llega a la factura del día, o un usuario a lo interno.';
  end if;
  raise notice '1 OK: conta_dia_cobro, la columna desde, el disparador, el origen del cobro y los permisos.';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', 'ae070000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

-- 2 · Elegir la cuenta de la factura del día ------------------------------------------------------
do $$
declare t constant uuid := 'ae070000-0000-4000-8000-000000000012'; r jsonb; v_msg text;
begin
  r := public.conta_tpv_factura_de(t);
  if r -> 'factura' <> 'null'::jsonb or r -> 'propuesta' ->> 'cuenta' <> '43000099' then
    raise exception 'PRUEBA R07 · 2: sin cuenta, no propone la 430 «contado»: %', r;
  end if;
  begin
    perform public.conta_tpv_factura_guardar(t, '4300', 'Prueba R07');
    raise exception 'PRUEBA R07 · 2: una cuenta que no está en el plan se ha guardado.';
  exception when check_violation then get stacked diagnostics v_msg = message_text;
  end;
  raise notice '2 OK: una que no está en el plan no vale: «%»', v_msg;
end $$;

-- 3 · Sin la cuenta, el día del TPV no se valida ---------------------------------------------------
do $$
declare t constant uuid := 'ae070000-0000-4000-8000-000000000012'; r jsonb; v_dia uuid; v_msg text;
begin
  v_dia := (public.conta_tpv_dia_guardar(t, date '2026-11-09', 'revo', (select j from _prueba_r07 where clave = 'ejemplo'), 'Prueba R07') ->> 'id')::uuid;
  r := public.conta_tpv_dias(t, null, null);
  if r -> 0 ->> 'estado' <> 'en_espera' or r -> 0 ->> 'motivo' <> 'Falta la cuenta de la factura del día.' then
    raise exception 'PRUEBA R07 · 3: sin la cuenta, el día no queda en espera con su frase: %', r -> 0;
  end if;
  begin
    perform public.conta_tpv_dia_para_validar(v_dia);
    raise exception 'PRUEBA R07 · 3: sin la cuenta de la factura del día, el día se puede validar.';
  exception when check_violation then get stacked diagnostics v_msg = message_text;
  end;
  raise notice '3 OK: en espera: «%» · al validar: «%»', r -> 0 ->> 'motivo', v_msg;
  r := public.conta_tpv_factura_guardar(t, '43000099', 'Prueba R07');
  if r ->> 'texto' not like 'La factura del día va a la 43000099 · Clientes de contado. Desde el %, cada día va en dos asientos: la factura del día y su cobro.' then
    raise exception 'PRUEBA R07 · 3: guardar la cuenta no dice desde cuándo: %', r;
  end if;
  if public.conta_tpv_factura_de(t) -> 'factura' ->> 'cuenta' <> '43000099' or public.conta_tpv_dias(t, null, null) -> 0 ->> 'estado' <> 'por_validar' then
    raise exception 'PRUEBA R07 · 3: con la cuenta guardada, el día no pasa a por validar.';
  end if;
  raise notice '3 OK: guardada: «%» · el 09/11 pasa a por validar.', r ->> 'texto';
end $$;

-- 4 · Regla 10: el día del TPV, en dos asientos validados y unidos ----------------------------------
do $$
declare
  t constant uuid := 'ae070000-0000-4000-8000-000000000012';
  v_dia uuid := (select id from public.conta_tpv_dia where company_id = 'ae070000-0000-4000-8000-000000000012' and dia = date '2026-11-09');
  r jsonb; p jsonb; v_entry uuid := 'ae070000-0000-4000-8000-0000000000e2'; v_cobro uuid; v_sha text := repeat('ab', 32); v_l text; v_c text;
begin
  p := public.conta_tpv_dia_para_validar(v_dia);
  select string_agg(l ->> 'cuenta' || ' ' || (l ->> 'debe') || '/' || (l ->> 'haber'), ' · ' order by o) into v_l from jsonb_array_elements(p -> 'lineas') with ordinality z(l, o);
  select string_agg(l ->> 'cuenta' || ' ' || (l ->> 'debe') || '/' || (l ->> 'haber'), ' · ' order by o) into v_c from jsonb_array_elements(p -> 'cobro' -> 'lineas') with ordinality z(l, o);
  if v_l <> '43000099 1100.00/0 · 47700000 0.00/100.01 · 70000000 0.00/999.99' and v_l <> '43000099 1100.00/0.00 · 47700000 0.00/100.01 · 70000000 0.00/999.99' then
    raise exception 'PRUEBA R07 · 4: la factura del día que saldría no es la esperada: %', v_l;
  end if;
  if v_c not like '43000001 300.00/0.00 · 43000002 200.00/0.00 · 57000000 180.00/0.00 · 57200001 420.00/0.00 · 43000099 0%/1100%' then
    raise exception 'PRUEBA R07 · 4: el cobro del día que saldría no es el esperado: %', v_c;
  end if;
  r := public.conta_tpv_dia_validar(v_dia, v_entry, (p ->> 'numero_previsto')::int, pg_temp.r07_pdf('ae070000-0000-4000-8000-000000000010', v_entry, v_sha, 4321),
                                    'ResumenDeVentas_TPV_2026-11-09.pdf', v_sha, 4321, 'Prueba R07');
  v_cobro := (r ->> 'cobro_id')::uuid;
  raise notice '4 · devuelve: %', r ->> 'texto';
  raise notice E'4 · LA FACTURA DEL DÍA (regla 10):\n%', pg_temp.r07_asiento(v_entry);
  raise notice E'4 · SU COBRO (regla 10):\n%', pg_temp.r07_asiento(v_cobro);
  if (select string_agg(status || ':' || source_type, ' ' order by number) from public.journal_entry where id in (v_entry, v_cobro)) <> 'validado:sales_day validado:sales_day_payment'
     or (select number from public.journal_entry where id = v_cobro) <> (select number from public.journal_entry where id = v_entry) + 1
     or (select entry_date from public.journal_entry where id = v_cobro) <> date '2026-11-09'
     or not exists (select 1 from public.conta_dia_cobro where factura_entry_id = v_entry and cobro_entry_id = v_cobro) then
    raise exception 'PRUEBA R07 · 4: los dos asientos no están validados, seguidos, del mismo día y unidos.';
  end if;
  if (select sum(debit) - sum(credit) from public.journal_line where entry_id = v_entry) <> 0 or (select sum(debit) - sum(credit) from public.journal_line where entry_id = v_cobro) <> 0 then
    raise exception 'PRUEBA R07 · 4: alguno de los dos no cuadra.';
  end if;
  if pg_temp.r07_saldos(array[v_entry, v_cobro]) like '%43000099%' then
    raise exception 'PRUEBA R07 · 4: Clientes de contado no queda a cero: %', pg_temp.r07_saldos(array[v_entry, v_cobro]);
  end if;
  if (select string_agg(concat_ws(' ', invoice_type, number, number_to, documents_count, tax_base, tax_amount, counterpart_name), ' | ') from public.vat_book_entry where entry_id = v_entry and book = 'issued')
     <> 'F4 5001 5048 48 999.99 100.01 VENTAS A CONSUMIDOR FINAL'
     or exists (select 1 from public.vat_book_entry where entry_id = v_cobro) then
    raise exception 'PRUEBA R07 · 4: el libro de IVA no va solo en la factura, con el rango del TPV.';
  end if;
  if (select estado || ':' || entry_id from public.conta_tpv_dia where id = v_dia) <> 'contabilizado:' || v_entry then
    raise exception 'PRUEBA R07 · 4: el día no queda contabilizado con su factura.';
  end if;
  raise notice '4 OK: la factura (nº %) y su cobro (nº %), validados y unidos; cada uno cuadra; Clientes de contado a cero; el libro de IVA, F4 de la 5001 a la 5048, solo en la factura.',
    r ->> 'numero', r ->> 'cobro_numero';
end $$;

-- 5 · Regla 31: los dos asientos dicen lo mismo que el asiento único del R05 ------------------------
do $$
declare
  v_entry uuid := 'ae070000-0000-4000-8000-0000000000e2';
  v_cobro uuid := (select cobro_entry_id from public.conta_dia_cobro where factura_entry_id = 'ae070000-0000-4000-8000-0000000000e2');
  -- El asiento único del 09/11 que validaba el R05 (20261117_r05_dia_tpv_prueba.sql, paso 2), con la misma vara.
  v_antes constant text := '43000001 300.00 · 43000002 200.00 · 47700000 -100.01 · 57000000 180.00 · 57200001 420.00 · 70000000 -999.99';
  v_ahora text := pg_temp.r07_saldos(array[v_entry, v_cobro], '43000099');
begin
  raise notice '5 · MEDIDA R07 · antes (un asiento, R05) = %', v_antes;
  raise notice '5 · MEDIDA R07 · ahora (factura + cobro, sin Clientes de contado) = %', v_ahora;
  if v_ahora <> v_antes then raise exception 'PRUEBA R07 · 5: los saldos de los dos asientos no son los del asiento único.'; end if;
  raise notice '5 OK: las mismas cuentas con los mismos saldos, y Clientes de contado a cero.';
end $$;

-- 6 · La salida a ERP10: la factura del día con la cuenta elegida, y su cobro como asiento ----------
do $$
declare
  t constant uuid := 'ae070000-0000-4000-8000-000000000012'; v_entry uuid := 'ae070000-0000-4000-8000-0000000000e2';
  v_cobro uuid := (select cobro_entry_id from public.conta_dia_cobro where factura_entry_id = 'ae070000-0000-4000-8000-0000000000e2');
  r jsonb := public.conta_erp10_dias_tpv_por_salir(t, date '2026-11-01'); p jsonb := public.conta_erp10_por_salir(t, date '2026-11-01');
begin
  raise notice '6 · días del TPV que salen: % · Clientes de contado: %', (select string_agg(d ->> 'concepto', ' | ') from jsonb_array_elements(r -> 'dias') d), r -> 'contado';
  raise notice '6 · partidas: %', (select string_agg(x ->> 'concepto' || ' = ' || (x ->> 'clase') || case when (x ->> 'sale')::boolean then ' (sale)' else ' (no sale)' end, ' | ')
                                    from jsonb_array_elements(p -> 'partidas') x);
  if jsonb_array_length(r -> 'dias') <> 1 or r -> 'dias' -> 0 ->> 'entryId' <> v_entry::text or r -> 'dias' -> 0 ->> 'cobroId' <> v_cobro::text
     or r -> 'contado' <> '[{"codigo": "43000099", "nombre": "Clientes de contado", "plantilla": "4300"}]'::jsonb then
    raise exception 'PRUEBA R07 · 6: la salida a ERP10 no ve la factura del día con la cuenta elegida: %', r;
  end if;
  if not exists (select 1 from jsonb_array_elements(p -> 'partidas') x where x ->> 'entry_id' = v_cobro::text and x ->> 'clase' = 'asiento' and (x ->> 'sale')::boolean) then
    raise exception 'PRUEBA R07 · 6: el cobro del día no sale como asiento.';
  end if;
  raise notice '6 OK: la factura del día sale como expedida con la 43000099 como Clientes de contado y dice su cobro, que sale como asiento.';
end $$;

-- 7 · Anular la factura anula su cobro; el día vuelve a «guardado» y se valida otra vez ---------------
do $$
declare
  t constant uuid := 'ae070000-0000-4000-8000-000000000012'; v_entry uuid := 'ae070000-0000-4000-8000-0000000000e2';
  v_cobro uuid := (select cobro_entry_id from public.conta_dia_cobro where factura_entry_id = 'ae070000-0000-4000-8000-0000000000e2');
  v_e2 uuid := 'ae070000-0000-4000-8000-0000000000e7'; v_sha text := repeat('ef', 32); r jsonb; p jsonb; v_dia uuid;
begin
  perform public.journal_entry_anular(v_entry, 'Prueba R07: se sube corregido', date '2026-11-12', 'Prueba R07');
  if (select string_agg(status, ' ' order by number) from public.journal_entry where id in (v_entry, v_cobro)) <> 'anulado anulado'
     or (select estado || ':' || coalesce(entry_id::text, 'sin asiento') from public.conta_tpv_dia where company_id = t and dia = date '2026-11-09') <> 'guardado:sin asiento' then
    raise exception 'PRUEBA R07 · 7: anulada la factura, el cobro no se anula o el día no vuelve a «guardado».';
  end if;
  raise notice '7 · el cobro, anulado con: «%»', (select void_reason from public.journal_entry where id = v_cobro);
  v_dia := (public.conta_tpv_dia_guardar(t, date '2026-11-09', 'revo', (select j from _prueba_r07 where clave = 'ejemplo'), 'Prueba R07') ->> 'id')::uuid;
  p := public.conta_tpv_dia_para_validar(v_dia);
  r := public.conta_tpv_dia_validar(v_dia, v_e2, (p ->> 'numero_previsto')::int, pg_temp.r07_pdf('ae070000-0000-4000-8000-000000000010', v_e2, v_sha, 4321),
                                    'ResumenDeVentas_TPV_2026-11-09.pdf', v_sha, 4321, 'Prueba R07');
  if (select string_agg(status, ' ') from public.journal_entry where id in (v_e2, (r ->> 'cobro_id')::uuid)) <> 'validado validado' then
    raise exception 'PRUEBA R07 · 7: subido otra vez, no se valida en dos asientos.';
  end if;
  raise notice '7 OK: anulada la factura, su cobro también, y el 09/11 vuelve a «guardado»; subido otra vez: «%»', r ->> 'texto';
end $$;
reset role;

-- 8 · Regla 10, Folvy: sin la cuenta, como siempre; con la cuenta desde el 10/11, en dos ------------
create temp table _r07_folvy (dia date primary key, saldos text) on commit drop;
do $$
declare f constant uuid := 'ae070000-0000-4000-8000-000000000011'; r jsonb;
begin
  r := public.conta_proponer_dias(f, timestamptz '2026-11-17 12:00:00+01', 'Prueba R07');
  if (select count(*) from public.journal_entry where company_id = f and source_type = 'sales_day' and status = 'propuesto') <> 3
     or exists (select 1 from public.journal_entry where company_id = f and source_type = 'sales_day_payment') then
    raise exception 'PRUEBA R07 · 8: sin la cuenta, Folvy no propone un asiento por día: %', r;
  end if;
  -- La misma vara que el paso 9 (regla 31): los saldos de cada día en su asiento único.
  insert into _r07_folvy select e.entry_date, pg_temp.r07_saldos(array[e.id]) from public.journal_entry e where e.company_id = f and e.source_type = 'sales_day';
  raise notice '8 · sin la cuenta, un asiento por día: %', (select string_agg(dia || ' = ' || saldos, ' | ' order by dia) from _r07_folvy);
  -- El 10/11 y el 11/11 se quitan, para volver a proponerlos con la cuenta (como si aún no hubieran cerrado).
  delete from public.journal_entry where company_id = f and source_type = 'sales_day' and entry_date > date '2026-11-09';
end $$;
set local role authenticated;
do $$
declare
  f constant uuid := 'ae070000-0000-4000-8000-000000000011';
  v_09 uuid := (select id from public.journal_entry where company_id = 'ae070000-0000-4000-8000-000000000011' and source_type = 'sales_day' and entry_date = date '2026-11-09');
  r jsonb;
begin
  perform public.journal_entry_validar(v_09, 'Prueba R07');
  raise notice E'8 · EL 09/11 DE FOLVY, DE UN ASIENTO (regla 10):\n%', pg_temp.r07_asiento(v_09);
  r := public.conta_tpv_factura_guardar(f, '43000099', 'Prueba R07');
  raise notice '8 · F guarda la cuenta: «%»', r ->> 'texto';
end $$;
reset role;
update public.conta_tpv_factura_cuenta set desde = date '2026-11-10' where company_id = 'ae070000-0000-4000-8000-000000000011';
do $$
declare
  f constant uuid := 'ae070000-0000-4000-8000-000000000011'; r jsonb; v_huella text; v_fact uuid; v_cobro uuid;
  v_09 uuid := (select id from public.journal_entry where company_id = 'ae070000-0000-4000-8000-000000000011' and source_type = 'sales_day' and entry_date = date '2026-11-09');
begin
  select md5(string_agg(l.position || ':' || l.company_account_id || ':' || l.debit || ':' || l.credit, '|' order by l.position)) into v_huella from public.journal_line l where l.entry_id = v_09;
  r := public.conta_proponer_dias(f, timestamptz '2026-11-17 12:00:00+01', 'Prueba R07');
  raise notice '8 · el cierre con la cuenta: %', r;
  if (select status from public.journal_entry where id = v_09) <> 'validado'
     or (select md5(string_agg(l.position || ':' || l.company_account_id || ':' || l.debit || ':' || l.credit, '|' order by l.position)) from public.journal_line l where l.entry_id = v_09) <> v_huella
     or exists (select 1 from public.conta_dia_cobro where factura_entry_id = v_09) then
    raise exception 'PRUEBA R07 · 8: el 09/11, validado de antes, se ha tocado.';
  end if;
  if (select count(*) from public.conta_dia_cobro c join public.journal_entry e on e.id = c.factura_entry_id join public.journal_entry k on k.id = c.cobro_entry_id
       where c.company_id = f and e.status = 'propuesto' and k.status = 'propuesto' and k.source_type = 'sales_day_payment' and e.entry_date = k.entry_date
         and e.entry_date in (date '2026-11-10', date '2026-11-11')) <> 2 then
    raise exception 'PRUEBA R07 · 8: con la cuenta, el 10/11 y el 11/11 no salen en dos asientos propuestos y unidos.';
  end if;
  select c.factura_entry_id, c.cobro_entry_id into v_fact, v_cobro from public.conta_dia_cobro c join public.journal_entry e on e.id = c.factura_entry_id
   where c.company_id = f and e.entry_date = date '2026-11-10';
  raise notice '8 · MEDIDA R07 · 10/11 antes (un asiento) = %', (select saldos from _r07_folvy where dia = date '2026-11-10');
  raise notice '8 · MEDIDA R07 · 10/11 ahora (factura + cobro, sin Clientes de contado) = %', pg_temp.r07_saldos(array[v_fact, v_cobro], '43000099');
  if pg_temp.r07_saldos(array[v_fact, v_cobro], '43000099') <> (select saldos from _r07_folvy where dia = date '2026-11-10')
     or pg_temp.r07_saldos(array[v_fact, v_cobro]) like '%43000099%' then
    raise exception 'PRUEBA R07 · 8: los dos asientos del 10/11 no dicen lo mismo que el asiento único, o Clientes de contado no queda a cero.';
  end if;
  -- Volver a pasar el cierre no duplica nada.
  r := public.conta_proponer_dias(f, timestamptz '2026-11-17 13:00:00+01', 'Prueba R07');
  if (select count(*) from public.journal_entry where company_id = f) <> 5 then
    raise exception 'PRUEBA R07 · 8: el cierre de la hora siguiente ha duplicado algo: % asientos.', (select count(*) from public.journal_entry where company_id = f);
  end if;
  raise notice '8 OK: el 09/11 validado no se toca; el 10/11 y el 11/11, en dos asientos unidos, con los mismos saldos que en uno; el cierre siguiente no duplica.';
end $$;
set local role authenticated;

-- 9 · Validar la factura valida su cobro; descartar el cobro descarta el día -------------------------
do $$
declare
  f constant uuid := 'ae070000-0000-4000-8000-000000000011'; v_fact uuid; v_cobro uuid; r jsonb;
begin
  select c.factura_entry_id, c.cobro_entry_id into v_fact, v_cobro from public.conta_dia_cobro c join public.journal_entry e on e.id = c.factura_entry_id
   where c.company_id = f and e.entry_date = date '2026-11-10';
  perform public.journal_entry_validar(v_fact, 'Prueba R07');
  raise notice E'9 · LA FACTURA DEL 10/11 DE FOLVY (regla 10):\n%', pg_temp.r07_asiento(v_fact);
  raise notice E'9 · SU COBRO (regla 10):\n%', pg_temp.r07_asiento(v_cobro);
  if (select string_agg(status, ' ') from public.journal_entry where id in (v_fact, v_cobro)) <> 'validado validado' then
    raise exception 'PRUEBA R07 · 9: validada la factura del 10/11, su cobro no se ha validado.';
  end if;
  select c.factura_entry_id, c.cobro_entry_id into v_fact, v_cobro from public.conta_dia_cobro c join public.journal_entry e on e.id = c.factura_entry_id
   where c.company_id = f and e.entry_date = date '2026-11-11';
  r := public.journal_entry_descartar(v_cobro, 'Prueba R07: este día no va', 'Prueba R07');
  if exists (select 1 from public.journal_entry where id in (v_fact, v_cobro)) or exists (select 1 from public.conta_dia_cobro where factura_entry_id = v_fact) then
    raise exception 'PRUEBA R07 · 9: descartado el cobro del 11/11, su factura sigue.';
  end if;
  raise notice '9 OK: validar la factura valida su cobro; descartar el cobro del 11/11 quita los dos.';
end $$;
reset role;
do $$
declare f constant uuid := 'ae070000-0000-4000-8000-000000000011'; r jsonb;
begin
  r := public.conta_proponer_dias(f, timestamptz '2026-11-17 14:00:00+01', 'Prueba R07');
  if exists (select 1 from public.journal_entry where company_id = f and entry_date = date '2026-11-11') then
    raise exception 'PRUEBA R07 · 9: el cierre siguiente vuelve a proponer el 11/11 descartado: %', r;
  end if;
  raise notice '9 OK: el cierre siguiente no vuelve a proponer el 11/11: %', r;
end $$;
select set_config('request.jwt.claims', '', true);

-- 10 · Las vueltas atrás ------------------------------------------------------------------------------
-- La de la 0900 para mientras haya cobros del día (se mira su guarda, la misma condición).
do $$ begin
  if not exists (select 1 from public.journal_entry where source_type = 'sales_day_payment') then
    raise exception 'PRUEBA R07 · 10: no hay cobros del día con los que la vuelta atrás tenga que parar.';
  end if;
  raise notice '10 · con % cobros del día en el diario, la vuelta atrás de la 0900 pararía.', (select count(*) from public.journal_entry where source_type = 'sales_day_payment');
end $$;
-- Sin ellos (solo aquí, dentro del ROLLBACK, saltándose los disparadores para quitar lo de la prueba).
set local session_replication_role = replica;
delete from public.vat_book_entry where account_id = 'ae070000-0000-4000-8000-000000000010';
delete from public.journal_entry_document where account_id = 'ae070000-0000-4000-8000-000000000010';
delete from public.journal_line where account_id = 'ae070000-0000-4000-8000-000000000010';
delete from public.journal_entry where account_id = 'ae070000-0000-4000-8000-000000000010';
delete from public.conta_tpv_dia where account_id = 'ae070000-0000-4000-8000-000000000010';
set local session_replication_role = origin;
set constraints all immediate;
\i supabase/vuelta-atras/20261120T0900_r07_factura_y_cobro_del_dia.down.sql
do $$ begin
  if to_regclass('public.conta_dia_cobro') is not null or to_regprocedure('public._conta_dia_proponer(uuid, jsonb, text)') is not null or to_regprocedure('public._conta_dia_concepto(text, text)') is not null
     or exists (select 1 from pg_trigger where tgrelid = 'public.journal_entry'::regclass and tgname = 'trg_journal_entry_dia_cobro_junto')
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_tpv_factura_cuenta' and column_name = 'desde')
     or strpos(pg_get_functiondef('public._conta_tpv_propuesta(uuid)'::regprocedure), 'R07') > 0
     or strpos(pg_get_functiondef('public.conta_proponer_dias(uuid,timestamptz,text)'::regprocedure), 'R07') > 0
     or strpos(pg_get_functiondef('public.conta_erp10_dias_tpv_por_salir(uuid,date)'::regprocedure), 'R07') > 0 then
    raise exception 'PRUEBA R07 · 10: la vuelta atrás de la 0900 dejó algo.';
  end if;
end $$;
\i supabase/vuelta-atras/20261119T1405_r07_cuenta_factura_del_dia.down.sql
do $$ begin
  if to_regclass('public.conta_tpv_factura_cuenta') is not null then raise exception 'PRUEBA R07 · 10: la vuelta atrás de la 1405 dejó la tabla.'; end if;
  raise notice '10 OK: las dos vueltas atrás: las cinco funciones vuelven byte a byte y se va lo nuevo.';
  raise notice 'PRUEBA R07: 10 de 10 bien.';
end $$;

rollback;
