-- scripts/conta/produccion/cuentas/g01c-crm-neutro-b.sql
--
-- G01c · PR B de la clave neutra · LO QUE CUENTA LA TANDA, antes y después.
-- SOLO LEE (de Vault, solo el nombre del secreto, nunca su valor). La misma
-- vara a los dos lados (regla 31). Lo que tiene que pasar con la tanda (y
-- volver con su vuelta atrás):
--   1. Tablas y vistas con «bitrix» en el nombre: 1 → 0.
--   2. Funciones con «bitrix» en el nombre: 9 → 2 (las de los espejos, sin disparador; se borran en la tanda siguiente).
--   3. Columnas con «bitrix» en el nombre (tablas y vistas): 8 → 8 (son para después, en su propio PR).
--   4. Lecturas con el origen de antes, de antes del 08/11 00:00 UTC: 10 → 0.
--   5. Diferencias de los tipos de antes, de lecturas de antes del 08/11 00:00 UTC: 2.840 → 0.
--   6. Conexiones con el secreto llamado como antes («conta_bitrix:»): 1 → 0.
--   7. Conexiones con el secreto llamado neutro («conta_crm:»): 0 → 1 (la misma dirección, sin volver a pegarla).
select clave, valor from (
  select 1 o, 'Tablas y vistas con «bitrix» en el nombre' clave,
    (select count(*)::text from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname ilike '%bitrix%' and c.relkind in ('r', 'v')) valor union all
  select 2, 'Funciones con «bitrix» en el nombre',
    (select count(*)::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname ilike '%bitrix%') union all
  select 3, 'Columnas con «bitrix» en el nombre (tablas y vistas)',
    (select count(*)::text from information_schema.columns where table_schema = 'public' and column_name ilike '%bitrix%') union all
  select 4, 'Lecturas con el origen de antes (todas las cuentas, antes del 08/11 00:00 UTC)',
    (select count(*)::text from public.conta_gestoria_lectura where origen = 'bitrix' and empezada_at < timestamptz '2026-11-08 00:00+00') union all
  select 5, 'Diferencias de los tipos de antes (todas las cuentas, de lecturas de antes del 08/11 00:00 UTC)',
    (select count(*)::text from public.conta_gestoria_diferencia d join public.conta_gestoria_lectura l on l.id = d.lectura_id
      where d.tipo in ('bitrix_sin_cobro', 'nif_repetido_en_bitrix', 'correo_repetido_en_bitrix') and l.empezada_at < timestamptz '2026-11-08 00:00+00') union all
  select 6, 'Conexiones con el secreto llamado como antes (todas las cuentas)',
    -- quieta: el secreto solo lo cambia guardar la conexión, que lo hace una persona y no corre en el ensayo
    (select count(*)::text from public.conta_crm c join vault.secrets s on s.id = c.url_ref where s.name like 'conta\_bitrix:%') union all
  select 7, 'Conexiones con el secreto llamado neutro (todas las cuentas)',
    -- quieta: el secreto solo lo cambia guardar la conexión, que lo hace una persona y no corre en el ensayo
    (select count(*)::text from public.conta_crm c join vault.secrets s on s.id = c.url_ref where s.name like 'conta\_crm:%')
) q order by o;
