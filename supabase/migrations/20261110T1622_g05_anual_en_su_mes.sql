-- supabase/migrations/20261110T1622_g05_anual_en_su_mes.sql
-- cambia: public.conta_linea_al_mes · prueba: supabase/staging/sql/20261110_g05_anual_en_su_mes_prueba.sql
--
-- G05 · nº 89 · UNA ANUAL, ENTERA Y SOLO EN SU MES. Un servicio anual (el impuesto
-- de sociedades, 300 € al año) se sumaba al recibo cada mes como 25 €; GoCardless
-- lo cobra entero en su mes. El recibo lo calcula el servidor con
-- supabase/functions/_shared/tarifa/precio.ts (reciboDelMes), que en este mismo PR
-- pasa a cobrarla entera en el mes de su «desde» y nada en los demás. Aquí, lo
-- mismo en la base, para que lo que enseñan las altas de trabajador y las vistas
-- de antes (conta_consulta_clientes, conta_consulta_lineas) diga lo mismo:
--   conta_linea_al_mes(línea, mes): una línea o una tarifa «anio» vale su importe
--   entero en el mes del año de su «desde» y 0 en los demás (antes, 1/12 cada mes).
-- La función es la de producción (medida el 10/11 a las 16:20 UTC) con ese único
-- cambio. Con su respaldo.
-- Nada en el camino del pedido. No toca datos.
-- Vuelta atrás: supabase/vuelta-atras/20261110T1622_g05_anual_en_su_mes.down.sql

select public._respaldar_funcion('public.conta_linea_al_mes(uuid,date)', '20261110T1622_g05_anual_en_su_mes');

create or replace function public.conta_linea_al_mes(p_linea uuid, p_mes date)
 returns numeric
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare l public.conta_linea; t public.conta_tarifa; v_mes date := date_trunc('month', p_mes)::date; v_su_mes boolean;
begin
  select * into l from public.conta_linea where id = p_linea;
  if l.id is null then return null; end if;
  -- Una persona con sesión solo ve las líneas de sus cuentas; el servidor y la base, todas.
  if auth.uid() is not null and not public.belongs_to_account(l.account_id) then return null; end if;
  -- Fuera de sus meses, la línea no cuenta.
  if l.desde > v_mes or (l.hasta is not null and l.hasta < v_mes) then return 0; end if;
  -- nº 89 · Una anual va entera en el mes del año de su «desde» y no cuenta en los demás.
  v_su_mes := extract(month from l.desde) = extract(month from v_mes);
  if l.importe_propio is not null then
    return case l.periodo when 'anio' then case when v_su_mes then l.importe_propio else 0 end when 'unidad' then null else l.importe_propio end;
  end if;
  select * into t from public.conta_tarifa x
   where x.company_id = l.company_id and x.servicio_id = l.servicio_id and x.party_id = l.party_id
     and x.desde <= v_mes and (x.hasta is null or x.hasta >= v_mes)
   order by x.desde desc limit 1;
  if t.id is null then
    select * into t from public.conta_tarifa x
     where x.company_id = l.company_id and x.servicio_id = l.servicio_id and x.party_id is null
       and x.desde <= v_mes and (x.hasta is null or x.hasta >= v_mes)
     order by x.desde desc limit 1;
  end if;
  if t.id is null then return null; end if;   -- sin tarifa: no se inventa un precio
  return case t.periodo when 'anio' then case when v_su_mes then t.importe else 0 end when 'unidad' then null else t.importe end;
end $function$;
