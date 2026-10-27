-- supabase/migrations/20261027T1215_l00_datos_de_los_trabajadores.sql
--
-- L00 · Respuesta 1 · Cerrar los datos de los trabajadores (27/10/2026).
-- La auditoría L0 (docs/laboral/l0/auditoria.md, §6) encontró, y Julio lo ha
-- comprobado en producción:
--   · el almacén employee-documents (contratos y nóminas en PDF) es público, con
--     la política anon_all_employee_documents (ALL, rol public): cualquiera, sin
--     sesión, lee, sube, cambia y borra;
--   · employees_read, clock_entries_read, payroll_cost_read (y las demás de
--     personal) dejan leer toda la cuenta a cualquiera de la cuenta, también a
--     un trabajador: salario, DNI, PIN, GPS, nóminas y bajas de los compañeros;
--   · clock_entries_insert no tiene condición: cualquiera de la cuenta ficha por
--     otro, con la hora que quiera, y sin rastro.
--
-- Quién es quién, en la base:
--   · «ve toda la cuenta» = current_user_is_admin_or_manager_of(cuenta): el
--     administrador, el encargado (role manager) y la plataforma. Siguen viendo
--     lo que ven hoy.
--   · el trabajador = current_user_is_employee(empleado, cuenta): lo suyo.
--
-- Lo que hace, por partes:
--   1. El almacén: privado; fuera anon_all; lee el administrador o el encargado
--      de la cuenta, y el trabajador lo suyo; sube, cambia y borra solo el
--      administrador (las funciones de nóminas entran con la clave de servicio,
--      que no pasa por estas políticas). El front pide enlaces firmados de 5 min.
--   2. Las lecturas, por persona: employees, clock_entries, vacations,
--      payroll_cost, documents, clock_entry_audit, clock_correction_request,
--      employee_notifications y monthly_balance_closures. payroll_inbox (lleva el
--      DNI leído), solo el administrador o el encargado.
--   3. De los compañeros, solo nombre, foto y puesto: companeros_de_trabajo(),
--      de servidor, para los cambios de turno.
--   4. Fichar: el trabajador, solo para sí y con la hora del servidor; para otra
--      persona, solo el encargado o el administrador. Y TODA marca nueva deja
--      rastro en clock_entry_audit (acción «create»): quién, cuándo, por qué y
--      por qué vía. Las de add_manual_clock_entry y las peticiones aprobadas ya
--      dejan su «create_manual»: esas no se duplican.
--   5. El PIN del kiosko deja de estar en employees: va a employee_kiosk_pin,
--      que el cliente no puede leer (sin políticas y sin permisos), y la tablet
--      lo comprueba en el servidor (kiosko_comprobar_pin). Quien guarde un PIN en
--      employees.pin (la ficha, manage-employee) lo sigue haciendo: el
--      disparador lo pasa a la tabla y lo vacía. No va cifrado A PROPÓSITO: así
--      la vuelta atrás lo puede devolver a employees. Cifrarlo (bcrypt) es el
--      paso siguiente, en su propia tanda, cuando esta lleve días en verde.
--   6. employee_clock_status (el estado de fichaje de una persona) pasa a pedir
--      que seas tú o el administrador o el encargado.
--   7. Cuatro funciones de servidor sin guarda, que nadie llama desde el front ni
--      desde otra función expuesta, dejan de poder llamarse con sesión:
--      migrate_locations_and_staff (copiaba locales y personal de cualquier
--      cuenta a otra), location_labor_cost y location_economics (la suma de
--      salarios de cualquier local) y close_month_balance (escribía cierres en
--      cualquier cuenta). El servidor (service_role) las sigue pudiendo llamar.
--
-- Datos que toca (por eso lleva autorizo): el almacén pasa a privado
-- (storage.buckets) y los PIN pasan de employees.pin a employee_kiosk_pin
-- (employees.pin queda vacío). No borra ningún fichero ni ninguna fila.
--
-- Orden: se aplica ANTES de que llegue el front. Con el front de antes:
--   · la ficha y el portal abren los PDF con enlace público: dejan de abrir hasta
--     que llegue el front nuevo (enlaces firmados);
--   · el kiosko dice «no tiene PIN» hasta el front nuevo (comprueba en el servidor);
--   · el trabajador ve en los cambios de turno solo su nombre hasta el front
--     nuevo (companeros_de_trabajo).
-- Fichar, desde el móvil y desde el kiosko, sigue igual con los dos fronts.
--
-- Ninguna tabla ni función de esta migración está en el camino del pedido.
--
-- cambia: public.employees · prueba: supabase/staging/sql/20261027_l00_datos_de_los_trabajadores_prueba.sql
-- cambia: public.clock_entries · prueba: supabase/staging/sql/20261027_l00_datos_de_los_trabajadores_prueba.sql
-- cambia: public.vacations · prueba: supabase/staging/sql/20261027_l00_datos_de_los_trabajadores_prueba.sql
-- cambia: public.payroll_cost · prueba: supabase/staging/sql/20261027_l00_datos_de_los_trabajadores_prueba.sql
-- cambia: public.payroll_inbox · prueba: supabase/staging/sql/20261027_l00_datos_de_los_trabajadores_prueba.sql
-- cambia: public.documents · prueba: supabase/staging/sql/20261027_l00_datos_de_los_trabajadores_prueba.sql
-- cambia: public.clock_entry_audit · prueba: supabase/staging/sql/20261027_l00_datos_de_los_trabajadores_prueba.sql
-- cambia: public.clock_correction_request · prueba: supabase/staging/sql/20261027_l00_datos_de_los_trabajadores_prueba.sql
-- cambia: public.employee_notifications · prueba: supabase/staging/sql/20261027_l00_datos_de_los_trabajadores_prueba.sql
-- cambia: public.monthly_balance_closures · prueba: supabase/staging/sql/20261027_l00_datos_de_los_trabajadores_prueba.sql
-- cambia: storage.objects · prueba: supabase/staging/sql/20261027_l00_datos_de_los_trabajadores_prueba.sql
-- cambia: storage.buckets · prueba: supabase/staging/sql/20261027_l00_datos_de_los_trabajadores_prueba.sql
-- cambia: public.employee_clock_status · prueba: supabase/staging/sql/20261027_l00_datos_de_los_trabajadores_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261027T1215_l00_datos_de_los_trabajadores.down.sql

