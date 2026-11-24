-- supabase/migrations/20261117T2130_r06_formas_de_pago.sql
--
-- R06 · «A qué cuenta va cada forma de pago» (encargo R06, respuesta R05 · 2, 17/11).
--
-- Solo AÑADE: tres funciones nuevas. No cambia ninguna que exista: ni
-- _conta_tpv_propuesta, ni conta_tpv_dias, ni conta_tpv_dia_guardar, ni la
-- tabla conta_tpv_forma_cuenta (que ya se podía escribir por fila desde el R03).
--
--   conta_tpv_formas(empresa, día) → jsonb (solo lee)
--     Las formas de pago de la empresa como las escribe el TPV, cada una con su
--     cuenta (o ninguna: «nueva»), lo que suma en el mes del día de ejemplo y en
--     cuántos días sin validar sale. «Deliverect» no es una cuenta: sale partida
--     por el canal de cada orden (pedidos de Glovo, pedidos de Uber Eats…), como
--     la reparte la propuesta. El día de ejemplo: el pedido, o el último guardado
--     sin validar, o el último.
--   conta_tpv_asiento_ejemplo(día, cuentas) → jsonb (no deja nada escrito)
--     «Cómo queda el asiento de un día», en vivo: el de _conta_tpv_propuesta, con
--     las cuentas que se están eligiendo en pantalla. Las escribe dentro de un
--     bloque que se deshace SIEMPRE (una excepción propia, RR006): lo que se
--     enseña es lo que propondría la base, no una cuenta hecha en el front. Lo
--     que sigue sin cuenta sale con su importe y «sin cuenta».
--   conta_tpv_formas_guardar(empresa, cuentas, quién) → jsonb
--     Guarda a qué cuenta va cada forma (un administrador o un encargado) y dice,
--     con contenido, qué días pasan a «Listo para validar» y cuáles siguen en
--     espera. Vale para los días que aún no están validados: los validados tienen
--     su asiento y no se tocan.
--
-- Se puede pasar dos veces (create or replace, firmas nuevas).
-- Prueba: supabase/staging/sql/20261117_r06_formas_de_pago_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261117T2130_r06_formas_de_pago.down.sql

-- Las formas de pago de un día, como las agrupa la propuesta: Deliverect por el
-- canal de su orden; las demás, juntas (canal nulo). Interna: la usan las tres.
create or replace function public._conta_tpv_formas_de(p_company uuid, p_dias uuid[])
returns table (forma text, canal text, dia_id uuid, importe numeric)
language sql
stable
security definer
set search_path = public
as $function$
  select c.forma,
         case when lower(c.forma) = 'deliverect'
              then coalesce((select d.canal from public.conta_tpv_documento d where d.dia_id = c.dia_id and d.orden = c.orden order by d.numero limit 1), 'local') end,
         c.dia_id, c.importe
    from public.conta_tpv_cobro c
   where c.company_id = p_company and c.dia_id = any (p_dias)
$function$;

-- La cuenta que tiene hoy una forma (con su canal, si es de Deliverect), como la busca la propuesta.
create or replace function public._conta_tpv_cuenta_de(p_company uuid, p_forma text, p_canal text)
returns uuid
language sql
stable
security definer
set search_path = public
as $function$
  select f.company_account_id from public.conta_tpv_forma_cuenta f join public.company_account a on a.id = f.company_account_id and a.company_id = f.company_id
   where f.company_id = p_company and lower(f.forma) = lower(p_forma) and f.canal is not distinct from p_canal and a.status is distinct from 'cerrada'
   limit 1
$function$;

