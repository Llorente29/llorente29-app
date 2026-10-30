-- supabase/migrations/20261029T0850_lab1_importador_lote.sql
--
-- LAB1 · Importador del historial de personal desde Cegid, tanda 1 (29/10/2026):
-- el lote y lo crudo, y guardar SOLO las cabeceras de un fichero.
-- Plan: docs/laboral/importador_cegid_plan.md (§2.1 y §4).
--
-- SOLO AÑADE: dos tablas nuevas y una función nueva. Nada existe hoy (medido en
-- producción el 29/10: ninguna tabla lab_* ni bucket lab*).
--
--   1. lab_import_lote: una subida. Su resumen guarda, en la tanda 1, las hojas
--      del fichero con sus cabeceras y cuántas filas tiene cada una, y la
--      comparación con lo esperado. NINGÚN valor de ninguna fila.
--   2. lab_import_fila: cada fila de cada hoja, tal cual. Se llena desde la
--      tanda 2 (leer); en la 1 se crea vacía, con sus guardas.
--   3. lab_import_leer_cabeceras(): guarda (o reconoce, si es el mismo fichero)
--      el lote con las cabeceras. Solo el administrador de la cuenta.
--
-- Datos privados (plan, principio 8): salarios, DNI y nóminas los ve solo el
-- administrador de la cuenta. Las dos tablas, con RLS «solo administrador» y
-- sin escritura directa: se escribe por las funciones.
--
-- El fichero NO se sube en la tanda 1: se lee en el navegador. El bucket
-- privado llega con la tanda 2, que es la que lee filas.
--
-- Vuelta atrás: supabase/vuelta-atras/20261029T0850_lab1_importador_lote.down.sql

create table if not exists public.lab_import_lote (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts(id) on delete cascade,
  origen         text not null default 'cegid' check (origen in ('cegid')),
  fichero_nombre text not null,
  fichero_huella text not null,
  estado         text not null default 'leido' check (estado in ('leido', 'validado', 'aplicado', 'deshecho', 'descartado')),
  resumen        jsonb not null default '{}'::jsonb,
  subido_por     uuid default auth.uid(),
  subido_at      timestamptz not null default now(),
  aplicado_por   uuid,
  aplicado_at    timestamptz
);
comment on table public.lab_import_lote is
  'LAB1 · Una subida del paquete de historial de personal (Cegid). Desde la tanda 1 guarda las cabeceras de cada hoja y su comparación con lo esperado; ningún valor. Solo el administrador de la cuenta.';
-- El mismo fichero (misma huella) no hace dos lotes vivos en una cuenta.
create unique index if not exists lab_import_lote_huella_viva
  on public.lab_import_lote (account_id, fichero_huella) where estado not in ('deshecho', 'descartado');
create index if not exists lab_import_lote_cuenta on public.lab_import_lote (account_id, subido_at desc);

create table if not exists public.lab_import_fila (
  id            uuid primary key default gen_random_uuid(),
  lote_id       uuid not null references public.lab_import_lote(id) on delete cascade,
  account_id    uuid not null references public.accounts(id) on delete cascade,
  hoja          text not null check (hoja in ('empresa', 'convenio', 'tablas_salariales', 'conceptos', 'trabajadores',
                                              'contratos', 'nominas', 'nominas_conceptos', 'cuadre_contable')),
  fila_n        integer not null check (fila_n > 0),
  datos         jsonb not null,
  huella        text not null,
  estado        text not null default 'ok' check (estado in ('ok', 'aviso', 'error', 'ignorada')),
  mensajes      text[] not null default '{}',
  destino_tabla text,
  destino_id    uuid,
  unique (lote_id, hoja, fila_n)
);
comment on table public.lab_import_fila is
  'LAB1 · Cada fila de cada hoja de un lote, tal cual (desde la tanda 2). account_id duplicado a propósito, para la RLS y la regla 9. Solo el administrador de la cuenta.';

alter table public.lab_import_lote enable row level security;
alter table public.lab_import_fila enable row level security;

drop policy if exists lab_import_lote_leer on public.lab_import_lote;
create policy lab_import_lote_leer on public.lab_import_lote for select to authenticated
  using (public.current_user_is_admin_of(account_id));
