-- ══════════════════════════════════════════════════════════════════════════
-- Que el código pueda PREGUNTAR con qué clave decide la base, en vez de creerlo
-- ══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ SIN APLICAR. Se renombra a la versión que registre la base (regla 17).
-- Va ANTES de desplegar el importador que la usa: si se despliega el código
-- primero, el importador aborta diciendo que falta esta migración.
--
-- ── POR QUÉ ───────────────────────────────────────────────────────────────
--
-- El 09/09 la primera importación de verdad murió con
-- `duplicate key ... "uq_combo_slot_external"`. La causa no fue el código: fue
-- que yo había MEDIDO la unicidad en `pg_constraint`, donde los índices únicos
-- PARCIALES no aparecen, y salí con la conclusión contraria a la verdad. Elegí
-- para cada tabla la clave «natural» de su ámbito y coincidió en 2 de 6.
--
-- Tres suposiciones de esa familia mordieron el mismo día: la clave contra el
-- índice, un precio base comparado contra un precio por canal, y una columna
-- que no estaba. De ahí la regla 39: la vara la elige la base, no la comodidad.
--
-- Y su corolario, que es esto: **la mejor defensa no es acordarse.** Un
-- comentario que dice «esta clave replica uq_combo_slot_external» envejece en
-- silencio el día que alguien cambia el índice. Una comprobación al arrancar,
-- no.
--
-- ── QUÉ HACE, Y QUÉ NO ────────────────────────────────────────────────────
--
-- Devuelve, para las tablas que se le pidan, los índices ÚNICOS que incluyen
-- `external_id`, con sus columnas en orden. Nada más. Es de sólo lectura sobre
-- el catálogo del sistema; no toca datos ni schema.
--
-- Lo que hace el que la llama —y esto importa— es **VERIFICAR, NO DERIVAR**.
-- El importador seguirá declarando su clave en el código, a la vista, y al
-- arrancar comparará con lo que diga esta función: si no coinciden, para y dice
-- las dos. Derivar la clave del índice sería peor: el comportamiento cambiaría
-- solo el día que alguien toque un índice, que es justo cuando hace falta que
-- alguien mire.
--
-- ── LO QUE DEVUELVE HOY (medido el 09/09, para que se vea qué se espera) ───
--
--   menu_item          uq_menu_item_external          {account_id, external_source, external_id, brand_id}
--   menu_category      uq_menu_category_external      {account_id, external_source, external_id}
--   modifier_group     uq_modifier_group_external     {account_id, external_source, external_id}
--   modifier_option    uq_modifier_option_external    {account_id, external_source, external_id}
--   combo_slot         uq_combo_slot_external         {account_id, external_source, external_id}
--   combo_slot_option  uq_combo_slot_option_external  {account_id, external_source, external_id}
--
-- ── PERMISOS ──────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER con `search_path` fijo, y EXECUTE revocado de PUBLIC: sólo
-- `service_role`, que es con lo que corre el importador. No expone datos de
-- ninguna cuenta —son metadatos de índices— pero no hay razón para que la
-- pueda llamar un cliente con la clave anónima.
--
-- ── REVERSIBLE ────────────────────────────────────────────────────────────
--
--   drop function public.claves_unicas_externas(text[]);
-- ══════════════════════════════════════════════════════════════════════════

begin;

do $guarda$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'claves_unicas_externas') then
    raise exception 'ABORTA: ya existe public.claves_unicas_externas. Crear otra firma seria una SOBRECARGA (regla 2).';
  end if;
end
$guarda$;

