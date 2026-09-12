-- ════════════════════════════════════════════════════════════════════════════
-- DOS VARAS PARA LO MISMO: Extras escribia con encargado y Modificadores no
--
-- Medido el 12/09 (§0.3 del paquete 1 de la fase C):
--     recipe_item, la vara de Extras ..... current_user_is_admin_or_manager_of
--     modifier_group ..................... current_user_is_admin_of
--     modifier_option .................... current_user_is_admin_of
--     modifier_group_assignment .......... current_user_is_admin_of
--     modifier_recipe_impact ............. current_user_is_admin_of
--
-- Y LA DIFERENCIA ERA INERTE, que es lo que la hacia peligrosa: en toda la
-- base no existe NI UNA persona con rol `manager` (solo `admin` y `worker`),
-- asi que hoy escribe el administrador y nadie mas, en las dos. El dia que
-- Julio cree un encargado, Extras funcionaria y Modificadores no — en
-- silencio y desde la RLS, que es donde peor se ve.
--
-- Decision de Julio, 11:00: alinear las cuatro. No es ampliar por ampliar: es
-- que la misma persona que ya edita el escandallo de un extra pueda crear la
-- pregunta que lo vende.
--
-- LA LECTURA NO SE TOCA: sigue siendo `account_id = ANY(current_user_account_ids())`.
--
-- ENSAYADO POR CAMINOS antes de aplicar, siendo de verdad cada rol
-- (`SET LOCAL ROLE authenticated` + `request.jwt.claims`), 0 fallos:
--   A1..A3  el ADMINISTRADOR escribe igual que antes, y sigue sin tocar otra cuenta
--   E1..E4  la ENCARGADA ya escribe preguntas, opciones, asignaciones y lo que llevan
--   E5      y NO la de otra cuenta (regla 9)
--   T1      un TRABAJADOR sigue sin poder escribir
--   T2      pero sigue leyendo las 65 preguntas: la lectura no se toca
-- ════════════════════════════════════════════════════════════════════════════

ALTER POLICY modifier_group_write ON public.modifier_group
  USING (public.current_user_is_admin_or_manager_of(account_id))
  WITH CHECK (public.current_user_is_admin_or_manager_of(account_id));

ALTER POLICY modifier_option_write ON public.modifier_option
  USING (public.current_user_is_admin_or_manager_of(account_id))
  WITH CHECK (public.current_user_is_admin_or_manager_of(account_id));

ALTER POLICY modifier_group_assignment_write ON public.modifier_group_assignment
  USING (public.current_user_is_admin_or_manager_of(account_id))
  WITH CHECK (public.current_user_is_admin_or_manager_of(account_id));

ALTER POLICY modifier_recipe_impact_write ON public.modifier_recipe_impact
  USING (public.current_user_is_admin_or_manager_of(account_id))
  WITH CHECK (public.current_user_is_admin_or_manager_of(account_id));

-- ── HUELLA · las cuatro, y la lectura intacta ─────────────────────────────
DO $huellas$
DECLARE v_mal int;
BEGIN
  SELECT count(*) INTO v_mal
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND p.polcmd='*'
     AND c.relname IN ('modifier_group','modifier_option','modifier_group_assignment','modifier_recipe_impact')
     AND pg_get_expr(p.polwithcheck, p.polrelid)
         IS DISTINCT FROM 'current_user_is_admin_or_manager_of(account_id)';
  IF v_mal > 0 THEN
    RAISE EXCEPTION '% politicas de escritura no han quedado alineadas', v_mal;
  END IF;

  SELECT count(*) INTO v_mal
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND p.polcmd='r'
     AND c.relname IN ('modifier_group','modifier_option','modifier_group_assignment','modifier_recipe_impact')
     AND pg_get_expr(p.polqual, p.polrelid)
         IS DISTINCT FROM '(account_id = ANY (current_user_account_ids()))';
  IF v_mal > 0 THEN
    RAISE EXCEPTION 'la LECTURA se ha movido en % politicas, y no debia tocarse', v_mal;
  END IF;
END $huellas$;