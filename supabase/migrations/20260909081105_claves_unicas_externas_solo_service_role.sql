-- ══════════════════════════════════════════════════════════════════════════
-- `claves_unicas_externas` pasa a ser privada de verdad
-- ══════════════════════════════════════════════════════════════════════════
--
-- ✅ APLICADA el 09/09/2026 por MCP, justo detrás de 20260909081014. La base la
-- registró como 20260909081105 y el fichero lleva ese nombre (regla 17).
--
-- ── QUÉ ARREGLA ───────────────────────────────────────────────────────────
--
-- La migración anterior DECLARABA «EXECUTE revocado de PUBLIC: sólo
-- service_role» y no lo consiguió. Medido justo después de aplicarla:
--
--   service_role=EXECUTE, authenticated=EXECUTE, anon=EXECUTE, postgres=EXECUTE
--
-- `REVOKE ALL ... FROM public` quita el pseudo-rol PUBLIC. No quita los GRANT
-- EXPLÍCITOS que este proyecto concede a `anon` y `authenticated` sobre toda
-- función nueva de `public`, por ALTER DEFAULT PRIVILEGES.
--
-- ── EL PATRÓN, MEDIDO, PORQUE NO ES UN CASO AISLADO ───────────────────────
--
-- De las 1.446 funciones de `public`:
--
--   con EXECUTE para `anon` .............. 1.169
--   con EXECUTE para `authenticated` ..... 1.331
--   sin ACL explícita .......................  0
--
-- O sea que **el valor por defecto de esta base es «la puede llamar cualquiera
-- con la clave anónima»**, y un REVOKE FROM PUBLIC no lo cambia. Quien quiera
-- una función privada tiene que revocar de `anon` y `authenticated` POR NOMBRE,
-- como hace este fichero. Escrito aquí para que la próxima vez no haya que
-- descubrirlo otra vez.
--
-- ── ALCANCE ───────────────────────────────────────────────────────────────
--
-- Sólo esta función. NO se toca el ACL de las otras 1.445: revisar cuáles
-- deberían ser privadas es un encargo aparte y de seguridad, no un efecto
-- colateral de arreglar la de hoy.
--
-- ── QUÉ SE PIERDE Y QUÉ NO ────────────────────────────────────────────────
--
-- La llama el importador, que corre con la clave de `service_role`. Ningún
-- camino del front la usa (es metadato de índices, no dato de negocio), así que
-- quitarle `anon` y `authenticated` no rompe nada. Si algún día una pantalla la
-- necesitara, se le concede a `authenticated` explícitamente y se dice por qué.
--
-- ── REVERSIBLE ────────────────────────────────────────────────────────────
--
--   grant execute on function public.claves_unicas_externas(text[]) to anon, authenticated;
-- ══════════════════════════════════════════════════════════════════════════

begin;

revoke execute on function public.claves_unicas_externas(text[]) from public;
revoke execute on function public.claves_unicas_externas(text[]) from anon;
revoke execute on function public.claves_unicas_externas(text[]) from authenticated;
grant  execute on function public.claves_unicas_externas(text[]) to service_role;

-- ── Guarda: que el ACL sea el que este fichero dice, y no el que suponía el
--    anterior. Se comprueba el estado FINAL, no que el REVOKE se ejecutara.
do $verif$
declare
  v_acl text;
begin
  select coalesce(p.proacl::text, '(sin acl)') into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'claves_unicas_externas';

  if v_acl is null then
    raise exception 'ABORTA: public.claves_unicas_externas no existe.';
  end if;
  if v_acl like '%anon=%' then
    raise exception 'ABORTA: anon sigue con permisos sobre la funcion. ACL: %', v_acl;
  end if;
  if v_acl like '%authenticated=%' then
    raise exception 'ABORTA: authenticated sigue con permisos sobre la funcion. ACL: %', v_acl;
  end if;
  if v_acl not like '%service_role=X%' then
    raise exception 'ABORTA: service_role se ha quedado SIN EXECUTE y el importador no podria llamarla. ACL: %', v_acl;
  end if;

  raise notice 'OK: ACL final %', v_acl;
end
$verif$;

commit;

-- ══════════════════════════════════════════════════════════════════════════
-- DESPUÉS DE APLICAR — pegar el resultado, no el resumen (regla 5)
-- ══════════════════════════════════════════════════════════════════════════
--
--   select p.proacl::text from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname='public' and p.proname='claves_unicas_externas';
--
--   -- medido tras aplicar: {postgres=X/postgres,service_role=X/postgres}
-- ══════════════════════════════════════════════════════════════════════════
