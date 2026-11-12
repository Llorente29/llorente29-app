-- supabase/migrations/20261108T0112_g01c_crm_neutro_b.sql
--
-- G01c · PR B de la clave neutra (Julio, 07/11): QUITA lo de Bitrix24 de la
-- base, ahora que nada publicado lo usa (el PR A, #506, publicado; la lectura
-- de las 00:05 UTC del 08/11 ya salió con origen «crm» y solo tipos neutros).
-- Después de esta y de la siguiente (las columnas de antes),
-- «bitrix» solo queda en el valor crm = 'bitrix24', en el nombre de la función
-- de borde que despierta la lectura (conta-bitrix-leer, la entrada del
-- adaptador), en textos y comentarios, y en los datos de diferencias antiguas
-- que ya no están vigentes (excepciones de Julio).
--
-- cambia: public.conta_gestoria_diferencia · prueba: supabase/staging/sql/20261108_g01c_crm_neutro_b_prueba.sql
-- cambia: public.conta_gestoria_lectura · prueba: supabase/staging/sql/20261108_g01c_crm_neutro_b_prueba.sql
-- cambia: public.conta_crm_bitrix · prueba: supabase/staging/sql/20261108_g01c_crm_neutro_b_prueba.sql
-- cambia: public._conta_crm_a_bitrix · prueba: supabase/staging/sql/20261108_g01c_crm_neutro_b_prueba.sql
-- cambia: public._conta_crm_desde_bitrix · prueba: supabase/staging/sql/20261108_g01c_crm_neutro_b_prueba.sql
--
--   1. Los tipos de antes de «Pendiente de revisar» pasan a los neutros
--      (bitrix_sin_cobro → crm_sin_cobro, nif_repetido_en_bitrix →
--      nif_repetido_en_crm, correo_repetido_en_bitrix → correo_repetido_en_crm)
--      y las lecturas de origen «bitrix», a «crm». Los CHECK, sin los de antes;
--      con uno nuevo: «ya_no_es_cliente_en_crm» (un cliente de Sumied cuya
--      ficha ya no es cliente en el CRM; el contacto 713 del 08/11).
--   2. Para después, en su propio PR: las columnas de antes de las
--      tablas (bitrix_id de fichas, clientes y diferencias; forma_pago_bitrix
--      y emisor_segun_bitrix), las de las dos vistas de consulta
--      (forma_de_pago_en_bitrix, leido_de_bitrix, ficha_en_bitrix) y lo que
--      aún las escribe (conta_crm_guardar_clientes). Borrar una columna va en
--      su propia tanda, sin nada más en su tabla, y quitar una columna de una
--      vista es borrarla y volverla a crear, que el analizador de main y
--      antes-de-subir cuentan como borrar algo que el front lee
--      (conta_consulta_clientes). Nada publicado las lee.
--   3. Fuera conta_crm_bitrix, con sus dos disparadores espejo, y las
--      funciones conta_bitrix_* (de paso y del adaptador viejo) y
--      _conta_bitrix_campo_sensible. Todas con su respaldo, para la vuelta
--      atrás. Las dos funciones de los espejos (_conta_crm_a_bitrix y
--      _conta_crm_desde_bitrix) se quedan sin disparador y vacías: el
--      analizador cuenta como uso el disparador que quita este mismo fichero,
--      así que se borran en la tanda siguiente, ya sin ningún uso.
--   4. El secreto de Vault de cada conexión se llama «conta_crm:<crm>:<cuenta>»
--      (antes «conta_bitrix:<cuenta>»). Solo cambia el nombre: el secreto es el
--      mismo y la conexión lo lee por su id (url_ref), sin volver a pegarlo.
-- No lee ni escribe nada en el CRM. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261108T0112_g01c_crm_neutro_b.down.sql

-- Las funciones que se cambian o se quitan, guardadas (_respaldar_funcion).
select public._respaldar_funcion('public.conta_bitrix_guardar_clientes(uuid,jsonb)', '20261108T0112_g01c_crm_neutro_b');
select public._respaldar_funcion('public.conta_bitrix_confirmar_mapa(uuid,jsonb)', '20261108T0112_g01c_crm_neutro_b');
select public._respaldar_funcion('public.conta_bitrix_aplicar_union(uuid)', '20261108T0112_g01c_crm_neutro_b');
select public._respaldar_funcion('public.conta_bitrix_guardar_conexion(uuid,text,text,text,text)', '20261108T0112_g01c_crm_neutro_b');
select public._respaldar_funcion('public.conta_bitrix_secreto(uuid)', '20261108T0112_g01c_crm_neutro_b');
select public._respaldar_funcion('public.conta_bitrix_guardar_fichas(uuid,jsonb)', '20261108T0112_g01c_crm_neutro_b');
select public._respaldar_funcion('public._conta_bitrix_campo_sensible(jsonb)', '20261108T0112_g01c_crm_neutro_b');
select public._respaldar_funcion('public._conta_crm_a_bitrix()', '20261108T0112_g01c_crm_neutro_b');
select public._respaldar_funcion('public._conta_crm_desde_bitrix()', '20261108T0112_g01c_crm_neutro_b');

