-- supabase/staging/sql/20261205_s02_cifras_prueba.sql
--
-- SOLO STAGING. Prueba de 20261205T0490_s02_cifras, con \i dentro de la
-- transacción y ROLLBACK: staging no cambia. Todo lo que se mira se mira COMO
-- USUARIO (el administrador de A, role authenticated con su jwt); lo que se
-- siembra en los bancos (un banco, su enlace a una 572, extractos y
-- movimientos) lo pone el dueño, como la prueba del B01. Los asientos los
-- escribe y los valida el usuario de A, como la del I01h.
--
--   (Empieza con la vuelta atrás, por si la 0490 ya estuviera.)
--   0. Lo de antes: el calendario es el de producción (md5 del cuerpo
--      480da33a…) y las tres funciones nuevas no están. Con el 200 de 2025 a
--      cero, el 202 3P de diciembre queda «No hace falta» y el calendario de
--      antes abre la ventana en diciembre por él.
--   1. La 0490.
--   2. El calendario nuevo: la ventana salta lo que no hace falta, y eso que
--      no hace falta (el 202 3P de diciembre) sigue en las filas (regla 7).
--   3. conta_pendientes: las ocho claves; con lo sembrado, cada número se
--      mueve lo que tiene que moverse (un propuesto del banco no es de
--      Asientos, un borrador sí salvo que espere, un casado con asiento
--      propuesto es «por validar»); y las facturas, las de su pantalla.
--   4. conta_saldo_bancos: el banco sembrado con su 572, lo validado y lo
--      propuesto por separado, el último extracto CON saldo y lo sin casar
--      hasta su fecha (ni casado, ni ignorado, ni de antes del corte, ni de
--      después del extracto). Validar mueve lo propuesto a lo validado.
--   5. conta_saldos_terceros: cada fila, deudor o acreedor, con su grupo; el
--      saldo, el del libro (lo propuesto no cuenta; lo validado sí); el
--      contacto de la subcuenta por su enlace.
--   6. Quién: B no ve nada de A (42501) y sin sesión no se puede llamar.
--   7. La vuelta atrás: para si otra función las llama; sin eso, deja el
--      calendario byte a byte y ninguna de las tres. Y otra vez delante.
-- Solo lee (las cuatro funciones): sin los cuatro caminos de la regla 10.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S02 CIFRAS: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

\i supabase/vuelta-atras/20261205T0490_s02_cifras.down.sql

create temp table _r (clave text primary key, id uuid, x jsonb) on commit drop;
grant all on _r to authenticated;

-- ── 0 · Lo de antes ────────────────────────────────────────────────────────
do $$
declare emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  if (select md5(prosrc) from pg_proc where oid = 'public.conta_impuesto_calendario(uuid,date)'::regprocedure) <> '480da33a07e1885441de585237156d3e' then
    raise exception 'PRUEBA S02 CIFRAS · 0: el calendario no es el de producción (la 0340).';
  end if;
  if to_regprocedure('public.conta_pendientes(uuid)') is not null or to_regprocedure('public.conta_saldo_bancos(uuid,date)') is not null
     or to_regprocedure('public.conta_saldos_terceros(uuid,date)') is not null then
    raise exception 'PRUEBA S02 CIFRAS · 0: alguna de las funciones de las cifras sigue después de la vuelta atrás.';
  end if;
  if not exists (select 1 from public.company where id = emp and account_id = 'c01a0000-0000-4000-8000-00000000000a') then
    raise exception 'PRUEBA S02 CIFRAS · 0: no está la empresa A de staging.';
  end if;
end $$;

-- El 200 de 2025 a cero (como el I01h): el 2P, el 3P de 2026 y el 1P de 2027, «No hace falta».
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select (public.conta_impuesto_200_poner('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 2025,
          '{"presentado":"2026-07-14","base_imponible":-5000,"cuota":0,"resultado":"to_refund","importe":300}', 'Prueba S02 cifras'))->>'mensaje' as doscientos;
reset role;

