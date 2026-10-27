-- scripts/conta/produccion/cuentas/l00-origen-del-fichaje.sql
--
-- L00 · el origen del fichaje (27/10) · LO QUE CUENTA LA TANDA, antes y después.
-- SOLO LEE. La huella del freno del doble toque y cuántas firmas tiene (regla 2:
-- una), si el CHECK admite 'tablet', y los fichajes por origen. Los fichajes
-- son de TABLA ENTERA, de todas las cuentas, a propósito (regla 9): la tanda no
-- toca ninguna fila, y la huella de «no se ha movido» es más fuerte así.
-- Medido en producción el 27/10 a las 11:13 UTC, antes: 72f6807d · 1 · no ·
-- kiosko 2144 / manual 23 / movil 0 / tablet 0.
select clave, valor from (
  select 1 o, 'huella de tg_clock_entry_debounce' clave, (select string_agg(left(md5(p.prosrc), 8), ',') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'tg_clock_entry_debounce') valor union all
  select 2, 'firmas de tg_clock_entry_debounce', (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'tg_clock_entry_debounce')::text union all
  select 3, 'el CHECK admite tablet', (select case when pg_get_constraintdef(c.oid) ~ 'tablet' then 'sí' else 'no' end from pg_constraint c where c.conname = 'clock_entries_source_check' and c.conrelid = 'public.clock_entries'::regclass) union all
  select 4, 'fichajes por origen (tabla entera, todas las cuentas)', (select string_agg(s || ' ' || n, ' / ' order by s) from (select coalesce(source, 'sin') s, count(*) n from public.clock_entries group by 1 union all select x, 0 from unnest(array['movil','tablet']) x where not exists (select 1 from public.clock_entries where source = x)) t)
) t order by o;
