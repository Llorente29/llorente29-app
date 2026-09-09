-- ══════════════════════════════════════════════════════════════════════════
-- combo_slot_option gana `updated_at`, que era la única de las seis sin él
-- ══════════════════════════════════════════════════════════════════════════
--
-- ✅ APLICADA el 09/09/2026 por MCP. La base la registró como 20260909074319 y
-- el fichero lleva ya ese nombre (regla 17). Este fichero es el REGISTRO de lo
-- que se ejecutó, no una propuesta: se escribe idempotente y con guarda para
-- que volver a pasarlo no haga nada y para que avise si la base no es la que
-- se describe aquí.
--
-- ── QUÉ PASÓ ──────────────────────────────────────────────────────────────
--
-- La importación de cedidas, ya con las claves alineadas a los índices, cerró
-- `combo_slot` (132 → 161 ids: 29 creados y 2 actualizados — la corrección de
-- clave funcionó) y murió en el paso siguiente con:
--
--   Could not find the 'updated_at' column of 'combo_slot_option'
--   in the schema cache
--
-- El importador pone `updated_at` en cada UPDATE, porque es lo que hace que se
-- pueda saber cuándo se tocó una fila por última vez. Cinco de las seis tablas
-- de catálogo tenían la columna; `combo_slot_option` no.
--
-- ── POR QUÉ UNA COLUMNA Y NO UNA EXCEPCIÓN EN EL IMPORTADOR ───────────────
--
-- Decisión de Julio (delegada, 09/09): añadir la columna en vez de enseñarle al
-- importador que esa tabla es distinta. **Una excepción hay que recordarla**, y
-- en dos horas nos habían mordido ya tres suposiciones de esa familia: el
-- endpoint de descubrimiento, la clave contra el índice, y ésta. La regularidad
-- se defiende sola; la excepción sólo mientras alguien la tenga en la cabeza.
--
-- ── SIN TRIGGER, A PROPÓSITO ──────────────────────────────────────────────
--
-- No se le pone `set_updated_at`. Medido antes de decidirlo, sobre pg_trigger:
-- de las seis tablas de catálogo, **sólo `menu_item`** tiene un trigger que
-- mantenga la columna (`set_menu_item_updated_at`). `menu_category`,
-- `modifier_group`, `modifier_option` y `combo_slot` no lo tienen: su
-- `updated_at` lo escribe quien actualiza. Así que no ponerlo es lo que deja a
-- `combo_slot_option` IGUAL que sus cuatro hermanas, y ponerlo habría sido
-- crear una sexta forma de comportarse — exactamente lo que esta migración
-- viene a evitar.
--
-- ── REVERSIBLE ────────────────────────────────────────────────────────────
--
--   alter table public.combo_slot_option drop column updated_at;
--
-- Es aditiva: no toca datos existentes (las filas viejas quedan con el `now()`
-- del momento de aplicar, que es lo que hay — no se puede inventar cuándo se
-- tocaron de verdad, y decirlo aquí es más honesto que un valor bonito).
-- ══════════════════════════════════════════════════════════════════════════

begin;

alter table public.combo_slot_option
  add column if not exists updated_at timestamptz not null default now();

comment on column public.combo_slot_option.updated_at is
  'Cuando se toco la fila por ultima vez. La escribe quien actualiza (no hay '
  'trigger, igual que en combo_slot, menu_category, modifier_group y '
  'modifier_option; solo menu_item tiene set_updated_at). Anadida el 09/09/2026 '
  'porque era la unica de las seis tablas de catalogo sin ella y el importador '
  'de Last moria con «Could not find the updated_at column in the schema cache».';

-- ── Guarda: que la base sea la que este fichero describe ──────────────────
do $guarda$
declare
  v_tipo text; v_null text; v_def text; v_trg integer; v_faltan integer;
begin
  select data_type, is_nullable, column_default
    into v_tipo, v_null, v_def
    from information_schema.columns
   where table_schema='public' and table_name='combo_slot_option' and column_name='updated_at';

  if v_tipo is null then
    raise exception 'ABORTA: combo_slot_option.updated_at no existe despues del ALTER.';
  end if;
  if v_tipo <> 'timestamp with time zone' or v_null <> 'NO' or v_def not like 'now()%' then
    raise exception 'ABORTA: la columna quedo como (%, nullable %, default %) y no como timestamptz NOT NULL DEFAULT now().', v_tipo, v_null, v_def;
  end if;

  -- Las SEIS tablas de catalogo tienen ya la columna: ese era el objetivo.
  select 6 - count(*) into v_faltan
    from information_schema.columns
   where table_schema='public' and column_name='updated_at'
     and table_name in ('menu_item','menu_category','modifier_group',
                        'modifier_option','combo_slot','combo_slot_option');
  if v_faltan <> 0 then
    raise exception 'ABORTA: % de las seis tablas de catalogo siguen sin updated_at.', v_faltan;
  end if;

  -- Y sigue habiendo UN solo trigger de updated_at entre las seis, el de
  -- menu_item. Si aparece otro, la regularidad que justifica esta migracion ha
  -- dejado de ser cierta y hay que mirarlo antes de dar el fichero por bueno.
  select count(*) into v_trg
    from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    join pg_proc p on p.oid=t.tgfoid
   where not t.tgisinternal and n.nspname='public' and p.proname='set_updated_at'
     and c.relname in ('menu_item','menu_category','modifier_group',
                       'modifier_option','combo_slot','combo_slot_option');
  if v_trg <> 1 then
    raise exception 'ABORTA: hay % triggers set_updated_at entre las seis tablas; se esperaba 1 (el de menu_item).', v_trg;
  end if;

  raise notice 'OK: las seis tablas de catalogo tienen updated_at, y un unico trigger (menu_item).';
end
$guarda$;

commit;

-- ══════════════════════════════════════════════════════════════════════════
-- LO QUE PASÓ DESPUÉS, para que quede con la migración (regla 5)
-- ══════════════════════════════════════════════════════════════════════════
--
-- Aplicada a las 09:43:19 (Madrid). La pasada siguiente del importador cerró lo
-- que faltaba a las 09:46:26, y sólo se movieron las dos tablas de combos:
--
--   tabla                      antes   después
--   menu_category                241       241
--   menu_item                    553       553
--   modifier_group                51        51
--   modifier_option              210       210
--   combo_slot                   132       161   (29 nuevos, 2 actualizados)
--   combo_slot_option            381       484   (103 nuevos)
--   modifier_group_assignment    271       271
--
-- O sea lo que se esperaba: las cuatro primeras ya estaban en sintonía con Last
-- y no se tocó nada suyo. La importación de cedidas quedó COMPLETA.
-- ══════════════════════════════════════════════════════════════════════════
