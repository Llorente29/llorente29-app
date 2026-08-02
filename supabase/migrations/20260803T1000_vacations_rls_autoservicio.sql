-- Arreglo de permisos (RLS) de `vacations` — bug en producción cazado por
-- Julio (02/08): "new row violates row-level security policy for table
-- 'vacations'" al solicitar una ausencia.
--
-- DIAGNÓSTICO (verificado contra código vivo, no supuesto):
--   - MisVacaciones.tsx → vacationsService.requestVacation() hace
--     supabase.from('vacations').insert(...) DIRECTO desde el cliente
--     (sin RPC). Sujeto por tanto a RLS tal cual.
--   - El policy "vacations_write" (este mismo fichero base:
--     00000000000000_baseline.sql:7085-7091) es FOR ALL y exige
--     current_user_is_admin_of(l.account_id) — que exige role='admin' PURO
--     (baseline.sql:296-308). Un trabajador (role='worker') no lo cumple.
--     TAMPOCO lo cumple un manager (role='manager') — el bug bloqueaba a
--     Pamela igual que a cualquier trabajador.
--   - Vínculo usuario↔empleado confirmado: user_profiles.user_id→auth.users,
--     user_profiles.employee_id→employees. NO hay vínculo por username/email.
--
-- MODELO APROBADO (Julio, 02/08 — referencia 7shifts/Workforce; ajustado
-- 03/08 para restringir al manager a su(s) local(es), no toda la cuenta):
--   CREAR      → el trabajador para SÍ MISMO, o admin de la cuenta, o
--               manager DEL LOCAL del empleado de la ausencia.
--   EDITAR/BORRAR, solicitud PENDIENTE (status='solicitada') → el propio
--               trabajador (la suya), admin de la cuenta, o manager de ese local.
--   APROBAR/RECHAZAR (cambiar status a aprobada/rechazada) → SOLO admin de
--               la cuenta o manager de ese local. El trabajador nunca.
--   EDITAR/BORRAR, solicitud YA resuelta (aprobada/rechazada) → SOLO admin
--               de la cuenta o manager de ese local.
--   Alcance: el ADMIN mantiene alcance de TODA LA CUENTA (todos los
--   locales). El MANAGER se restringe a los locales que gestiona.
--
-- RECON hecho antes de escribir el SQL (no se asume nada):
--   - vacations.status: columna real, valores 'solicitada'|'aprobada'|
--     'rechazada'|'cancelada' (CHECK constraint vacations_status_check,
--     baseline.sql:3937/3947). "Pendiente" = status='solicitada'.
--   - vacationsService.cancelVacation() (llamada por el propio trabajador
--     desde MisVacaciones.tsx:96, botón "Cancelar" de SU solicitud
--     pendiente) hace UPDATE ... SET status='cancelada' — es decir, el
--     autoservicio del trabajador SÍ necesita poder mover el status FUERA
--     de 'solicitada', pero solo hacia 'cancelada', nunca hacia
--     'aprobada'/'rechazada'. Contemplado abajo explícitamente (si no, este
--     fix rompería "Cancelar").
--   - Vínculo manager↔local(es) CONFIRMADO: tabla "manager_locations"
--     (baseline.sql:3174-3179), bridge N:M — "user_profile_id" (FK
--     user_profiles.id) + "location_id" (FK locations.id), UNIQUE(ambas).
--     Poblada/gestionada por userManagementService.ts
--     (updateManagerLocations, "managedLocationIds" en UsuariosAccesosPage.tsx)
--     — confirmado que un manager PUEDE tener varios locales asignados
--     (la UI reemplaza la lista completa, no un único valor). Esto es
--     DISTINTO de employees.assigned_locations ("dónde puede fichar" el
--     empleado, un concepto de clocking, no de gestión) — no confundir.
--     Ningún user_profiles.location_id existe ni hace falta: el vínculo
--     vive enteramente en manager_locations.
--   - No existe ningún helper "current_user_manages_location" ni
--     "current_user_location_ids" (grep completo de supabase/migrations —
--     cero resultados). Se crea uno nuevo, mismo idioma que el resto de
--     helpers de este proyecto (SQL, STABLE, SECURITY DEFINER).
--   - current_user_is_admin_of(uuid) confirmado (baseline.sql:296-308): YA
--     incluye el bypass de current_user_is_admin() internamente — no hace
--     falta combinarlo aparte (a diferencia de current_user_is_admin_or_manager_of,
--     que NO lo incluye). Por eso el admin usa solo current_user_is_admin_of
--     y el manager pasa a su propio helper de local, sin la rama de cuenta
--     completa que daba current_user_is_admin_or_manager_of.
--   - No existe helper "usuario actual = este empleado". Se crea
--     current_user_is_employee, mismo patrón ya probado en producción de
--     can_operate_manual_count (20260801T1600_inventory_count_permisos_c3.sql:53-58):
--     resolver user_profiles.employee_id del actor vía auth.uid()+account_id
--     y compararlo con el employee_id de la fila.
--
-- DECISIÓN DE DISEÑO (resuelve el punto abierto del encargo §3): TODO por
-- RLS, sin RPC nueva de aprobación. El candado anti-autoaprobación no
-- necesita comparar OLD vs NEW: en UPDATE, USING ve la fila ANTES del
-- cambio (así que un trabajador solo puede tocar una fila que YA esté
-- 'solicitada') y WITH CHECK ve la fila DESPUÉS del cambio (así que, si
-- quien escribe no es admin/manager, el resultado debe seguir en
-- 'solicitada' o pasar a 'cancelada' — nunca a 'aprobada'/'rechazada').
-- Eso ya impide la autoaprobación sin necesitar SECURITY DEFINER adicional.
-- MisVacaciones.tsx / vacationsService.ts NO necesitan ningún cambio.
--
-- Aplicar por SQL Editor a mano (sin begin/commit). Verificar cada objeto
-- con una query aparte a pg_proc/pg_policies (no fiarse del "Success").
-- NO ejecutar current_user_is_employee()/current_user_manages_location() de
-- prueba en la MISMA transacción que las crea (auth.uid() sale null en el
-- editor → falso negativo).