-- ── 1 · El almacén de los contratos y las nóminas ───────────────────────────
-- Quién puede, según la ruta: «<empleado>/…» o «_inbox/<cuenta>/…».
create or replace function public._documento_trabajador_puede(p_name text, p_escribir boolean)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_partes text[] := storage.foldername(p_name); v_uno text; v_dos text; v_emp uuid; v_cuenta uuid;
begin
  v_uno := v_partes[1]; v_dos := v_partes[2];
  if v_uno = '_inbox' then
    if v_dos is null or v_dos !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return public.current_user_is_admin(); end if;
    v_cuenta := v_dos::uuid;
    return case when p_escribir then public.current_user_is_admin_of(v_cuenta) else public.current_user_is_admin_or_manager_of(v_cuenta) end;
  end if;
  if v_uno is null or v_uno !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return public.current_user_is_admin(); end if;
  v_emp := v_uno::uuid;
  select e.account_id into v_cuenta from public.employees e where e.id = v_emp;
  if v_cuenta is null then return public.current_user_is_admin(); end if;
  if p_escribir then return public.current_user_is_admin_of(v_cuenta); end if;
  return public.current_user_is_admin_or_manager_of(v_cuenta) or public.current_user_is_employee(v_emp, v_cuenta);
end $$;
revoke all on function public._documento_trabajador_puede(text, boolean) from public, anon;
grant execute on function public._documento_trabajador_puede(text, boolean) to authenticated;

update storage.buckets set public = false where id = 'employee-documents';
drop policy if exists anon_all_employee_documents on storage.objects;
create policy employee_documents_leer on storage.objects for select to authenticated
  using (bucket_id = 'employee-documents' and public._documento_trabajador_puede(name, false));
create policy employee_documents_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'employee-documents' and public._documento_trabajador_puede(name, true));
create policy employee_documents_cambiar on storage.objects for update to authenticated
  using (bucket_id = 'employee-documents' and public._documento_trabajador_puede(name, true))
  with check (bucket_id = 'employee-documents' and public._documento_trabajador_puede(name, true));