create function public.claves_unicas_externas(p_tablas text[])
returns table (tabla text, indice text, columnas text[], parcial boolean)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select t.relname::text                                   as tabla,
         i.relname::text                                   as indice,
         array(
           select a.attname::text
             from unnest(ix.indkey) with ordinality as k(attnum, ord)
             join pg_attribute a
               on a.attrelid = t.oid and a.attnum = k.attnum
            order by k.ord
         )                                                 as columnas,
         (ix.indpred is not null)                          as parcial
    from pg_index ix
    join pg_class     i on i.oid = ix.indexrelid
    join pg_class     t on t.oid = ix.indrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
     and ix.indisunique
     and t.relname = any (p_tablas)
     -- Sólo los que gobiernan la identidad EXTERNA. La clave primaria por `id`
     -- no dice nada sobre si dos filas de Last son la misma.
     and exists (
       select 1
         from unnest(ix.indkey) as kk(attnum)
         join pg_attribute aa on aa.attrelid = t.oid and aa.attnum = kk.attnum
        where aa.attname = 'external_id'
     )
   order by 1, 2
$fn$;

comment on function public.claves_unicas_externas(text[]) is
  'Con que clave decide la base que dos filas externas son la misma. Devuelve '
  'los indices UNICOS que incluyen external_id, con sus columnas en orden. '
  'Existe porque el 09/09 el importador murio con un duplicate key: la clave '
  'del codigo no era la del indice, y la medicion que lo dejo pasar miraba '
  'pg_constraint, donde los indices unicos PARCIALES no aparecen. Quien la use '
  'debe VERIFICAR su clave contra esto y abortar si no coincide, NO derivarla: '
  'derivarla haria que el comportamiento cambiase solo el dia que alguien toca '
  'un indice, que es justo cuando hace falta que alguien mire.';

revoke all on function public.claves_unicas_externas(text[]) from public;
grant execute on function public.claves_unicas_externas(text[]) to service_role;

-- ── Que devuelva lo que este fichero dice que devuelve ────────────────────
do $verif$
declare
  r record;
  v_n integer := 0;
  v_esperado jsonb := jsonb_build_object(
    'menu_item',         'account_id,external_source,external_id,brand_id',
    'menu_category',     'account_id,external_source,external_id',
    'modifier_group',    'account_id,external_source,external_id',
    'modifier_option',   'account_id,external_source,external_id',
    'combo_slot',        'account_id,external_source,external_id',
    'combo_slot_option', 'account_id,external_source,external_id'
  );
begin
  for r in
    select * from public.claves_unicas_externas(array[
      'menu_item','menu_category','modifier_group',
      'modifier_option','combo_slot','combo_slot_option'])
  loop
    v_n := v_n + 1;
    if (v_esperado ->> r.tabla) is distinct from array_to_string(r.columnas, ',') then
      raise exception
        'ABORTA: % (%) devuelve [%] y este fichero anuncia [%]. La base ha cambiado desde el 09/09: hay que releerla antes de dar por buena la funcion.',
        r.tabla, r.indice, array_to_string(r.columnas, ','), (v_esperado ->> r.tabla);
    end if;
  end loop;

  if v_n <> 6 then
    raise exception 'ABORTA: la funcion devuelve % filas para las seis tablas; se esperaban 6.', v_n;
  end if;

  raise notice 'OK: las seis claves son las medidas el 09/09.';
end
$verif$;

commit;

-- ══════════════════════════════════════════════════════════════════════════
-- DESPUÉS DE APLICAR — pegar el resultado, no el resumen (regla 5)
-- ══════════════════════════════════════════════════════════════════════════
--
--   select tabla, indice, array_to_string(columnas, ', ') as columnas, parcial
--     from public.claves_unicas_externas(array[
--       'menu_item','menu_category','modifier_group',
--       'modifier_option','combo_slot','combo_slot_option'])
--    order by 1;
--
-- Las seis deben salir `parcial = true` (son
-- `CREATE UNIQUE INDEX ... WHERE external_id IS NOT NULL`), que es exactamente
-- lo que `pg_constraint` no enseñaba.
--
-- Y sólo DESPUÉS de esto se despliega el importador que la llama: si se hace al
-- revés, aborta diciendo que falta la migración — a propósito, porque un
-- importador que no puede comprobar su clave es el que ya nos costó una pasada.
-- ══════════════════════════════════════════════════════════════════════════
