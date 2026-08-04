-- ============================================================================
-- Formación — Pieza E.1: show_formacion nunca se sembró en permission_sets.
--
-- RECON (has_permission, 00000000000000_baseline.sql líneas ~540-610): la
-- cascada de permisos mira primero manager_permissions (legacy, por columna
-- dinámica -- si la columna no existe, sigue sin romper) y LUEGO
-- permission_sets.permissions ->> p_permission_key. Si la clave no existe
-- en el JSONB, (permissions ->> 'show_formacion')::boolean da NULL -> cae
-- al Step 4, DEFAULT DENY. 'show_formacion' nunca se añadió a NINGÚN
-- permission_set (ni a los "system" que replicate_system_permission_sets()
-- copia a cada cuenta nueva, ni a los ya existentes) -- por eso NINGÚN
-- manager ve "Formación" en el menú, solo los admin (que bypasean el
-- diccionario entero).
--
-- get_effective_permissions/has_permission NO están versionados en el repo
-- (drift -- viven solo en producción) y el contenido real de
-- permission_sets.permissions tampoco: por eso este arreglo es un UPDATE
-- aditivo con el operador ||, que NUNCA necesita conocer el JSONB existente
-- para no romperlo -- añade SOLO la clave que falta, deja todo lo demás
-- intacto sea lo que sea. Idempotente: si la clave ya existiera (reaplicar
-- esta migración, o alguien la puso a mano), el filtro `not (permissions ?
-- 'show_formacion')` no la vuelve a tocar.
--
-- Alcance: TODOS los permission_sets (no solo los "system") -- el fallo es
-- que la clave nunca existió en ninguno, no una restricción deliberada de
-- ningún admin. Se añade con valor true (visible por defecto, igual que el
-- resto de show_* del módulo Personal).
--
-- Puro dato (UPDATE), sin DDL. Sin COMMIT/ROLLBACK -- no hace falta un DO ni
-- aislamiento por fila: es un único UPDATE con predicado, o falla entero
-- (error real, no un dato parcial) o no falla.
-- ============================================================================

update public.permission_sets
set permissions = coalesce(permissions, '{}'::jsonb) || '{"show_formacion": true}'::jsonb
where not (coalesce(permissions, '{}'::jsonb) ? 'show_formacion');

-- ────────────────────────────────────────────────────────────────────────────
-- GUARD — que ya no queda ningún permission_set sin la clave.
-- ────────────────────────────────────────────────────────────────────────────
do $guard$
declare
  v_faltan integer;
begin
  select count(*) into v_faltan
  from public.permission_sets
  where not (coalesce(permissions, '{}'::jsonb) ? 'show_formacion');

  if v_faltan > 0 then
    raise exception 'MIGRACIÓN FALLIDA: % permission_sets siguen sin la clave show_formacion', v_faltan;
  end if;

  raise notice 'show_formacion sembrado en todos los permission_sets (%).', (select count(*) from public.permission_sets);
end
$guard$;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (Julio, aparte, tras aplicar) — un manager sin acceso admin
-- debe ver "Formación" en el menú de Team tras recargar sesión:
--
--   select id, name, is_system, account_id, permissions -> 'show_formacion' as show_formacion
--     from permission_sets
--    order by is_system desc, name;
-- ============================================================================