drop policy if exists lab_import_fila_leer on public.lab_import_fila;
create policy lab_import_fila_leer on public.lab_import_fila for select to authenticated
  using (public.current_user_is_admin_of(account_id));

revoke all on public.lab_import_lote from anon, authenticated;
revoke all on public.lab_import_fila from anon, authenticated;
grant select on public.lab_import_lote to authenticated;
grant select on public.lab_import_fila to authenticated;

-- Guarda las cabeceras de un fichero. p_hojas: [{nombre, columnas: [texto], filas: n}];
-- p_comparacion: lo que calcula la pantalla (cegidCabeceras.ts). Si la cuenta ya
-- tiene un lote vivo con la misma huella, lo reconoce y le pone las cabeceras de
-- ahora (repetido = true): subir dos veces el mismo fichero no hace dos lotes.
create or replace function public.lab_import_leer_cabeceras(
  p_account_id uuid, p_fichero_nombre text, p_fichero_huella text, p_hojas jsonb, p_comparacion jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lote public.lab_import_lote;
  v_repetido boolean := false;
  v_h jsonb;
begin
  if p_account_id is null or not public.current_user_is_admin_of(p_account_id) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501', hint = 'El historial de personal lo importa el administrador de la cuenta.';
  end if;
  if coalesce(btrim(p_fichero_nombre), '') = '' or coalesce(p_fichero_huella, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'FICHERO_SIN_NOMBRE_O_HUELLA' using errcode = '22023';
  end if;
  if jsonb_typeof(p_hojas) is distinct from 'array' or jsonb_array_length(p_hojas) = 0 then
    raise exception 'SIN_HOJAS' using errcode = '22023', hint = 'El fichero no trae ninguna hoja.';
  end if;
  -- Solo cabeceras: nombre, columnas (textos) y filas (un número). Nada más.
  for v_h in select * from jsonb_array_elements(p_hojas) loop
    if jsonb_typeof(v_h) <> 'object'
       or (select count(*) from jsonb_object_keys(v_h) k where k not in ('nombre', 'columnas', 'filas')) > 0
       or jsonb_typeof(v_h -> 'nombre') <> 'string'
       or jsonb_typeof(v_h -> 'columnas') <> 'array'
       or jsonb_typeof(v_h -> 'filas') <> 'number'
       or exists (select 1 from jsonb_array_elements(v_h -> 'columnas') c where jsonb_typeof(c) <> 'string') then
      raise exception 'HOJA_MAL_FORMADA' using errcode = '22023', hint = 'Cada hoja lleva solo su nombre, sus cabeceras y cuántas filas tiene.';
    end if;
  end loop;
  if pg_column_size(p_hojas) + pg_column_size(coalesce(p_comparacion, '{}'::jsonb)) > 262144 then
    raise exception 'CABECERAS_DEMASIADO_GRANDES' using errcode = '22023';
  end if;

  select * into v_lote from public.lab_import_lote
   where account_id = p_account_id and fichero_huella = p_fichero_huella and estado not in ('deshecho', 'descartado');
  if v_lote.id is not null then
    v_repetido := true;
    update public.lab_import_lote
       set resumen = jsonb_build_object('hojas', p_hojas, 'comparacion', coalesce(p_comparacion, '{}'::jsonb)),
           fichero_nombre = btrim(p_fichero_nombre)
     where id = v_lote.id
    returning * into v_lote;
  else
    insert into public.lab_import_lote (account_id, origen, fichero_nombre, fichero_huella, resumen, subido_por)
    values (p_account_id, 'cegid', btrim(p_fichero_nombre), p_fichero_huella,
            jsonb_build_object('hojas', p_hojas, 'comparacion', coalesce(p_comparacion, '{}'::jsonb)), auth.uid())
    returning * into v_lote;
  end if;
  return jsonb_build_object('id', v_lote.id, 'repetido', v_repetido, 'subido_at', v_lote.subido_at, 'estado', v_lote.estado);
end $$;
revoke all on function public.lab_import_leer_cabeceras(uuid, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.lab_import_leer_cabeceras(uuid, text, text, jsonb, jsonb) to authenticated;
