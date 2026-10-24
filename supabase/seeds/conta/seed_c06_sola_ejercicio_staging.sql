-- ============================================================================
-- C06 · La cuenta «sola» de prueba con su ejercicio abierto. SOLO STAGING.
-- ----------------------------------------------------------------------------
-- tests/e2e/conta/c06/sola.spec.ts mira en Inicio la tarjeta «Cerrar <mes
-- anterior>». Desde el #224 (M01) esa tarjeta solo sale si el mes está por
-- cerrar en la contabilidad: un ejercicio abierto que lo cubra, sin traer
-- (imported_until) y sin cierre. La empresa «Empresa de Prueba Sola, S.L.» de la
-- plantilla no tenía ningún ejercicio, así que la tarjeta no salía o salía según
-- lo que hubiera dejado otra prueba en el mismo carril.
--
-- Esto deja en la PLANTILLA (la que copia cada carril, scripts/e2e/carril) el
-- ejercicio abierto del año del mes anterior y del año en curso, sin fecha de
-- corte. No toca nada que ya esté: si el año ya tiene ejercicio, se queda como
-- está. La prueba comprueba el estado antes de mirar la tarjeta y, en un caso
-- aparte, lo cambia a «cerrado fuera» dentro de su carril y lo deja como estaba.
--
-- Guardas: aborta si al otro lado hay cuentas de producción, o si la empresa de
-- la plantilla no está (seed_c06_staging.sql y el recorrido de sola.spec.ts).
-- Solo añade. Se puede volver a aplicar.
-- ============================================================================

do $$
declare
  v_acc uuid;
  v_emp uuid;
  v_ano int;
  puestos int := 0;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla del ejercicio de la cuenta sola ABORTADA: esta base tiene cuentas de producción. ¿Es staging-conta?';
  end if;
  -- La cuenta de sola.admin@c06-prueba.test de la PLANTILLA (no la de un carril).
  select p.account_id into v_acc from public.user_profiles p
   where p.user_id = 'c0600000-0000-4000-8000-0000000000a1' and p.active;
  select c.id into v_emp from public.company c
   where c.account_id = v_acc and c.legal_name = 'Empresa de Prueba Sola, S.L.' and c.setup_completed_at is not null;
  if v_emp is null then
    raise exception 'Semilla del ejercicio de la cuenta sola: no está la empresa «Empresa de Prueba Sola, S.L.» de la plantilla.';
  end if;

  foreach v_ano in array array[
    extract(year from (now() at time zone 'Europe/Madrid')::date - interval '1 month')::int,
    extract(year from (now() at time zone 'Europe/Madrid')::date)::int] loop
    continue when exists (select 1 from public.fiscal_year y
                           where y.company_id = v_emp and daterange(y.starts_on, y.ends_on, '[]') && daterange(make_date(v_ano, 1, 1), make_date(v_ano, 12, 31), '[]'));
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on, status, created_by)
    values (v_acc, v_emp, v_ano::text, make_date(v_ano, 1, 1), make_date(v_ano, 12, 31), 'open', null);
    puestos := puestos + 1;
  end loop;

  raise notice 'Semilla del ejercicio de la cuenta sola: % ejercicio(s) abierto(s) puesto(s); primer día abierto desde el mes anterior: %.',
    puestos, public.conta_primer_dia_abierto(v_emp, date_trunc('month', (now() at time zone 'Europe/Madrid')::date - interval '1 month')::date);
end $$;
