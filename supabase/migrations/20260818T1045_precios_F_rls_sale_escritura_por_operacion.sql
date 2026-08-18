-- ============================================================================
-- ENCARGO CODE "Sacar la politica de escritura de sale del camino de lectura"
-- 18/08/2026
-- ============================================================================
-- UNA tabla: sale. Ninguna funcion de RLS se toca. menu_item_channel_economics
-- sigue en a3600331debb4402709f2f05e43ac173. Sin cambios de cliente: sin OTA.
--
-- EL PROBLEMA
-- sale tiene dos politicas, las dos PERMISSIVE, las dos para authenticated:
--   sale_read   SELECT  using  account_id = ANY (current_user_account_ids())
--   sale_write  ALL     using  current_user_is_admin_of(account_id)
--                       check  current_user_is_admin_of(account_id)
-- En Postgres FOR ALL incluye SELECT, y las permisivas se combinan con OR. Asi
-- que CADA fila leida evalua tambien current_user_is_admin_of(account_id).
-- Recibiendo una COLUMNA no se puede resolver una vez: se paga por fila.
--
-- Medido como authenticated con uid real (no como superusuario):
--   usage_30d suelto, 2.632 filas, sin RLS    4,05 ms
--   usage_30d suelto, 2.632 filas, con RLS   46,20 ms      x11
--   la misma funcion con argumento CONSTANTE  0,557 ms / 2.632 evaluaciones
-- Esa ultima linea es la prueba: constante -> se resuelve una vez; columna ->
-- por fila. El 91 % del nodo es la politica, no el recuento.
--
-- POR QUE ES NEUTRO PARA LA LECTURA
--   current_user_is_admin_of(X) = EXISTS(user_profiles: uid, account_id=X,
--                                        role='admin', active)
--                              OR current_user_is_admin()
--   current_user_account_ids()  = si current_user_is_admin() -> todas las cuentas
--                                 si no -> account_id de user_profiles(uid, active)
-- Rama 1: si es admin de X, tiene fila activa con ese account_id, y
--         current_user_account_ids() recoge sus account_id activos SIN filtrar
--         por rol. X esta dentro.
-- Rama 2: si es superadmin, current_user_account_ids() devuelve todas. X esta
--         dentro siempre que X exista en accounts.
-- No hay tercera rama, y las dos filtran active = true.
-- => Para el SELECT, sale_write concede un SUBCONJUNTO ESTRICTO de sale_read.
--    Sacarla del camino de lectura no puede cambiar lo que ve nadie.
--
-- LOS DOS HUECOS DE ESA DEMOSTRACION, COMPROBADOS ANTES DE APLICAR
--   a) sale.account_id NULO: current_user_is_admin_of(NULL) es false por la
--      rama 1 pero TRUE para un superadmin por la rama 2, mientras que
--      account_id = ANY(...) con NULL nunca es true. Una fila asi la veria hoy
--      un superadmin y dejaria de verla. VERIFICADO: account_id es NOT NULL y
--      hay 0 filas nulas.
--   b) sale.account_id HUERFANO (no existe en accounts): para un superadmin,
--      current_user_account_ids() saca los ids DE accounts, asi que un huerfano
--      quedaria fuera. VERIFICADO: 0 filas huerfanas.
--      OJO: no hay clave ajena de sale.account_id a accounts, asi que esto es
--      cierto HOY pero no esta impuesto. Anotado; si alguna vez aparece un
--      huerfano dejaria de verse, que probablemente sea lo correcto, pero
--      conviene que sea una decision y no una sorpresa.
--
-- Y ademas comprobado sobre datos, no solo sobre logica: para los 12 usuarios
-- reales x las 3 cuentas con ventas, 0 casos en que la expresion de escritura
-- concediera una fila que la de lectura no concediera.
--
-- LO QUE NO SE HACE
-- Solo sale. Las mismas parejas *_read / *_write FOR ALL existen en menu_item,
-- menu_item_override, sales_channel y channel_rate y la demostracion vale igual,
-- pero son tablas pequenas: una tabla, una medicion, una conclusion.

begin;

-- El WITH CHECK de sale_write era EXPLICITO (no heredado del USING): se
-- conserva tal cual en insert y update, o el INSERT dejaria de validarse.
drop policy sale_write on public.sale;

create policy sale_insert on public.sale
  for insert to authenticated
  with check (current_user_is_admin_of(account_id));

create policy sale_update on public.sale
  for update to authenticated
  using (current_user_is_admin_of(account_id))
  with check (current_user_is_admin_of(account_id));

create policy sale_delete on public.sale
  for delete to authenticated
  using (current_user_is_admin_of(account_id));

commit;
