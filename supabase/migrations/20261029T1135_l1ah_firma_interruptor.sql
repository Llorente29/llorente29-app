-- supabase/migrations/20261029T1135_l1ah_firma_interruptor.sql
--
-- L1a-H (29/10/2026) · La firma del registro, solo cuando la empresa la
-- encienda. SOLO AÑADE y se puede pasar dos veces.
--
-- Desde el #370 el portal pide a todas las personas que firmen su registro del
-- mes. En Foodint las horas aún no están controladas, y Julio quiere que no
-- salga hasta que él lo decida. Esto añade:
--
--   1. accounts.firma_registro_mes: «Pedir a cada persona que firme su registro
--      del mes». Admite nulos, sin valor por defecto: NULL o false = apagado.
--      Así TODAS las cuentas quedan apagadas sin tocar ninguna fila, Foodint
--      incluida. Las firmas ya hechas (registro_jornada_firma) no se tocan.
--   2. Su lectura con la sesión, según la regla de la 0731: grant select de la
--      columna a authenticated y anon. (accounts tiene hoy SELECT de tabla, así
--      que ya se podría leer; el grant deja dicho que esta columna se lee a
--      propósito, también desde el portal del trabajador, y la protege si un día
--      se cierra la tabla como employees.)
--   3. firma_registro_mes_pedir(cuenta, encender): la escribe el administrador
--      de ESA cuenta (en accounts solo escribe el de plataforma). Devuelve cómo
--      queda y a cuántas personas activas afecta, para que la pantalla lo diga
--      (regla 8).
--
-- ¿Por qué no en app_settings, que ya tiene ajustes del fichaje? Porque es una
-- sola fila para todo el sistema: CHECK (scope = 'global') e índice único
-- sobre scope. No puede guardar un ajuste por empresa.
--
-- Vuelta atrás: supabase/vuelta-atras/20261029T1135_l1ah_firma_interruptor.down.sql

alter table public.accounts add column if not exists firma_registro_mes boolean;

comment on column public.accounts.firma_registro_mes is
  'L1a-H (29/10/2026). «Pedir a cada persona que firme su registro del mes» en su portal. NULL o false: apagado (no sale la tarjeta de la firma ni ningún aviso de firma). Lo cambia el administrador de la cuenta con firma_registro_mes_pedir. Las firmas ya hechas no dependen de esto.';

grant select (firma_registro_mes) on public.accounts to authenticated, anon;

create or replace function public.firma_registro_mes_pedir(p_account_id uuid, p_pedir boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_personas integer;
begin
  if p_account_id is null or p_pedir is null then
    raise exception 'DATOS_INCOMPLETOS' using errcode = '22023', hint = 'Falta la empresa o si se enciende o se apaga.';
  end if;
  if not public.current_user_is_admin_of(p_account_id) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501', hint = 'Solo el administrador de la empresa puede encender o apagar la firma del registro.';
  end if;
  update public.accounts set firma_registro_mes = p_pedir where id = p_account_id;
  if not found then
    raise exception 'CUENTA_NO_EXISTE' using errcode = '22023', hint = 'Esa empresa no existe.';
  end if;
  select count(*) into v_personas from public.employees where account_id = p_account_id and active;
  return jsonb_build_object('pedir', p_pedir, 'personas', v_personas);
end $$;

comment on function public.firma_registro_mes_pedir(uuid, boolean) is
  'L1a-H (29/10/2026). Enciende o apaga «Pedir a cada persona que firme su registro del mes» de una cuenta. Solo su administrador. Devuelve {pedir, personas}: las personas activas de la cuenta.';

revoke all on function public.firma_registro_mes_pedir(uuid, boolean) from public, anon;
grant execute on function public.firma_registro_mes_pedir(uuid, boolean) to authenticated;