-- El día de la prueba: el siguiente al último plazo de otro modelo antes del
-- 202 3P (21/12), para que el primer plazo desde ese día sea el 3P, que no hace falta.
-- Lo esperado se calcula aquí, como el dueño (conta_impuesto_periodos es solo de postgres).
do $$
declare emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v_hoy date; v_vieja date; v_nueva date;
begin
  if not exists (select 1 from public.tax_return where company_id = emp and form_code = '202' and fiscal_year = 2026 and period = '3P' and status = 'not_required') then
    raise exception 'PRUEBA S02 CIFRAS · 0: el 202 3P de 2026 de A no ha quedado «No hace falta».';
  end if;
  select coalesce(max(c.presentacion) + 1, date '2026-10-21') into v_hoy
    from public.conta_impuesto_periodos(emp, 2026) c
   where c.presentacion >= date '2026-10-21' and c.presentacion < date '2026-12-21' and c.modelo <> '202';
  with p as (
    select c.presentacion, coalesce(r.status, 'pending') as st
      from public.conta_impuesto_periodos(emp, 2026) c
      left join public.tax_return r on r.company_id = emp and r.form_code = c.modelo and r.fiscal_year = c.ejercicio
                                    and r.period = c.periodo and r.sequence = 1
     where c.presentacion >= v_hoy)
  select date_trunc('month', min(presentacion))::date, date_trunc('month', min(presentacion) filter (where st <> 'not_required'))::date
    into v_vieja, v_nueva from p;
  if v_vieja <> date '2026-12-01' or v_nueva is not distinct from v_vieja then
    raise exception 'PRUEBA S02 CIFRAS · 0: desde el % el primer plazo no es el 3P que no hace falta (vieja %, nueva %): la prueba no distinguiría.', v_hoy, v_vieja, v_nueva;
  end if;
  insert into _r values ('hoy', null, to_jsonb(v_hoy)), ('vieja', null, to_jsonb(v_vieja)), ('nueva', null, to_jsonb(v_nueva));
end $$;