create policy employee_documents_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'employee-documents' and public._documento_trabajador_puede(name, true));

-- ── 2 · Las lecturas, por persona ───────────────────────────────────────────
drop policy employees_read on public.employees;
create policy employees_read on public.employees for select to authenticated
  using (public.current_user_is_admin_or_manager_of(account_id) or public.current_user_is_employee(id, account_id));

drop policy clock_entries_read on public.clock_entries;
create policy clock_entries_read on public.clock_entries for select to authenticated
  using (public.current_user_is_admin_or_manager_of(account_id) or public.current_user_is_employee(employee_id, account_id));

drop policy clock_entries_insert on public.clock_entries;
create policy clock_entries_insert on public.clock_entries for insert to authenticated
  with check (public.current_user_is_admin_or_manager_of(account_id) or public.current_user_is_employee(employee_id, account_id));

drop policy vacations_read on public.vacations;
create policy vacations_read on public.vacations for select to authenticated
  using (public.current_user_is_admin_or_manager_of(account_id) or public.current_user_is_employee(employee_id, account_id));

drop policy payroll_cost_read on public.payroll_cost;
create policy payroll_cost_read on public.payroll_cost for select
  using (public.current_user_is_admin_or_manager_of(account_id) or public.current_user_is_employee(employee_id, account_id));

drop policy payroll_inbox_read on public.payroll_inbox;
create policy payroll_inbox_read on public.payroll_inbox for select
  using (public.current_user_is_admin_or_manager_of(account_id));

drop policy documents_read on public.documents;
create policy documents_read on public.documents for select to authenticated
  using (exists (select 1 from public.employees e
                  where e.id = documents.employee_id
                    and (public.current_user_is_admin_or_manager_of(e.account_id) or public.current_user_is_employee(e.id, e.account_id))));

drop policy clock_audit_read on public.clock_entry_audit;
create policy clock_audit_read on public.clock_entry_audit for select
  using (public.current_user_is_admin_or_manager_of(account_id)
         or (employee_id is not null and public.current_user_is_employee(employee_id, account_id)));

drop policy clock_req_read on public.clock_correction_request;
create policy clock_req_read on public.clock_correction_request for select
  using (public.current_user_is_admin_or_manager_of(account_id)
         or public.current_user_is_employee(employee_id, account_id)
         or public.current_user_is_employee(requested_by_employee_id, account_id));

drop policy employee_notifications_read on public.employee_notifications;
create policy employee_notifications_read on public.employee_notifications for select to authenticated
  using (public.current_user_is_admin_or_manager_of(account_id)
         or public.current_user_is_employee(employee_id, account_id)
         or (sender_employee_id is not null and public.current_user_is_employee(sender_employee_id, account_id)));

drop policy monthly_balance_closures_read on public.monthly_balance_closures;
create policy monthly_balance_closures_read on public.monthly_balance_closures for select
  using (public.current_user_is_admin_or_manager_of(account_id) or public.current_user_is_employee(employee_id, account_id));

-- ── 3 · De los compañeros, solo nombre, foto y puesto ───────────────────────
-- Para los cambios de turno del portal. El administrador o el encargado ven a
-- todos los de su cuenta; el trabajador, a los que comparten local con él.
create or replace function public.companeros_de_trabajo(p_location_ids uuid[] default null)
returns table (id uuid, name text, photo text, "position" text, location_id uuid, assigned_locations uuid[], active boolean)
language sql stable security definer set search_path = public as $$
  with mias as (
    select e.account_id, array_remove(array[e.location_id] || coalesce(e.assigned_locations, '{}'::uuid[]), null) locales
      from public.user_profiles up join public.employees e on e.id = up.employee_id
     where up.user_id = auth.uid() and up.active and up.account_id = e.account_id
  )
  select e.id, e.name, e.photo, e."position", e.location_id, e.assigned_locations, e.active
    from public.employees e
   where e.account_id = any (public.current_user_account_ids())
     and (p_location_ids is null or e.location_id = any (p_location_ids) or coalesce(e.assigned_locations, '{}'::uuid[]) && p_location_ids)
     and (public.current_user_is_admin_or_manager_of(e.account_id)
          or exists (select 1 from mias m
                      where m.account_id = e.account_id
                        and (e.location_id = any (m.locales) or coalesce(e.assigned_locations, '{}'::uuid[]) && m.locales)))
   order by e.name