-- (1) Helper: ¿el usuario actual ES este empleado (de esta cuenta)?
create or replace function public.current_user_is_employee(p_employee_id uuid, p_account_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.user_profiles up
    where up.user_id = auth.uid()
      and up.account_id = p_account_id
      and up.employee_id = p_employee_id
      and up.active = true
  );
$$;

-- (2) Helper: ¿el usuario actual es MANAGER (rol) y gestiona este local
-- concreto (vía manager_locations)? No hace falta parámetro de cuenta: un
-- local pertenece a una única cuenta, así que acotar por location_id ya
-- acota la cuenta — y manager_locations solo puede haberse poblado por un
-- admin de esa misma cuenta (manager_locations_write lo exige).
create or replace function public.current_user_manages_location(p_location_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1
    from public.manager_locations ml
    join public.user_profiles up on up.id = ml.user_profile_id
    where up.user_id = auth.uid()
      and up.role = 'manager'
      and up.active = true
      and ml.location_id = p_location_id
  );
$$;

-- (3) Fuera el policy FOR ALL viejo (mezclaba INSERT/UPDATE/DELETE con una
-- regla que solo cumplía un admin puro, y daba alcance de cuenta completa
-- al manager en vez de restringirlo a su(s) local(es)).
drop policy if exists "vacations_write" on public.vacations;

-- (4) INSERT: admin de la cuenta, o manager DEL LOCAL de ese empleado, o el
-- propio trabajador creando SU solicitud — y en ese caso, siempre naciendo
-- 'solicitada' (candado: no se puede insertar ya "aprobada" suplantando la
-- revisión).
create policy "vacations_insert" on public.vacations
  for insert to authenticated
  with check (
    exists (
      select 1 from public.employees e
      join public.locations l on l.id = e.location_id
      where e.id = vacations.employee_id
        and (
          public.current_user_is_admin_of(l.account_id)
          or public.current_user_manages_location(l.id)
          or (
            public.current_user_is_employee(vacations.employee_id, l.account_id)
            and vacations.status = 'solicitada'
          )
        )
    )
  );

-- (5) UPDATE: admin de la cuenta o manager del local, siempre. El
-- trabajador solo puede tocar SU solicitud mientras esté 'solicitada'
-- (USING mira la fila ANTES del cambio), y el resultado debe seguir
-- 'solicitada' (editar fechas/notas) o pasar a 'cancelada' (botón
-- "Cancelar") — nunca 'aprobada'/'rechazada' (WITH CHECK mira la fila
-- DESPUÉS del cambio). Así se impide la autoaprobación sin necesitar
-- comparar OLD vs NEW explícitamente.
create policy "vacations_update" on public.vacations
  for update to authenticated
  using (
    exists (
      select 1 from public.employees e
      join public.locations l on l.id = e.location_id
      where e.id = vacations.employee_id
        and (
          public.current_user_is_admin_of(l.account_id)
          or public.current_user_manages_location(l.id)
          or (
            public.current_user_is_employee(vacations.employee_id, l.account_id)
            and vacations.status = 'solicitada'
          )
        )
    )
  )
  with check (
    exists (
      select 1 from public.employees e
      join public.locations l on l.id = e.location_id
      where e.id = vacations.employee_id
        and (
          public.current_user_is_admin_of(l.account_id)
          or public.current_user_manages_location(l.id)
          or (
            public.current_user_is_employee(vacations.employee_id, l.account_id)
            and vacations.status in ('solicitada', 'cancelada')
          )
        )
    )
  );

-- (6) DELETE: admin de la cuenta o manager del local, siempre. El
-- trabajador solo puede borrar SU solicitud mientras esté 'solicitada' (no
-- hay UI hoy que lo dispare — MisVacaciones.tsx solo cancela — pero el
-- modelo aprobado lo contempla y se deja abierto para cuando exista).
create policy "vacations_delete" on public.vacations
  for delete to authenticated
  using (
    exists (
      select 1 from public.employees e
      join public.locations l on l.id = e.location_id
      where e.id = vacations.employee_id
        and (
          public.current_user_is_admin_of(l.account_id)
          or public.current_user_manages_location(l.id)
          or (
            public.current_user_is_employee(vacations.employee_id, l.account_id)
            and vacations.status = 'solicitada'
          )
        )
    )
  );

-- vacations_read NO se toca (sigue igual, solo lectura por cuenta — sin
-- restricción por local; leer no es la operación sensible aquí).

notify pgrst, 'reload schema';

-- Guard: aborta si algo no quedó como debía.
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'current_user_is_employee') then
    raise exception 'MIGRACIÓN FALLIDA: falta la función current_user_is_employee';
  end if;
  if not exists (select 1 from pg_proc where proname = 'current_user_manages_location') then
    raise exception 'MIGRACIÓN FALLIDA: falta la función current_user_manages_location';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'vacations' and policyname = 'vacations_write'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: vacations_write (el policy viejo) sigue existiendo';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'vacations' and policyname = 'vacations_insert'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: falta el policy vacations_insert';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'vacations' and policyname = 'vacations_update'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: falta el policy vacations_update';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'vacations' and policyname = 'vacations_delete'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: falta el policy vacations_delete';
  end if;
end $$;