select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare cal jsonb;
begin
  cal := public.conta_impuesto_calendario('3b34403a-a7d6-4a48-a8d7-737e8cababdc', (select (x#>>'{}')::date from _r where clave = 'hoy'));
  if (cal->>'ventana')::date is distinct from (select (x#>>'{}')::date from _r where clave = 'vieja') then
    raise exception 'PRUEBA S02 CIFRAS · 0: el calendario de antes no abre la ventana en diciembre (%).', cal->>'ventana';
  end if;
  raise notice 'PRUEBA S02 CIFRAS · 0: el calendario de antes abre la ventana en % por un 202 que no hace falta.', cal->>'ventana';
end $$;
reset role;

-- ── 1 · La 0490 ────────────────────────────────────────────────────────────
\i supabase/migrations/20261205T0490_s02_cifras.sql

-- ── 2 · El calendario nuevo ────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare cal jsonb; v_nueva date := (select (x#>>'{}')::date from _r where clave = 'nueva');
begin
  cal := public.conta_impuesto_calendario('3b34403a-a7d6-4a48-a8d7-737e8cababdc', (select (x#>>'{}')::date from _r where clave = 'hoy'));
  if (cal->>'ventana')::date is distinct from v_nueva then
    raise exception 'PRUEBA S02 CIFRAS · 2: la ventana es % y tenía que ser % (el primer plazo que sí hay que presentar).', cal->>'ventana', v_nueva;
  end if;
  if v_nueva is not null and not exists (select 1 from jsonb_array_elements(cal->'filas') f
                                          where date_trunc('month', (f->>'presentacion')::date)::date = v_nueva
                                            and coalesce(f#>>'{declaracion,estado}', 'pending') <> 'not_required') then
    raise exception 'PRUEBA S02 CIFRAS · 2: en la ventana nueva no hay ningún plazo que haya que presentar.';
  end if;
  -- Regla 7: el 202 3P (21/12), que ya no abre la ventana, sigue en las filas con su «No hace falta» y su porqué.
  if not exists (select 1 from jsonb_array_elements(cal->'filas') f
                  where f->>'modelo' = '202' and f->>'periodo' = '3P' and (f->>'ejercicio')::int = 2026
                    and f#>>'{declaracion,estado}' = 'not_required' and f#>>'{declaracion,no_hace_falta}' = 'el impuesto de 2025 salió a cero') then
    raise exception 'PRUEBA S02 CIFRAS · 2: el 202 3P de diciembre ha desaparecido del calendario: %', cal->'filas';
  end if;
  -- Y no se cuela nada que no haga falta de DESPUÉS de la ventana (el 1P de 2027 no está en las filas).
  if exists (select 1 from jsonb_array_elements(cal->'filas') f
              where f#>>'{declaracion,estado}' = 'not_required' and (f->>'presentacion')::date >= v_nueva + interval '1 month') then
    raise exception 'PRUEBA S02 CIFRAS · 2: salen en las filas plazos que no hacen falta de después de la ventana.';
  end if;
  raise notice 'PRUEBA S02 CIFRAS · 2: la ventana salta el 202 que no hace falta y abre en %; el 202 3P sigue en las filas, con su porqué.', cal->>'ventana';
end $$;

-- ── 3 · Antes de sembrar: lo que cuentan las tres, como el usuario de A ────
do $$
declare emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; p jsonb; k text;
begin
  p := public.conta_pendientes(emp);
  if (select array_agg(x order by x collate "C") from jsonb_object_keys(p) x) <> array['asientos_por_validar', 'bancos_aclarar', 'bancos_confirmar', 'bancos_validar',
       'compras_decidir', 'compras_filas', 'facturas_para_mirar', 'facturas_por_aclarar'] then
    raise exception 'PRUEBA S02 CIFRAS · 3: conta_pendientes no devuelve exactamente sus ocho claves: %', p;
  end if;
  foreach k in array array['asientos_por_validar', 'bancos_aclarar', 'bancos_confirmar', 'bancos_validar', 'facturas_para_mirar', 'facturas_por_aclarar'] loop
    if jsonb_typeof(p->k) <> 'number' or (p->>k)::int < 0 then
      raise exception 'PRUEBA S02 CIFRAS · 3: % no es un número ≥ 0 (%).', k, p->k;
    end if;
  end loop;
  if p->'compras_decidir' <> 'null'::jsonb or jsonb_typeof(p->'compras_filas') <> 'object'
     or p->'compras_filas' <> public.compras_mirar('c01a0000-0000-4000-8000-00000000000a') then
    raise exception 'PRUEBA S02 CIFRAS · 3: compras_filas no es lo que devuelve compras_mirar de la cuenta (o compras_decidir no va null).';
  end if;
  insert into _r values ('p0', null, p);
end $$;
reset role;

-- La siembra de los bancos (el dueño): un banco nuevo de A enlazado a una 572
-- de A, un extracto viejo con saldo, el bueno con saldo, uno posterior SIN
-- saldo, y un movimiento de cada clase.
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  t uuid; c572 uuid; s1 uuid; s2 uuid; s3 uuid; m uuid;
begin
  select id into c572 from public.company_account where company_id = emp and account_id = a and code like '572%' and status <> 'cerrada' order by code limit 1;
  if c572 is null then raise exception 'PRUEBA S02 CIFRAS · siembra: A no tiene ninguna 572 abierta.'; end if;
  insert into public.treasury_account (account_id, company_id, kind, name, iban)
  values (a, emp, 'bank', 'S02 cifras · banco de prueba', 'ES7921000813610123456789') returning id into t;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (a, emp, c572, 'bank_account', t::text, 'principal', 'manual');
  insert into public.bank_statement (account_id, company_id, treasury_account_id, source, format, file_name, period_from, period_to,
     opening_balance, closing_balance, movements_count, new_count, repeated_count, possible_repeated_count, balanced, unchecked_reason, continuity)
  values (a, emp, t, 'fichero', 'norma43', 's02-cifras-1.n43', date '2026-09-01', date '2026-09-30', 0, 500, 0, 0, 0, 0, true, null, 'primero')
  returning id into s1;
  insert into public.bank_statement (account_id, company_id, treasury_account_id, source, format, file_name, period_from, period_to,
     opening_balance, closing_balance, movements_count, new_count, repeated_count, possible_repeated_count, balanced, unchecked_reason, continuity)
  values (a, emp, t, 'fichero', 'norma43', 's02-cifras-2.n43', date '2026-10-01', date '2026-10-20', 500, 1000, 8, 8, 0, 0, true, null, 'sigue')
  returning id into s2;
  insert into public.bank_statement (account_id, company_id, treasury_account_id, source, format, file_name, period_from, period_to,
     movements_count, new_count, repeated_count, possible_repeated_count, balanced, unchecked_reason, continuity)
  values (a, emp, t, 'fichero', 'csv', 's02-cifras-3.csv', date '2026-10-21', date '2026-10-25', 1, 1, 0, 0, null, 'prueba sin saldo', 'sin_saldo')
  returning id into s3;
  insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount, bank_concept, fingerprint, soft_fingerprint, status, reason, ignored_reason)
  values (a, emp, t, s2, date '2026-10-03', date '2026-10-03',    5.00, 'S02 ANTES DEL CORTE', 's02c-1', 's02c-s1', 'antes_corte_sin_pareja', null, null),
         (a, emp, t, s2, date '2026-10-05', date '2026-10-05',  -10.00, 'S02 PENDIENTE',       's02c-2', 's02c-s2', 'pendiente', null, null),
         (a, emp, t, s2, date '2026-10-06', date '2026-10-06',   25.00, 'S02 PROPUESTO',       's02c-3', 's02c-s3', 'propuesto', 'Prueba S02', null),
         (a, emp, t, s2, date '2026-10-07', date '2026-10-07',   40.00, 'S02 POR ACLARAR',     's02c-4', 's02c-s4', 'por_aclarar', 'Prueba S02', null),
         (a, emp, t, s2, date '2026-10-08', date '2026-10-08',   99.00, 'S02 IGNORADO',        's02c-5', 's02c-s5', 'ignorado', null, 'Prueba S02'),
         (a, emp, t, s2, date '2026-10-10', date '2026-10-10',    3.00, 'S02 POSIBLE REPETIDO','s02c-7', 's02c-s7', 'posible_repetido', null, null),
         (a, emp, t, s3, date '2026-10-22', date '2026-10-22', 1000.00, 'S02 DESPUES',         's02c-8', 's02c-s8', 'pendiente', null, null);
  insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount, bank_concept, fingerprint, soft_fingerprint, status)
  values (a, emp, t, s2, date '2026-10-09', date '2026-10-09', 7.00, 'S02 CASADO', 's02c-6', 's02c-s6', 'casado') returning id into m;
  insert into _r values ('banco', t, null), ('c572', c572, null), ('casado', m, null);
end $$;

-- Los asientos (el dueño los escribe; los valida abajo el usuario de A, como en
-- el I01h): E1, propuesto del BANCO (572 al debe 7 contra una 400 al haber),
-- casado con el movimiento de 7 €; E2, uno a mano, en borrador hasta que se
-- valida (572 al debe 12,34 contra la misma 400); E3, un borrador a mano.
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  c572 uuid := (select id from _r where clave = 'c572'); c400 uuid; v_y uuid; e1 uuid; e2 uuid; e3 uuid;
begin
  -- La 400: una con su proveedor enlazado si la hay (para mirar el contacto); si no, cualquiera abierta.
  select ca.id into c400 from public.company_account ca
   where ca.company_id = emp and ca.account_id = a and ca.code like '400%' and ca.status <> 'cerrada'
     and coalesce(ca.plain_name, ca.name) not ilike '%por localizar%'
   order by exists (select 1 from public.company_account_link l join public.party_role pr on pr.account_id = a and pr.role = 'supplier' and pr.supplier_id::text = l.entity_id
                     where l.company_account_id = ca.id and l.entity = 'supplier' and l.role = 'principal') desc, ca.code
   limit 1;
  select id into v_y from public.fiscal_year where company_id = emp and code = '2026';
  if c400 is null or v_y is null then raise exception 'PRUEBA S02 CIFRAS · siembra: A no tiene una 400 abierta o el ejercicio 2026.'; end if;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, confidence, reason)
  values (a, emp, v_y, 3, '2026-10-15', 'Prueba S02 cifras · propuesto del banco', 'bank', 'propuesto', 'seguro', 'Prueba S02 cifras') returning id into e1;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id)
  values (a, emp, e1, 1, c572, 7, 0, loc), (a, emp, e1, 2, c400, 0, 7, loc);
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, emp, v_y, 3, '2026-10-15', 'Prueba S02 cifras · a mano, validado', 'manual') returning id into e2;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id)
  values (a, emp, e2, 1, c572, 12.34, 0, loc), (a, emp, e2, 2, c400, 0, 12.34, loc);
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, emp, v_y, 3, '2026-10-15', 'Prueba S02 cifras · borrador', 'manual') returning id into e3;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id)
  values (a, emp, e3, 1, c572, 1, 0, loc), (a, emp, e3, 2, c400, 0, 1, loc);
  insert into _r values ('c400', c400, null), ('e1', e1, null), ('e2', e2, null), ('e3', e3, null);
end $$;
-- El casado de 7 € con E1 (el dueño, como en el B01).
insert into public.bank_match (account_id, company_id, movement_id, kind, journal_entry_id, entry_created, amount, confidence, reason, by_who)
values ('c01a0000-0000-4000-8000-00000000000a', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', (select id from _r where clave = 'casado'), 'asiento',
        (select id from _r where clave = 'e1'), true, 7, 'seguro', 'Prueba S02 cifras', 'folvy');

-- Lo que dice el libro ANTES de validar E2 (lo validado y lo propuesto de la 572 y la 400), y lo que espera.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  c572 uuid := (select id from _r where clave = 'c572'); c400 uuid := (select id from _r where clave = 'c400');
  b record; t400 record; v_val numeric; v_prop numeric;
begin
  -- Lo validado de la 572 a 31/10, contado aparte: el ejercicio hasta el 31/10, sin los asientos de cierre.
  select coalesce(sum(l.debit - l.credit), 0) into v_val
    from public.journal_ledger l join public.fiscal_year y on y.company_id = emp and date '2026-10-31' between y.starts_on and y.ends_on
   where l.company_id = emp and l.company_account_id = c572 and l.entry_date between y.starts_on and date '2026-10-31' and l.source_type <> 'closing'
     and l.entry_id not in (select c.closing_entry_id from public.fiscal_year_closing c where c.company_id = emp and c.closing_entry_id is not null);
  select coalesce(sum(l.debit - l.credit), 0) into v_prop
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id
   where l.company_id = emp and l.company_account_id = c572 and e.status = 'propuesto' and e.entry_date <= date '2026-10-31';
  select * into b from public.conta_saldo_bancos(emp, date '2026-10-31') x where x.treasury_account_id = (select id from _r where clave = 'banco');
  if b is null then raise exception 'PRUEBA S02 CIFRAS · 4: el banco sembrado no sale.'; end if;
  if b.cuenta <> (select code from public.company_account where id = c572) or b.nombre <> 'S02 cifras · banco de prueba' then
    raise exception 'PRUEBA S02 CIFRAS · 4: el banco no sale con su 572 (% %).', b.cuenta, b.nombre;
  end if;
  if b.libro_validado <> round(v_val, 2) or b.libro_propuesto <> round(v_prop, 2) then
    raise exception 'PRUEBA S02 CIFRAS · 4: el libro no es el contado aparte (validado % / %, propuesto % / %).', b.libro_validado, v_val, b.libro_propuesto, v_prop;
  end if;
  if b.extracto_saldo <> 1000 or b.extracto_hasta <> date '2026-10-20' then
    raise exception 'PRUEBA S02 CIFRAS · 4: el extracto no es el último con saldo (% a %).', b.extracto_saldo, b.extracto_hasta;
  end if;
  -- −10 (pendiente) + 25 (propuesto) + 40 (por aclarar) + 3 (posible repetido): ni el casado, ni el ignorado, ni el de antes del corte, ni el del 22/10.
  if b.sin_casar <> 58 or b.sin_casar_n <> 4 then
    raise exception 'PRUEBA S02 CIFRAS · 4: lo sin casar hasta el extracto no es 58,00 en 4 movimientos (% en %).', b.sin_casar, b.sin_casar_n;
  end if;
  -- Al día del extracto viejo: su saldo, y nada de octubre sin casar.
  select * into b from public.conta_saldo_bancos(emp, date '2026-09-30') x where x.treasury_account_id = (select id from _r where clave = 'banco');
  if b.extracto_saldo <> 500 or b.extracto_hasta <> date '2026-09-30' or b.sin_casar_n <> 0 then
    raise exception 'PRUEBA S02 CIFRAS · 4: a 30/09 no sale el extracto de septiembre (% a %, % sin casar).', b.extracto_saldo, b.extracto_hasta, b.sin_casar_n;
  end if;
  begin perform public.conta_saldo_bancos(emp, null); raise exception 'PRUEBA S02 CIFRAS · 4: sin fecha, contesta.';
  exception when sqlstate '22023' then null; end;
  select * into t400 from public.conta_saldos_terceros(emp, date '2026-10-31') x where x.cuenta = (select code from public.company_account where id = c400);
  insert into _r values ('v572', null, to_jsonb(v_val)), ('p572', null, to_jsonb(v_prop)),
                        ('t400', null, coalesce(to_jsonb(t400.saldo_deudor - t400.saldo_acreedor), '0'::jsonb)),
                        ('e3_espera', null, to_jsonb(exists (select 1 from public.conta_esperan(emp, date '1900-01-01', date '2999-12-31') w where w.entry_id = (select id from _r where clave = 'e3'))));
  raise notice 'PRUEBA S02 CIFRAS · 4: el banco, con su 572, lo validado y lo propuesto por separado, el último extracto con saldo y 58,00 sin casar en 4.';
end $$;

-- Pendientes después de sembrar: cada número se mueve lo suyo.
do $$
declare emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  p0 jsonb := (select x from _r where clave = 'p0'); p jsonb; d jsonb;
begin
  p := public.conta_pendientes(emp);
  d := jsonb_build_object(
    'bancos_confirmar', (p->>'bancos_confirmar')::int - (p0->>'bancos_confirmar')::int,
    'bancos_aclarar', (p->>'bancos_aclarar')::int - (p0->>'bancos_aclarar')::int,
    'bancos_validar', (p->>'bancos_validar')::int - (p0->>'bancos_validar')::int,
    'asientos_por_validar', (p->>'asientos_por_validar')::int - (p0->>'asientos_por_validar')::int,
    'facturas_para_mirar', (p->>'facturas_para_mirar')::int - (p0->>'facturas_para_mirar')::int,
    'facturas_por_aclarar', (p->>'facturas_por_aclarar')::int - (p0->>'facturas_por_aclarar')::int);
  -- Confirmar: el propuesto. Aclarar: los dos pendientes, el por aclarar y el posible repetido.
  -- Validar: el casado cuyo asiento (E1) está propuesto. Asientos: E3 (borrador), salvo que espere;
  -- E1 es propuesto del banco y se decide en Bancos; E2 aún es borrador… y se valida abajo.
  if d <> jsonb_build_object('bancos_confirmar', 1, 'bancos_aclarar', 4, 'bancos_validar', 1,
                             'asientos_por_validar', 2 - (case when (select (x#>>'{}')::boolean from _r where clave = 'e3_espera') then 1 else 0 end)
                                                       - (case when exists (select 1 from public.conta_esperan(emp, date '1900-01-01', date '2999-12-31') w where w.entry_id = (select id from _r where clave = 'e2')) then 1 else 0 end),
                             'facturas_para_mirar', 0, 'facturas_por_aclarar', 0) then
    raise exception 'PRUEBA S02 CIFRAS · 3: con lo sembrado, los números no se mueven lo suyo: %', d;
  end if;
  -- Las facturas: las de su pantalla (conta_documentos_recibidos de los 12 meses).
  if (p->>'facturas_para_mirar')::int <> (select count(*) from jsonb_array_elements(public.conta_documentos_recibidos(emp,
         (date_trunc('month', (now() at time zone 'Europe/Madrid')::date) - interval '11 months')::date,
         (date_trunc('month', (now() at time zone 'Europe/Madrid')::date) + interval '1 month' - interval '1 day')::date)->'filas') f
       where f->>'tipo' = 'factura' and f->>'estado' = 'para_mirar') then
    raise exception 'PRUEBA S02 CIFRAS · 3: facturas_para_mirar no es lo que enseña Facturas recibidas.';
  end if;
  raise notice 'PRUEBA S02 CIFRAS · 3: con lo sembrado: %', d;
end $$;

-- Validar E2 (a mano) y E1 (el del banco): lo propuesto pasa a lo validado; «por validar» baja.
do $$
declare emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; b record; t400 record; p jsonb;
begin
  perform public.journal_entry_validar((select id from _r where clave = 'e2'));
  perform public.journal_entry_validar((select id from _r where clave = 'e1'));
  select * into b from public.conta_saldo_bancos(emp, date '2026-10-31') x where x.treasury_account_id = (select id from _r where clave = 'banco');
  if b.libro_validado <> round((select (x#>>'{}')::numeric from _r where clave = 'v572') + 12.34 + 7, 2)
     or b.libro_propuesto <> round((select (x#>>'{}')::numeric from _r where clave = 'p572') - 7, 2) then
    raise exception 'PRUEBA S02 CIFRAS · 4: al validar, lo validado no sube 19,34 y lo propuesto no baja 7 (% y %).', b.libro_validado, b.libro_propuesto;
  end if;
  p := public.conta_pendientes(emp);
  if (p->>'bancos_validar')::int <> (select (x->>'bancos_validar')::int from _r where clave = 'p0') then
    raise exception 'PRUEBA S02 CIFRAS · 3: con E1 validado, el casado sigue «por validar».';
  end if;
  -- La 400: lo propuesto (E1 antes de validar, E3) no contaba; lo validado (E1, E2) sí: −19,34.
  select * into t400 from public.conta_saldos_terceros(emp, date '2026-10-31') x where x.cuenta = (select code from public.company_account where id = (select id from _r where clave = 'c400'));
  if t400 is null or (t400.saldo_deudor - t400.saldo_acreedor) <> round((select (x#>>'{}')::numeric from _r where clave = 't400') - 19.34, 2) then
    raise exception 'PRUEBA S02 CIFRAS · 5: la 400 no baja 19,34 al validar (% → %).', (select x from _r where clave = 't400'), t400;
  end if;
  if t400.grupo <> 'proveedor' then raise exception 'PRUEBA S02 CIFRAS · 5: una 400 sale como «%».', t400.grupo; end if;
  -- Su contacto, por su enlace (el party del proveedor), si lo tiene.
  if t400.party_id is distinct from (select pr.party_id from public.company_account_link l join public.party_role pr
                                       on pr.account_id = l.account_id and pr.role = 'supplier' and pr.supplier_id::text = l.entity_id
                                      where l.company_account_id = (select id from _r where clave = 'c400') and l.entity = 'supplier' and l.role = 'principal'
                                      order by l.created_at, pr.created_at limit 1) then
    raise exception 'PRUEBA S02 CIFRAS · 5: el contacto de la 400 no es el de su enlace (%).', t400.party_id;
  end if;
  raise notice 'PRUEBA S02 CIFRAS · 4/5: validar mueve lo propuesto a lo validado, en el banco y en la 400; «por validar» baja.';
end $$;

-- Todas las filas de terceros: una cara, su grupo, y el saldo del libro contado aparte.
do $$
declare emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; n int; mal text;
begin
  select count(*) into n from public.conta_saldos_terceros(emp, date '2026-10-31');
  if n = 0 then raise exception 'PRUEBA S02 CIFRAS · 5: A no tiene ninguna subcuenta 40/41/43/44 con saldo (al menos la 400 de la prueba).'; end if;
  select string_agg(x.cuenta, ', ') into mal from public.conta_saldos_terceros(emp, date '2026-10-31') x
   where not ((x.saldo_deudor > 0 and x.saldo_acreedor = 0) or (x.saldo_deudor = 0 and x.saldo_acreedor > 0))
      or x.grupo <> case when left(x.cuenta, 2) in ('43', '44') then 'cliente' when left(x.cuenta, 3) = '407' then 'anticipo'
                         when x.nombre ilike '%por localizar%' then 'por_localizar' when left(x.cuenta, 2) = '40' then 'proveedor'
                         when left(x.cuenta, 2) = '41' then 'acreedor' end;
  if mal is not null then raise exception 'PRUEBA S02 CIFRAS · 5: filas con las dos caras, ninguna o el grupo mal: %', mal; end if;
  -- El saldo de cada subcuenta, contado aparte en el libro (validado|anulado, el ejercicio hasta el 31/10, sin cierre).
  select string_agg(coalesce(x.cuenta, l.code) || ' ' || coalesce((x.saldo_deudor - x.saldo_acreedor)::text, '—') || '≠' || coalesce(l.saldo::text, '—'), ', ') into mal
    from (select x.* from public.conta_saldos_terceros(emp, date '2026-10-31') x) x
    full join (select a.code, round(sum(l.debit - l.credit), 2) as saldo
                 from public.journal_ledger l
                 join public.company_account a on a.id = l.company_account_id
                 join public.fiscal_year y on y.company_id = emp and date '2026-10-31' between y.starts_on and y.ends_on
                where l.company_id = emp and a.code ~ '^4[0134]' and l.entry_date between y.starts_on and date '2026-10-31' and l.source_type <> 'closing'
                  and l.entry_id not in (select c.closing_entry_id from public.fiscal_year_closing c where c.company_id = emp and c.closing_entry_id is not null)
                group by a.code having round(sum(l.debit - l.credit), 2) <> 0) l on l.code = x.cuenta
   where (x.saldo_deudor - x.saldo_acreedor) is distinct from l.saldo;
  if mal is not null then raise exception 'PRUEBA S02 CIFRAS · 5: el saldo no es el del libro contado aparte: %', mal; end if;
  raise notice 'PRUEBA S02 CIFRAS · 5: % subcuentas con saldo, cada una con una cara y su grupo, y el saldo del libro.', n;
end $$;
reset role;

-- ── 6 · Quién ──────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  begin perform public.conta_pendientes(emp); raise exception 'PRUEBA S02 CIFRAS · 6: B cuenta lo pendiente de A.';
  exception when insufficient_privilege then null; end;
  begin perform public.conta_saldo_bancos(emp, date '2026-10-31'); raise exception 'PRUEBA S02 CIFRAS · 6: B lee los bancos de A.';
  exception when insufficient_privilege then null; end;
  begin perform public.conta_saldos_terceros(emp, date '2026-10-31'); raise exception 'PRUEBA S02 CIFRAS · 6: B lee los saldos de A.';
  exception when insufficient_privilege then null; end;
  -- Y las suyas, sin nada de A.
  if exists (select 1 from public.company where account_id = 'c01b0000-0000-4000-8000-00000000000b')
     and exists (select 1 from public.conta_saldo_bancos((select id from public.company where account_id = 'c01b0000-0000-4000-8000-00000000000b' order by created_at limit 1), date '2026-10-31') x
                  where x.treasury_account_id = (select id from _r where clave = 'banco')) then
    raise exception 'PRUEBA S02 CIFRAS · 6: el banco de A sale en los de B.';
  end if;
  raise notice 'PRUEBA S02 CIFRAS · 6: B no ve nada de A.';
end $$;
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$ begin
  begin perform public.conta_pendientes('3b34403a-a7d6-4a48-a8d7-737e8cababdc'); raise exception 'PRUEBA S02 CIFRAS · 6: sin sesión se puede llamar.';
  exception when insufficient_privilege then null; end;
  begin perform public.conta_saldos_terceros('3b34403a-a7d6-4a48-a8d7-737e8cababdc', date '2026-10-31'); raise exception 'PRUEBA S02 CIFRAS · 6: sin sesión se puede llamar.';
  exception when insufficient_privilege then null; end;
  raise notice 'PRUEBA S02 CIFRAS · 6: sin sesión, nada.';
end $$;
reset role;

-- ── 7 · La vuelta atrás ────────────────────────────────────────────────────
-- Con una función que llama a conta_pendientes, la vuelta atrás la vería y pararía (su misma condición).
create function public._s02_cifras_usa(p uuid) returns jsonb language sql stable as $$ select public.conta_pendientes(p) $$;
do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname not in ('conta_pendientes', 'conta_saldo_bancos', 'conta_saldos_terceros')
                    and p.prosrc ~ '\m(conta_pendientes|conta_saldo_bancos|conta_saldos_terceros)\M') then
    raise exception 'PRUEBA S02 CIFRAS · 7: la condición de la vuelta atrás no ve la función que llama a conta_pendientes.';
  end if;
end $$;
drop function public._s02_cifras_usa(uuid);

\i supabase/vuelta-atras/20261205T0490_s02_cifras.down.sql

do $$ begin
  if (select md5(prosrc) from pg_proc where oid = 'public.conta_impuesto_calendario(uuid,date)'::regprocedure) <> '480da33a07e1885441de585237156d3e' then
    raise exception 'PRUEBA S02 CIFRAS · 7: el calendario no vuelve al de producción byte a byte.';
  end if;
  if to_regprocedure('public.conta_pendientes(uuid)') is not null or to_regprocedure('public.conta_saldo_bancos(uuid,date)') is not null
     or to_regprocedure('public.conta_saldos_terceros(uuid,date)') is not null then
    raise exception 'PRUEBA S02 CIFRAS · 7: la vuelta atrás deja alguna de las tres.';
  end if;
  if not has_function_privilege('authenticated', 'public.conta_impuesto_calendario(uuid,date)', 'execute')
     or has_function_privilege('anon', 'public.conta_impuesto_calendario(uuid,date)', 'execute') then
    raise exception 'PRUEBA S02 CIFRAS · 7: el calendario no conserva sus permisos.';
  end if;
  raise notice 'PRUEBA S02 CIFRAS · 7: la vuelta atrás deja el calendario byte a byte y ninguna de las tres.';
end $$;

\i supabase/migrations/20261205T0490_s02_cifras.sql
do $$ begin
  if to_regprocedure('public.conta_pendientes(uuid)') is null or (select md5(prosrc) from pg_proc where oid = 'public.conta_impuesto_calendario(uuid,date)'::regprocedure) = '480da33a07e1885441de585237156d3e' then
    raise exception 'PRUEBA S02 CIFRAS · 7: la 0490 no vuelve a entrar después de la vuelta atrás.';
  end if;
  raise notice 'PRUEBA S02 CIFRAS · 7: y otra vez delante.';
end $$;

rollback;