$$;
revoke all on function public.companeros_de_trabajo(uuid[]) from public, anon;
grant execute on function public.companeros_de_trabajo(uuid[]) to authenticated;

-- ── 4 · Fichar: quién, a qué hora, y siempre con rastro ─────────────────────
-- Antes que los demás disparadores (por nombre: trg_clock_a… va primero), para
-- que el orden y el doble toque miren ya la hora del servidor.
create or replace function public._clock_entry_quien_y_hora()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  -- El servidor (funciones con la clave de servicio, SQL) no pasa por aquí.
  if auth.uid() is null then return new; end if;
  v_cuenta := coalesce(new.account_id, (select e.account_id from public.employees e where e.id = new.employee_id));
  -- El administrador y el encargado pueden poner una marca a otra persona
  -- (kiosko, ficha, correcciones): deja rastro en la auditoría (abajo).
  if public.current_user_is_admin_or_manager_of(v_cuenta) then return new; end if;
  -- El trabajador, solo para sí mismo.
  if not public.current_user_is_employee(new.employee_id, v_cuenta) then
    raise exception 'NO_AUTORIZADO: solo puedes fichar por ti'
      using hint = 'Solo puedes fichar por ti. Si hay que corregir el fichaje de otra persona, lo hace el encargado.', errcode = '42501';
  end if;
  if coalesce(new.source, '') = 'manual' then
    raise exception 'NO_AUTORIZADO: una marca puesta a mano la pone el encargado'
      using hint = 'Para corregir un fichaje, pide la corrección desde «Mis fichajes».', errcode = '42501';
  end if;
  -- La hora es la del servidor. La «efectiva» (redondeada al turno) se respeta
  -- solo si cae a menos de 30 min de ahora; si no, también es la del servidor.
  new.real_datetime := now();
  if new.datetime is null or abs(extract(epoch from (new.datetime - now()))) > 1800 then
    new.datetime := now();
  end if;
  return new;
end $$;
revoke all on function public._clock_entry_quien_y_hora() from public, anon, authenticated;

drop trigger if exists trg_clock_a_quien_y_hora on public.clock_entries;
create trigger trg_clock_a_quien_y_hora before insert on public.clock_entries
  for each row execute function public._clock_entry_quien_y_hora();

-- La auditoría admite el alta («create»).
alter table public.clock_entry_audit drop constraint clock_entry_audit_action_check;
alter table public.clock_entry_audit add constraint clock_entry_audit_action_check
  check (action = any (array['create'::text, 'create_manual'::text, 'edit'::text, 'void'::text, 'restore'::text, 'request'::text, 'approve'::text, 'reject'::text]));

-- Al cerrar la transacción (disparador diferido), si nadie ha dejado ya su
-- «create_manual» para esta marca, se apunta el alta.
create or replace function public._clock_entry_audit_alta()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_up public.user_profiles; v_propia boolean; v_motivo text;
begin
  if exists (select 1 from public.clock_entry_audit a where a.clock_entry_id = new.id and a.action in ('create', 'create_manual')) then
    return null;
  end if;
  if auth.uid() is not null then
    select * into v_up from public.user_profiles up
     where up.user_id = auth.uid() and up.account_id = new.account_id and up.active
     order by (up.employee_id = new.employee_id) desc nulls last limit 1;
  end if;
  v_propia := v_up.employee_id is not null and v_up.employee_id = new.employee_id;
  v_motivo := case
    when auth.uid() is null then 'Alta desde el servidor'
    when v_propia then 'Fichaje propio'
    else coalesce(nullif(current_setting('app.clock_edit_reason', true), ''), nullif(new.address, ''), 'Marca para otra persona, sin motivo escrito')
  end;
  insert into public.clock_entry_audit (clock_entry_id, employee_id, account_id, action, actor_user_id, actor_employee_id, actor_label, reason, before, after)
  values (new.id, new.employee_id, new.account_id, 'create', auth.uid(), v_up.employee_id,
          coalesce(v_up.role, case when auth.uid() is null then 'servidor' else 'sin perfil' end),
          v_motivo, null,
          public._clock_snapshot(new) || jsonb_build_object(
            'via', coalesce(new.source, 'sin origen'),
            'para_otra_persona', not v_propia,
            'hora_servidor', now()));
  return null;