-- 0 · La copia de lo que cambia (el rastro, como la 0130 de ventas): cada
-- diferencia y cada lectura con su tipo u origen de antes. La vuelta atrás
-- los devuelve de aquí, fila a fila.
create table public._copia_g01c_crm_neutro_b (
  tabla       text not null check (tabla in ('conta_gestoria_diferencia', 'conta_gestoria_lectura')),
  id          uuid not null,
  antes       text not null,
  copiado_at  timestamptz not null default now(),
  primary key (tabla, id)
);
comment on table public._copia_g01c_crm_neutro_b is
  'G01c · PR B · El tipo (diferencias) o el origen (lecturas) que tenían antes de pasar a los neutros. Rastro de la 0112; lo lee su vuelta atrás.';
alter table public._copia_g01c_crm_neutro_b enable row level security;
revoke all on table public._copia_g01c_crm_neutro_b from anon, authenticated;
insert into public._copia_g01c_crm_neutro_b (tabla, id, antes)
select 'conta_gestoria_diferencia', id, tipo from public.conta_gestoria_diferencia
 where tipo in ('bitrix_sin_cobro', 'nif_repetido_en_bitrix', 'correo_repetido_en_bitrix')
union all
select 'conta_gestoria_lectura', id, origen from public.conta_gestoria_lectura where origen = 'bitrix';

-- 1 · Los tipos y el origen, neutros.
update public.conta_gestoria_diferencia set tipo = case tipo when 'bitrix_sin_cobro' then 'crm_sin_cobro' when 'nif_repetido_en_bitrix' then 'nif_repetido_en_crm'
  else 'correo_repetido_en_crm' end
 where tipo in ('bitrix_sin_cobro', 'nif_repetido_en_bitrix', 'correo_repetido_en_bitrix');
alter table public.conta_gestoria_diferencia drop constraint if exists conta_gestoria_diferencia_tipo_check;
alter table public.conta_gestoria_diferencia add constraint conta_gestoria_diferencia_tipo_check check (tipo = any (array[
  'crm_sin_cobro', 'gocardless_sin_ficha', 'emisor_distinto', 'nif_repetido_en_crm', 'correo_repetido_en_crm', 'nif_distinto',
  'suscripcion_sin_convertir', 'totales_distintos', 'mandato_por_firmar', 'falla_a_menudo', 'abono_en_otra_cuenta',
  'fichas_repetidas', 'nif_no_valido', 'ficha_no_guardada', 'contacto_solo_negociacion', 'contacto_empresa_con_datos',
  'ya_no_es_cliente_en_crm']));
update public.conta_gestoria_lectura set origen = 'crm' where origen = 'bitrix';
alter table public.conta_gestoria_lectura drop constraint if exists conta_gestoria_lectura_origen_check;
alter table public.conta_gestoria_lectura add constraint conta_gestoria_lectura_origen_check check (origen = any (array['gocardless', 'crm']));

-- 2 · conta_crm_bitrix (con sus espejos) y las funciones de antes, fuera.
drop trigger if exists conta_crm_bitrix_a_crm on public.conta_crm_bitrix;
drop trigger if exists conta_crm_a_bitrix on public.conta_crm;
drop table if exists public.conta_crm_bitrix;
drop function if exists public.conta_bitrix_guardar_clientes(uuid, jsonb);
drop function if exists public.conta_bitrix_confirmar_mapa(uuid, jsonb);
drop function if exists public.conta_bitrix_aplicar_union(uuid);
drop function if exists public.conta_bitrix_guardar_conexion(uuid, text, text, text, text);
drop function if exists public.conta_bitrix_secreto(uuid);
drop function if exists public.conta_bitrix_guardar_fichas(uuid, jsonb);
drop function if exists public._conta_bitrix_campo_sensible(jsonb);
-- Sin disparador y vacías hasta la tanda siguiente (ver 3 en la cabecera).
create or replace function public._conta_crm_a_bitrix() returns trigger language plpgsql as $$
begin
  return new; -- G01c · PR B: sin disparador; se borra en la tanda siguiente.
end $$;
create or replace function public._conta_crm_desde_bitrix() returns trigger language plpgsql as $$
begin
  return new; -- G01c · PR B: sin disparador; se borra en la tanda siguiente.
end $$;

-- 3 · El nombre del secreto de cada conexión (solo el nombre: el secreto no se toca).
do $$
declare r record;
begin
  for r in select account_id, crm, url_ref from public.conta_crm where url_ref is not null loop
    perform vault.update_secret(r.url_ref, null, 'conta_crm:' || r.crm || ':' || r.account_id::text);
  end loop;
end $$;
