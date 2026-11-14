-- supabase/migrations/20261114T2041_b01r26_enlaces_falsos.sql
--
-- B01r26 (14/11) · LOS ENLACES FALSOS DEL TRASPASO DE OCTUBRE. En el traspaso
-- de octubre a la C0008 (14/11, 19:11–19:49), el «nunca dos veces» encontró en
-- Diez 275 asientos de la serie 4 iguales a los de Sumied (mismo día y mismas
-- líneas) y los ENLAZÓ sin escribir (4/3160 … 4/3692). Diez los tenía en ese
-- momento (el «Cuadra» de las 19:51 los vio), pero después se borraron: hoy la
-- serie 4 de la C0008 acaba en el 4/3154 (30/09), y la lectura
-- octubre-contra-c0008 (diez-lectura.yml, run 43630949713) no encuentra ninguno
-- de los 275 en todo 2026.
--
-- Y 55 que Sumied SÍ escribió por la API en ese traspaso (19:17–19:24) y que Diez
-- tampoco tiene hoy: 42 de la serie 4 (4/3693 … 4/3734) y 13 de la serie 1
-- (1/1953 … 1/1965), en «enviado». Se borraron igual (Julio, 14/11).
--
-- Esos 330 envíos (275 + 55) vuelven a «pendiente», sin la referencia de Diez (ext_*), con
-- la de antes en el motivo: el traspaso los vuelve a llevar («Seguir traspasando
-- octubre», o confirmar de nuevo) y, con la corrección del mismo PR, dentro del
-- traspaso ya no se enlazan con asientos de Diez que no vienen de Sumied.
--
-- LA GUARDA DE SUMIED: tienen que ser exactamente estos 330 —Foodint, de tipo
-- asiento, de 2026, por la conexión de la C0008, uno por documento: los 275
-- «enlazado» de la serie 4 y los 55 «enviado» (42 de la serie 4 y 13 de la 1)—, o
-- no se cambia nada. La factura FV-02931 (2/3365, «enviado») no entra. Este fichero no puede leer Diez: que NINGUNO exista hoy en la
-- C0008 lo dice la lectura, que se repite justo antes del real.
--
-- SIN VUELTA ATRÁS, a propósito: devolverlos a «enlazado» o «enviado» diría que
-- están en Diez y no están. La referencia de antes queda en last_error.
-- Nada en el camino del pedido: external_send no tiene disparadores.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_con constant uuid := '860fcb61-9b95-46da-bc1a-ad73d665f19b';
  v_docs constant int[] := array[
    3160, 3161, 3162, 3163, 3164, 3165, 3405, 3406, 3407, 3408, 3409, 3410, 3411, 3412, 3413, 3414,
    3415, 3416, 3417, 3418, 3419, 3420, 3421, 3422, 3423, 3424, 3425, 3426, 3427, 3428, 3429, 3430,
    3431, 3432, 3433, 3434, 3435, 3436, 3437, 3438, 3439, 3440, 3441, 3443, 3445, 3446, 3447, 3448,
    3449, 3450, 3451, 3452, 3453, 3454, 3455, 3456, 3457, 3458, 3459, 3460, 3461, 3462, 3463, 3464,
    3465, 3466, 3467, 3468, 3469, 3470, 3471, 3472, 3476, 3477, 3478, 3479, 3480, 3481, 3482, 3483,
    3484, 3485, 3486, 3487, 3488, 3489, 3490, 3491, 3492, 3493, 3494, 3495, 3498, 3499, 3500, 3501,
    3502, 3503, 3504, 3508, 3509, 3512, 3513, 3514, 3515, 3516, 3517, 3518, 3519, 3520, 3521, 3522,
    3523, 3524, 3525, 3526, 3527, 3528, 3529, 3530, 3531, 3532, 3535, 3536, 3537, 3538, 3539, 3540,
    3541, 3542, 3543, 3544, 3545, 3546, 3547, 3548, 3549, 3550, 3551, 3552, 3553, 3554, 3555, 3556,
    3557, 3558, 3559, 3560, 3561, 3562, 3563, 3564, 3565, 3566, 3567, 3568, 3569, 3570, 3571, 3572,
    3573, 3577, 3578, 3579, 3580, 3581, 3582, 3583, 3584, 3585, 3586, 3587, 3588, 3589, 3590, 3591,
    3592, 3593, 3594, 3595, 3596, 3597, 3598, 3599, 3600, 3601, 3602, 3603, 3604, 3605, 3606, 3607,
    3608, 3609, 3610, 3611, 3612, 3613, 3614, 3615, 3616, 3617, 3618, 3619, 3620, 3621, 3622, 3623,
    3624, 3625, 3626, 3627, 3628, 3629, 3630, 3631, 3632, 3633, 3634, 3635, 3636, 3637, 3638, 3639,
    3640, 3642, 3643, 3645, 3646, 3647, 3648, 3649, 3650, 3651, 3652, 3653, 3654, 3655, 3656, 3657,
    3658, 3659, 3660, 3661, 3662, 3663, 3664, 3665, 3666, 3667, 3668, 3669, 3670, 3671, 3672, 3673,
    3674, 3675, 3676, 3677, 3678, 3679, 3680, 3681, 3682, 3683, 3684, 3685, 3686, 3687, 3688, 3689,
    3690, 3691, 3692];
  -- Los 55 «enviado» que Sumied escribió y Diez ya no tiene.
  v_env4 constant int[] := array[3693, 3694, 3695, 3696, 3697, 3698, 3699, 3700, 3701, 3702, 3703, 3704, 3705, 3706, 3707, 3708,
    3709, 3710, 3711, 3712, 3713, 3714, 3715, 3716, 3717, 3718, 3719, 3720, 3721, 3722, 3723, 3724, 3725, 3726, 3727, 3728,
    3729, 3730, 3731, 3732, 3733, 3734];
  v_env1 constant int[] := array[1953, 1954, 1955, 1956, 1957, 1958, 1959, 1960, 1961, 1962, 1963, 1964, 1965];
  v_n int; v_hay int; v_hay_env int; v_hoy constant text := to_char(now() at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI');
begin
  if not exists (select 1 from public.company where id = v_e and account_id = v_acc) then
    raise notice 'B01r26: sin la empresa de Foodint (staging), no hay enlaces que deshacer.';
    return;
  end if;
  if cardinality(v_docs) <> 275 or (select count(distinct d) from unnest(v_docs) d) <> 275 then
    raise exception 'B01r26: la lista tiene que ser de 275 documentos distintos.';
  end if;

  select count(*) into v_hay
    from public.external_send s
   where s.company_id = v_e and s.account_id = v_acc and s.status = 'enlazado' and s.kind = 'asiento'
     and s.ext_year = '2026' and s.ext_series = '4' and s.account_connector_id = v_con
     and s.ext_number = any (v_docs);
  if cardinality(v_env4) <> 42 or cardinality(v_env1) <> 13 then
    raise exception 'B01r26: las listas de los «enviado» tienen que ser de 42 (serie 4) y 13 (serie 1).';
  end if;
  select count(*) into v_hay_env
    from public.external_send s
   where s.company_id = v_e and s.account_id = v_acc and s.status = 'enviado' and s.kind = 'asiento'
     and s.ext_year = '2026' and s.account_connector_id = v_con
     and ((s.ext_series = '4' and s.ext_number = any (v_env4)) or (s.ext_series = '1' and s.ext_number = any (v_env1)));
  if v_hay <> 275 or v_hay_env <> 55 then
    raise exception 'B01r26: se esperaban 275 «enlazado» de la serie 4 y 55 «enviado» (42 de la serie 4 y 13 de la 1) de Foodint con esos documentos; hay % y %. No se cambia nada: vuelve a medir.', v_hay, v_hay_env;
  end if;

  update public.external_send s
     set status = 'pendiente', next_try_at = null, sent_at = null, updated_at = now(),
         last_error = format('Enlace falso: Diez (C0008) no tiene el asiento %s/%s/%s (lectura octubre-contra-c0008, %s). Vuelve al traspaso de octubre (B01r26).',
                             s.ext_year, s.ext_series, s.ext_number, v_hoy),
         ext_year = null, ext_series = null, ext_number = null
   where s.company_id = v_e and s.account_id = v_acc and s.status = 'enlazado' and s.kind = 'asiento'
     and s.ext_year = '2026' and s.ext_series = '4' and s.account_connector_id = v_con
     and s.ext_number = any (v_docs);
  get diagnostics v_n = row_count;
  if v_n <> 275 then raise exception 'B01r26: se han cambiado % enlaces y tenían que ser 275.', v_n; end if;

  update public.external_send s
     set status = 'pendiente', next_try_at = null, sent_at = null, updated_at = now(),
         last_error = format('Ya no está en Diez: la C0008 no tiene el asiento %s/%s/%s, que Sumied escribió y se borró después (lectura octubre-contra-c0008, %s). Vuelve al traspaso de octubre (B01r26).',
                             s.ext_year, s.ext_series, s.ext_number, v_hoy),
         ext_year = null, ext_series = null, ext_number = null
   where s.company_id = v_e and s.account_id = v_acc and s.status = 'enviado' and s.kind = 'asiento'
     and s.ext_year = '2026' and s.account_connector_id = v_con
     and ((s.ext_series = '4' and s.ext_number = any (v_env4)) or (s.ext_series = '1' and s.ext_number = any (v_env1)));
  get diagnostics v_n = row_count;
  if v_n <> 55 then raise exception 'B01r26: se han cambiado % «enviado» y tenían que ser 55.', v_n; end if;
  raise notice 'B01r26: 275 enlaces falsos y 55 envíos borrados en Diez: los 330 vuelven a «pendiente».';
end $$;