end $$;
revoke all on function public._clock_entry_audit_alta() from public, anon, authenticated;

drop trigger if exists clock_entry_audit_alta on public.clock_entries;
create constraint trigger clock_entry_audit_alta after insert on public.clock_entries
  deferrable initially deferred for each row execute function public._clock_entry_audit_alta();

-- ── 5 · El PIN del kiosko, fuera del alcance del cliente ────────────────────
create table if not exists public.employee_kiosk_pin (
  employee_id uuid primary key references public.employees(id) on delete cascade deferrable initially deferred,
  pin         text not null,
  updated_at  timestamptz not null default now()
);
comment on table public.employee_kiosk_pin is
  'L00 (27/10/2026). El PIN del kiosko de cada persona. Sin políticas ni permisos: el cliente no lo lee. Se comprueba en el servidor con kiosko_comprobar_pin. Sin cifrar a propósito (la vuelta atrás lo devuelve a employees); cifrarlo es el paso siguiente.';
alter table public.employee_kiosk_pin enable row level security;
revoke all on public.employee_kiosk_pin from anon, authenticated;

insert into public.employee_kiosk_pin (employee_id, pin)
select e.id, btrim(e.pin)
  from public.employees e
 where nullif(btrim(e.pin), '') is not null
on conflict (employee_id) do nothing;

-- Quien escriba un PIN en employees.pin (la ficha, manage-employee) lo sigue
-- haciendo: pasa aquí a employee_kiosk_pin y employees.pin se queda vacío. Un PIN vacío no borra
-- el que había (la ficha guarda todos los campos y el PIN ya no lo ve).
create or replace function public._employee_pin_guardar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if nullif(btrim(new.pin), '') is not null then
    insert into public.employee_kiosk_pin (employee_id, pin, updated_at)
    values (new.id, btrim(new.pin), now())
    on conflict (employee_id) do update set pin = excluded.pin, updated_at = now();
  end if;
  new.pin := null;
  return new;
end $$;
revoke all on function public._employee_pin_guardar() from public, anon, authenticated;

drop trigger if exists trg_employee_pin_guardar on public.employees;
create trigger trg_employee_pin_guardar before insert or update of pin on public.employees
  for each row execute function public._employee_pin_guardar();

update public.employees set pin = null where pin is not null;