create or replace function public.conta_tpv_formas(p_company uuid, p_dia uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare v_acc uuid; v_ej public.conta_tpv_dia; v_mes date; v_r jsonb;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not (coalesce(auth.role(), '') = 'service_role' or public.belongs_to_account(v_acc)) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  select * into v_ej from public.conta_tpv_dia where id = p_dia and company_id = p_company;
  if v_ej.id is null then
    select * into v_ej from public.conta_tpv_dia where company_id = p_company and account_id = v_acc
     order by (estado = 'guardado') desc, dia desc limit 1;
  end if;
  v_mes := date_trunc('month', coalesce(v_ej.dia, current_date))::date;
  with dias as (
    select id, dia, estado from public.conta_tpv_dia where company_id = p_company and account_id = v_acc
  ), f as (
    select x.forma, x.canal, x.importe, d.dia, d.estado, d.id as dia_id
      from public._conta_tpv_formas_de(p_company, (select array_agg(id) from dias)) x join dias d on d.id = x.dia_id
  ), g as (
    select min(f.forma) as forma, f.canal,
           sum(f.importe) filter (where f.dia >= v_mes and f.dia < (v_mes + interval '1 month')) as en_mes,
           count(distinct f.dia_id) filter (where f.estado = 'guardado') as sin_validar
      from f group by lower(f.forma), f.canal
    union all
    -- Las que tienen cuenta y no salen en ningún día: también se enseñan.
    select k.forma, k.canal, null, 0 from public.conta_tpv_forma_cuenta k
     where k.company_id = p_company and k.account_id = v_acc
       and not exists (select 1 from f where lower(f.forma) = lower(k.forma) and f.canal is not distinct from k.canal)
       and (lower(k.forma) = 'deliverect') = (k.canal is not null)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'forma', g.forma, 'canal', g.canal, 'en_mes', coalesce(g.en_mes, 0), 'dias_sin_validar', g.sin_validar,
           'cuenta_id', a.id, 'cuenta', a.code, 'nombre', a.name, 'nueva', a.id is null)
         order by (lower(g.forma) = 'deliverect'), lower(g.forma), g.canal), '[]'::jsonb) into v_r
    from g left join public.company_account a on a.id = public._conta_tpv_cuenta_de(p_company, g.forma, g.canal);
  return jsonb_build_object('mes', v_mes, 'ejemplo', v_ej.id, 'ejemplo_dia', v_ej.dia, 'formas', v_r);
end
$function$;

