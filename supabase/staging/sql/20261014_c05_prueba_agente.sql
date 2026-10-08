-- supabase/staging/sql/20261014_c05_prueba_agente.sql
--
-- SOLO STAGING. La parte C05 del agente «Libro diario»
-- (scripts/conta/agente-libros.sql) tiene que poder FALLAR (regla 31).
-- Dentro de una transacción que acaba en ROLLBACK:
--   1. Sobre la semilla, no encuentra nada en rojo.
--   2. Se rompe a propósito una cosa por comprobación (con los disparadores
--      apagados donde la base no lo dejaría hacer por las buenas).
--   3. Encuentra cada una.
-- El agente se lee del MISMO fichero que corre cada noche (\set con cat).
-- Empresa A de la semilla (cuenta c01a…) y B (c01b…). Ninguna cuenta real.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA agente C05: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
\set agente `cat scripts/conta/agente-libros.sql`

create temp table antes on commit drop as :agente

do $$
declare j json := (select * from antes); k text;
begin
  if (j->'contado'->>'cuentas_con_saldo')::int = 0 then raise exception 'PRUEBA agente C05 · 1: ninguna cuenta con saldo (¿falta la semilla?).'; end if;
  foreach k in array array['cuadre_mes', 'sin_sitio', 'fuera_con_saldo', 'otros_resultados', 'pyg_129', 'libro_diario', 'cerrado_con_asientos'] loop
    if json_array_length(j->k) <> 0 then raise exception 'PRUEBA agente C05 · 1: «%» sale con % filas sobre la semilla: %', k, json_array_length(j->k), j->k; end if;
  end loop;
  raise notice 'PRUEBA agente C05 · 1 en verde: % cuentas con saldo, % anotaciones del libro registro, nada en rojo.',
    j->'contado'->>'cuentas_con_saldo', j->'contado'->>'anotaciones';
end $$;

-- 2 · Romper una cosa por comprobación.
alter table public.journal_line disable trigger user;
alter table public.fiscal_year disable trigger user;
do $$
declare
  ea constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  eb constant uuid := '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6';
  v_modelo text; v_gasto uuid; v_678 uuid; v_nomina uuid; v_vbe uuid;
begin
  select coalesce((select model from public.annual_accounts_choice c join public.fiscal_year y on y.id = c.fiscal_year_id where y.company_id = ea and y.status = 'open' limit 1),
                  case when (select plan from public.company_account where company_id = ea limit 1) = 'general' then 'abreviado' else 'pymes' end) into v_modelo;

  -- fuera_con_saldo + cuadre_mes: la empresa deja fuera la 572 (bancos), que tiene saldo.
  insert into public.annual_accounts_mapping (account_id, company_id, model, statement, line_code, account_prefix, by_balance, origin, excluded, note)
  values ('c01a0000-0000-4000-8000-00000000000a', ea, v_modelo, 'balance',
          (select code from public.annual_accounts_line where model = v_modelo and statement = 'balance' order by sort_order limit 1),
          '572', null, 'empresa', true, 'Prueba del agente');

  -- sin_sitio: la serie del modelo pierde la línea de la 4751 (retenciones), que tiene saldo.
  delete from public.annual_accounts_mapping where company_id is null and model = v_modelo and statement = 'balance' and '4751' like account_prefix || '%' and length(account_prefix) >= 3;

  -- otros_resultados: un gasto validado pasa a la 678.
  select l.id into v_gasto from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
   where e.company_id = ea and e.status = 'validado' and coalesce(a.template_code, a.code) like '62%' limit 1;
  select id into v_678 from public.company_account where company_id = ea and code like '678%' limit 1;
  if v_gasto is null or v_678 is null then raise exception 'PRUEBA agente C05 · 2: no encuentro un gasto 62 validado o la 678 de la empresa A.'; end if;
  update public.journal_line set company_account_id = v_678 where id = v_gasto;

  -- libro_diario: una cuota del libro registro deja de ser la del diario.
  select id into v_vbe from public.vat_book_entry where company_id = ea and voided_at is null limit 1;
  if v_vbe is null then raise exception 'PRUEBA agente C05 · 2: la empresa A no tiene anotaciones en el libro registro.'; end if;
  update public.vat_book_entry set tax_amount = tax_amount + 1 where id = v_vbe;

  -- pyg_129: una «regularización» enlazada que no deja 6 y 7 a cero (la nómina validada).
  select id into v_nomina from public.journal_entry where company_id = ea and status = 'validado' and source_type = 'payroll' limit 1;
  insert into public.fiscal_year_closing (fiscal_year_id, account_id, company_id, status, regularization_entry_id)
  select id, account_id, company_id, 'preparado', v_nomina from public.fiscal_year where company_id = ea and status = 'open' limit 1;

  -- cerrado_con_asientos: el ejercicio de B se «cerró» antes de que se validaran sus asientos.
  update public.fiscal_year set status = 'closed', closed_at = '2000-01-01' where company_id = eb and status = 'open';
end $$;
alter table public.journal_line enable trigger user;
alter table public.fiscal_year enable trigger user;

create temp table despues on commit drop as :agente

do $$
declare j json := (select * from despues); k text; falta text := '';
begin
  foreach k in array array['cuadre_mes', 'sin_sitio', 'fuera_con_saldo', 'otros_resultados', 'pyg_129', 'libro_diario', 'cerrado_con_asientos'] loop
    if json_array_length(j->k) = 0 then falta := falta || ' ' || k; end if;
  end loop;
  if falta <> '' then raise exception 'PRUEBA agente C05 · 3: no ha visto lo roto en:%. Volcado: %', falta, j; end if;
  if not exists (select 1 from json_array_elements(j->'fuera_con_saldo') x where x->>'cuenta' like '572%') then raise exception 'PRUEBA agente C05 · 3: fuera_con_saldo no nombra la 572: %', j->'fuera_con_saldo'; end if;
  if not exists (select 1 from json_array_elements(j->'sin_sitio') x where x->>'cuenta' like '4751%') then raise exception 'PRUEBA agente C05 · 3: sin_sitio no nombra la 4751: %', j->'sin_sitio'; end if;
  raise notice 'PRUEBA agente C05 · 3 en verde: ve las siete (cuadre %, sin sitio %, fuera %, otros resultados %, pyg %, libro %, cerrado %).',
    json_array_length(j->'cuadre_mes'), json_array_length(j->'sin_sitio'), json_array_length(j->'fuera_con_saldo'), json_array_length(j->'otros_resultados'),
    json_array_length(j->'pyg_129'), json_array_length(j->'libro_diario'), json_array_length(j->'cerrado_con_asientos');
end $$;

rollback;