-- La tablet comprueba el PIN aquí. Solo el administrador o el encargado (la
-- sesión del kiosko) y solo de su cuenta.
create or replace function public.kiosko_comprobar_pin(p_employee_id uuid, p_pin text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid; v_pin text;
begin
  select e.account_id into v_cuenta from public.employees e where e.id = p_employee_id;
  if v_cuenta is null or not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501';
  end if;
  select k.pin into v_pin from public.employee_kiosk_pin k where k.employee_id = p_employee_id;
  return v_pin is not null and v_pin = btrim(coalesce(p_pin, ''));
end $$;
revoke all on function public.kiosko_comprobar_pin(uuid, text) from public, anon;
grant execute on function public.kiosko_comprobar_pin(uuid, text) to authenticated;

-- Quién tiene PIN (para el kiosko y la ficha), sin el PIN.
create or replace function public.kiosko_con_pin(p_employee_ids uuid[])
returns setof uuid language sql stable security definer set search_path = public as $$
  select k.employee_id from public.employee_kiosk_pin k join public.employees e on e.id = k.employee_id
   where k.employee_id = any (p_employee_ids) and public.current_user_is_admin_or_manager_of(e.account_id)
$$;
revoke all on function public.kiosko_con_pin(uuid[]) from public, anon;
grant execute on function public.kiosko_con_pin(uuid[]) to authenticated;

-- ── 6 · El estado de fichaje: tú, o el administrador o el encargado ─────────
select public._respaldar_funcion('public.employee_clock_status(uuid)', '20261027T1215_l00_datos_de_los_trabajadores');
create or replace function public.employee_clock_status(p_employee_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_acct      uuid;
  v_last      clock_entries;
  v_estado    text;
  v_since     timestamptz;
  v_hoy_ini   timestamptz;
  v_min_hoy   numeric := 0;
  v_abierta   timestamptz;
  r           record;
  v_ini       timestamptz := null;
begin
  v_acct := public._account_of_employee(p_employee_id);
  if v_acct is null then
    raise exception 'employee_clock_status: empleado % no encontrado', p_employee_id;
  end if;
  -- L00 (27/10/2026): antes bastaba con ser de la cuenta. Ahora, tú mismo, o el
  -- administrador o el encargado de la cuenta.
  if not (public.current_user_is_admin_or_manager_of(v_acct) or public.current_user_is_employee(p_employee_id, v_acct)) then
    raise exception 'employee_clock_status: sin acceso a la cuenta %', v_acct;
  end if;

  select * into v_last
  from clock_entries ce
  where ce.employee_id = p_employee_id and coalesce(ce.voided,false) = false
  order by ce.real_datetime desc, ce.datetime desc
  limit 1;

  -- Dia natural de Madrid, no UTC. El fichaje de las 00:15 de Madrid es de
  -- ayer en UTC, y contarlo como de hoy falsea el dia.
  v_hoy_ini := (date_trunc('day', now() at time zone 'Europe/Madrid')) at time zone 'Europe/Madrid';

  -- Minutos de HOY: pares cerrados + el tramo abierto hasta ahora. Se calcula
  -- con real_datetime, igual que team_worked_shifts, para no dar dos cifras
  -- distintas de las mismas horas.
  for r in
    select ce.type, coalesce(ce.real_datetime, ce.datetime) as rt
    from clock_entries ce
    where ce.employee_id = p_employee_id
      and coalesce(ce.voided,false) = false
      and coalesce(ce.real_datetime, ce.datetime) >= v_hoy_ini
    order by 2 asc
  loop
    if r.type = 'entrada' then
      v_ini := r.rt;
    elsif r.type = 'salida' and v_ini is not null then
      v_min_hoy := v_min_hoy + extract(epoch from (r.rt - v_ini)) / 60.0;
      v_ini := null;
    end if;
  end loop;

  if v_last.id is null then
    v_estado := 'sin_fichajes';
  elsif v_last.type in ('entrada','pausa_inicio','pausa_fin') then
    v_estado := 'trabajando';
    -- Desde cuando: la ULTIMA entrada no anulada (una pausa no reabre jornada).
    -- Se devuelve `datetime`, la hora OFICIAL: es la que ve el trabajador y la
    -- que cita el parte. Enseñar la real descuadraria la ficha con el reloj de
    -- todos los demas en los 68 fichajes que llevan redondeo.
    select ce.datetime into v_since
    from clock_entries ce
    where ce.employee_id = p_employee_id and coalesce(ce.voided,false) = false
      and ce.type = 'entrada'
    order by coalesce(ce.real_datetime, ce.datetime) desc
    limit 1;
    v_abierta := v_since;
    if v_ini is not null then
      v_min_hoy := v_min_hoy + extract(epoch from (now() - v_ini)) / 60.0;
    end if;
  else
    v_estado := 'fuera';
    v_since  := v_last.datetime;
  end if;

  -- "Sin fichajes hoy" tambien cuando el ultimo evento es de otro dia y fue
  -- una salida: la ficha no debe decir "Fuera" sin mas si hoy no ha pasado nada.
  if v_estado = 'fuera'
     and coalesce(v_last.real_datetime, v_last.datetime) < v_hoy_ini then
    v_estado := 'sin_fichajes';
  end if;

  return jsonb_build_object(
    'employee_id',    p_employee_id,
    'estado',         v_estado,
    'since',          v_since,
    'abierta_desde',  v_abierta,
    'minutos_hoy',    round(v_min_hoy, 1),
    'ultimo_tipo',    v_last.type,
    'ultimo_at',      v_last.datetime
  );
end;
$function$;

-- ── 7 · Funciones de servidor sin guarda: fuera del alcance de la sesión ────
revoke execute on function public.migrate_locations_and_staff(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.location_labor_cost(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.location_economics(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.close_month_balance(uuid, text, date, date) from public, anon, authenticated;