create or replace function public.conta_tpv_asiento_ejemplo(p_dia uuid, p_cuentas jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  v_d public.conta_tpv_dia; v_ventas uuid; v_falta record; v_p jsonb; v_lineas jsonb := '[]'::jsonb; v_res jsonb;
  v_sustitutas jsonb := '[]'::jsonb; v_c jsonb; v_cta uuid;
begin
  select * into v_d from public.conta_tpv_dia where id = p_dia;
  if v_d.id is null or not public.belongs_to_account(v_d.account_id) then raise exception 'Ese día no está.' using errcode = 'P0002'; end if;
  if jsonb_typeof(coalesce(p_cuentas, '[]'::jsonb)) <> 'array' then raise exception 'Las cuentas van en una lista.' using errcode = '22023'; end if;
  begin
    -- 1 · Las cuentas que se están eligiendo, como si estuvieran guardadas.
    for v_c in select * from jsonb_array_elements(coalesce(p_cuentas, '[]'::jsonb)) loop
      delete from public.conta_tpv_forma_cuenta
       where company_id = v_d.company_id and lower(forma) = lower(v_c ->> 'forma') and canal is not distinct from nullif(v_c ->> 'canal', '');
      v_cta := nullif(v_c ->> 'cuenta_id', '')::uuid;
      if v_cta is not null then
        if not exists (select 1 from public.company_account where id = v_cta and company_id = v_d.company_id and status is distinct from 'cerrada') then
          raise exception 'La cuenta elegida para «%» no es de esta empresa.', v_c ->> 'forma' using errcode = '22023';
        end if;
        insert into public.conta_tpv_forma_cuenta (account_id, company_id, forma, canal, company_account_id, created_by_name)
        values (v_d.account_id, v_d.company_id, v_c ->> 'forma', nullif(v_c ->> 'canal', ''), v_cta, 'ejemplo');
      end if;
    end loop;
    -- 2 · Lo que sigue sin cuenta: una cuenta cualquiera de la empresa en su lugar, para que la
    --     propuesta lo ponga en su sitio; después se enseña como «sin cuenta».
    select id into v_ventas from public.company_account
     where company_id = v_d.company_id and kind = 'template' and template_code = '700' and status is distinct from 'cerrada' order by code limit 1;
    if v_ventas is not null then
      for v_falta in
        select distinct on (lower(x.forma), x.canal) x.forma, x.canal from public._conta_tpv_formas_de(v_d.company_id, array[p_dia]) x
         where public._conta_tpv_cuenta_de(v_d.company_id, x.forma, x.canal) is null
           and (x.canal is not null or not exists (
             -- Una forma que no es de Deliverect también vale con su cuenta por canal (como en la propuesta): si las tiene todas, no falta.
             select 1 from public.conta_tpv_forma_cuenta k where k.company_id = v_d.company_id and lower(k.forma) = lower(x.forma) and k.canal is not null))
      loop
        insert into public.conta_tpv_forma_cuenta (account_id, company_id, forma, canal, company_account_id, created_by_name)
        values (v_d.account_id, v_d.company_id, v_falta.forma, v_falta.canal, v_ventas, 'ejemplo');
        v_sustitutas := v_sustitutas || jsonb_build_object('forma', lower(v_falta.forma), 'canal', v_falta.canal);
      end loop;
    end if;
    -- 3 · La propuesta de la base, la misma que valida.
    v_p := public._conta_tpv_propuesta(p_dia);
    raise exception using errcode = 'RR006', message = 'deshacer el ejemplo';
  exception when sqlstate 'RR006' then
    null;   -- todo lo de arriba se deshace aquí; v_p y v_sustitutas se quedan
  end;

  if v_p ? 'sin_propuesta' then
    return jsonb_build_object('dia', v_d.dia, 'motivo', v_p ->> 'sin_propuesta', 'lineas', '[]'::jsonb);
  end if;
  select jsonb_agg(
           case when v_sustitutas @> jsonb_build_array(jsonb_build_object('forma', lower(l ->> 'forma'), 'canal', l -> 'canal'))
                then jsonb_build_object('cuenta', null, 'nombre', null, 'sin_cuenta', true, 'forma', l ->> 'forma', 'canal', l -> 'canal',
                                        'debe', (l ->> 'debe')::numeric, 'haber', (l ->> 'haber')::numeric, 'concepto', l ->> 'concepto')
                else jsonb_build_object('cuenta', l ->> 'cuenta', 'sin_cuenta', false, 'forma', l ->> 'forma', 'canal', l -> 'canal', 'tipo', l -> 'tipo',
                                        'nombre', (select a.name from public.company_account a where a.company_id = v_d.company_id and a.code = l ->> 'cuenta'),
                                        'debe', (l ->> 'debe')::numeric, 'haber', (l ->> 'haber')::numeric, 'concepto', l ->> 'concepto') end
           order by o)
    into v_lineas from jsonb_array_elements(v_p -> 'lineas') with ordinality as z(l, o);
  select jsonb_build_object('dia', v_d.dia, 'motivo', null, 'lineas', coalesce(v_lineas, '[]'::jsonb),
           'debe', (select sum((l ->> 'debe')::numeric) from jsonb_array_elements(v_lineas) l),
           'haber', (select sum((l ->> 'haber')::numeric) from jsonb_array_elements(v_lineas) l),
           'sin_cuenta', (select count(*) from jsonb_array_elements(v_lineas) l where (l ->> 'sin_cuenta')::boolean))
    into v_res;
  return v_res;
end
$function$;

create or replace function public.conta_tpv_formas_guardar(p_company uuid, p_cuentas jsonb, p_quien_nombre text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  v_acc uuid; v_c jsonb; v_cta uuid; v_n int := 0; v_dias uuid[]; v_listos text[] := '{}'; v_espera text[] := '{}';
  v_x record; v_quien text; v_hechas text[] := '{}';
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_acc) then
    raise exception 'Solo un administrador o un encargado de la cuenta dice a qué cuenta va cada forma de pago.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_cuentas, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_cuentas) = 0 then
    raise exception 'No hay ninguna cuenta que guardar.' using errcode = '22023';
  end if;
  v_quien := coalesce(nullif(trim(p_quien_nombre), ''), (select display_name from public.user_profiles where user_id = auth.uid() and account_id = v_acc limit 1));
  -- Los días sin validar que estaban en espera antes (para decir cuáles pasan a listos).
  select array_agg(id order by dia) into v_dias from public.conta_tpv_dia
   where company_id = p_company and account_id = v_acc and estado = 'guardado' and public._conta_tpv_propuesta(id) ? 'sin_propuesta';

  for v_c in select * from jsonb_array_elements(p_cuentas) loop
    if coalesce(trim(v_c ->> 'forma'), '') = '' then raise exception 'Falta la forma de pago.' using errcode = '22023'; end if;
    if (lower(v_c ->> 'forma') = 'deliverect') <> (nullif(v_c ->> 'canal', '') is not null) then
      raise exception '«Deliverect» va siempre con su plataforma, y las demás formas de pago sin ella.' using errcode = '22023';
    end if;
    v_cta := nullif(v_c ->> 'cuenta_id', '')::uuid;
    if v_cta is null then
      raise exception 'Falta elegir a qué cuenta va «%»%.', v_c ->> 'forma',
        case when nullif(v_c ->> 'canal', '') is null then '' else ' en los pedidos de ' || (v_c ->> 'canal') end using errcode = '22023';
    end if;
    if not exists (select 1 from public.company_account where id = v_cta and company_id = p_company and status is distinct from 'cerrada') then
      raise exception 'La cuenta elegida para «%» no es de esta empresa, o está cerrada.', v_c ->> 'forma' using errcode = '22023';
    end if;
    delete from public.conta_tpv_forma_cuenta
     where company_id = p_company and lower(forma) = lower(v_c ->> 'forma') and canal is not distinct from nullif(v_c ->> 'canal', '');
    insert into public.conta_tpv_forma_cuenta (account_id, company_id, forma, canal, company_account_id, created_by_name)
    values (v_acc, p_company, v_c ->> 'forma', nullif(v_c ->> 'canal', ''), v_cta, v_quien);
    v_n := v_n + 1;
    v_hechas := v_hechas || ((v_c ->> 'forma') || case when nullif(v_c ->> 'canal', '') is null then '' else ' (' || (v_c ->> 'canal') || ')' end
                             || ' a la ' || (select code || ' · ' || name from public.company_account where id = v_cta));
  end loop;

  for v_x in select id, dia from public.conta_tpv_dia where id = any (coalesce(v_dias, '{}')) order by dia loop
    if public._conta_tpv_propuesta(v_x.id) ? 'sin_propuesta' then v_espera := v_espera || to_char(v_x.dia, 'DD/MM');
    else v_listos := v_listos || to_char(v_x.dia, 'DD/MM'); end if;
  end loop;

  return jsonb_build_object(
    'guardadas', v_n, 'listos', to_jsonb(v_listos), 'en_espera', to_jsonb(v_espera),
    'texto', format('Guardado: %s.', array_to_string(v_hechas, '; '))
      || case when cardinality(v_listos) = 0 then ''
              when cardinality(v_listos) = 1 then format(' El %s pasa a «Listo para validar».', v_listos[1])
              else format(' %s días pasan a «Listo para validar»: %s.', cardinality(v_listos), public._conta_tpv_lista(v_listos)) end
      || case when cardinality(v_espera) = 0 then ''
              when cardinality(v_espera) = 1 then format(' El %s sigue en espera: le falta otra cuenta.', v_espera[1])
              else format(' Siguen en espera %s días (%s): les falta otra cuenta.', cardinality(v_espera), public._conta_tpv_lista(v_espera)) end
      || ' Vale para los días que aún no están validados.');
end
$function$;

comment on function public._conta_tpv_formas_de(uuid, uuid[]) is 'R06: los cobros de unos días por forma de pago, con Deliverect partido por el canal de su orden. Interna, solo lee.';
comment on function public._conta_tpv_cuenta_de(uuid, text, text) is 'R06: la cuenta que tiene hoy una forma de pago (con su canal), o ninguna. Interna, solo lee.';
comment on function public.conta_tpv_formas(uuid, uuid) is 'R06: las formas de pago del TPV de una empresa, con su cuenta, lo del mes y los días sin validar que las llevan. Solo lee.';
comment on function public.conta_tpv_asiento_ejemplo(uuid, jsonb) is 'R06: el asiento de un día del TPV con las cuentas que se están eligiendo; lo propone _conta_tpv_propuesta en un bloque que se deshace siempre. No deja nada escrito.';
comment on function public.conta_tpv_formas_guardar(uuid, jsonb, text) is 'R06: guarda a qué cuenta va cada forma de pago del TPV y dice qué días pasan a «Listo para validar».';

revoke all on function public._conta_tpv_formas_de(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public._conta_tpv_cuenta_de(uuid, text, text) from public, anon, authenticated;
grant execute on function public._conta_tpv_formas_de(uuid, uuid[]) to service_role;
grant execute on function public._conta_tpv_cuenta_de(uuid, text, text) to service_role;
revoke all on function public.conta_tpv_formas(uuid, uuid) from public, anon;
revoke all on function public.conta_tpv_asiento_ejemplo(uuid, jsonb) from public, anon;
revoke all on function public.conta_tpv_formas_guardar(uuid, jsonb, text) from public, anon;
grant execute on function public.conta_tpv_formas(uuid, uuid) to authenticated, service_role;
grant execute on function public.conta_tpv_asiento_ejemplo(uuid, jsonb) to authenticated, service_role;
grant execute on function public.conta_tpv_formas_guardar(uuid, jsonb, text) to authenticated, service_role;
