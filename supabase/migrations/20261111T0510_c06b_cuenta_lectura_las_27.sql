-- ============================================================================
-- C06b · AVISO #178: LAS 27 SUBCUENTAS DE FOODINT, CON SU LECTURA
-- ----------------------------------------------------------------------------
-- autorizo: hace falta (update sobre filas que existen).
--
-- Respuesta 5 de Julio, punto 2: «Rellenar las 27 que ya existen pide
-- autorizo. No se borra ni se recrea ninguna. Nunca que una cuenta pase por
-- su nombre.»
--
-- Qué escribe: company_account.import_run_id (la columna de la 0500) en las
-- subcuentas que dicen venir de otro programa (source 'migrated') sin
-- importación del plan (import_id vacío) y sin lectura escrita. La lectura
-- NO se elige por el nombre de nadie ni por un literal: es la ÚNICA lectura
-- del histórico, en estado «hecho» y de la MISMA cuenta y empresa, cuyos
-- asientos traídos usan esa subcuenta. Si una subcuenta no tiene exactamente
-- una, no se toca, y la guarda de abajo para la tanda entera.
--
-- Lo medido en producción el 14/10, solo leyendo (regla 9: Foodint,
-- account_id 51ad1792…, empresa 658728c0…): 27 subcuentas así, las 27 de
-- Foodint y ninguna de otra cuenta; las 27 con apuntes de la única lectura del
-- histórico (import_run 0542e958…, historico, hecho), ninguna con apuntes de
-- otra lectura, y creadas en la misma transacción que esa lectura
-- (2026-10-12 21:04:04.733305+00 los dos).
--
-- Guarda: escribe 27 o para (nada se queda a medias: la tanda va en una
-- transacción). Después, 0 subcuentas «migrated» sin import_id ni
-- import_run_id.
--
-- Vuelta atrás: supabase/vuelta-atras/20261111T0510_c06b_cuenta_lectura_las_27.down.sql
-- ============================================================================

do $$
declare n int; quedan int;
begin
  with candidatas as (
    select a.id, a.account_id, a.company_id
      from public.company_account a
     where a.source = 'migrated' and a.import_id is null and a.import_run_id is null
  ), lectura as (
    select c.id, (array_agg(distinct r.id))[1] run, count(distinct r.id) lecturas
      from candidatas c
      join public.journal_line l on l.company_account_id = c.id and l.account_id = c.account_id
      join public.journal_entry e on e.id = l.entry_id and e.account_id = c.account_id and e.company_id = c.company_id
      join public.import_run r on r.id = e.import_run_id and r.account_id = c.account_id and r.company_id = c.company_id
                              and r.status = 'hecho' and r.kind in ('historico', 'al_dia')
     group by c.id
  )
  update public.company_account a set import_run_id = x.run
    from lectura x where x.id = a.id and x.lecturas = 1;
  get diagnostics n = row_count;
  if n <> 27 then
    raise exception 'C06b 0510: esperaba escribir la lectura de 27 subcuentas y serían %. No se toca nada.', n;
  end if;
  select count(*) into quedan from public.company_account where source = 'migrated' and import_id is null and import_run_id is null;
  if quedan <> 0 then
    raise exception 'C06b 0510: quedarían % subcuentas «migrated» sin importación ni lectura. No se toca nada.', quedan;
  end if;
end $$;
