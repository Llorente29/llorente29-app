-- supabase/vuelta-atras/20261108T0112_g01c_crm_neutro_b.down.sql
--
-- G01c · La vuelta atrás de la PR B (0112): todo como estaba tras el PR A.
-- conta_crm_bitrix con su fila de Bitrix24 y sus dos espejos; las funciones de antes (del respaldo) con sus permisos; los tipos y
-- el origen de antes en las filas que cambió la tanda (de su copia,
-- _copia_g01c_crm_neutro_b, fila a fila: lo nacido neutro se queda), y los
-- CHECK de después del PR A (admiten las dos cosas). Las dos funciones de los
-- espejos, como eran (del respaldo). El secreto de Vault vuelve a
-- llamarse «conta_bitrix:<cuenta>»; es el mismo, por su id.
-- sin prueba con datos: la prueba de staging (20261108_g01c_crm_neutro_b_prueba.sql) la pasa en ROLLBACK, con filas que cambia la tanda y otras nacidas neutras, y comprueba que todo queda como antes; el ensayo de producción la pasa entera, en ROLLBACK.

-- 3 · El nombre del secreto, como antes.
do $$
declare r record;
begin
  for r in select account_id, url_ref from public.conta_crm where url_ref is not null and crm = 'bitrix24' loop
    perform vault.update_secret(r.url_ref, null, 'conta_bitrix:' || r.account_id::text);
  end loop;
end $$;

-- 2 · Las funciones de antes, con sus permisos, y conta_crm_bitrix con su fila y sus espejos.
-- Los permisos, en el orden de antes: una función recreada nace con los de
-- serie de Supabase (service_role entre ellos); se quitan todos y se dan en
-- orden (authenticated, si lo tenía, y luego service_role).
select public._restaurar_funcion('public.conta_bitrix_guardar_clientes(uuid,jsonb)', '20261108T0112_g01c_crm_neutro_b');
select public._restaurar_funcion('public.conta_bitrix_confirmar_mapa(uuid,jsonb)', '20261108T0112_g01c_crm_neutro_b');
select public._restaurar_funcion('public.conta_bitrix_aplicar_union(uuid)', '20261108T0112_g01c_crm_neutro_b');
select public._restaurar_funcion('public.conta_bitrix_guardar_conexion(uuid,text,text,text,text)', '20261108T0112_g01c_crm_neutro_b');
select public._restaurar_funcion('public.conta_bitrix_secreto(uuid)', '20261108T0112_g01c_crm_neutro_b');
select public._restaurar_funcion('public.conta_bitrix_guardar_fichas(uuid,jsonb)', '20261108T0112_g01c_crm_neutro_b');
select public._restaurar_funcion('public._conta_bitrix_campo_sensible(jsonb)', '20261108T0112_g01c_crm_neutro_b');
select public._restaurar_funcion('public._conta_crm_a_bitrix()', '20261108T0112_g01c_crm_neutro_b');
select public._restaurar_funcion('public._conta_crm_desde_bitrix()', '20261108T0112_g01c_crm_neutro_b');
revoke all on function public.conta_bitrix_guardar_clientes(uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.conta_bitrix_guardar_clientes(uuid,jsonb) to service_role;
revoke all on function public.conta_bitrix_confirmar_mapa(uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.conta_bitrix_confirmar_mapa(uuid,jsonb) to authenticated, service_role;
revoke all on function public.conta_bitrix_aplicar_union(uuid) from public, anon, authenticated, service_role;
grant execute on function public.conta_bitrix_aplicar_union(uuid) to authenticated, service_role;
revoke all on function public.conta_bitrix_guardar_conexion(uuid,text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.conta_bitrix_guardar_conexion(uuid,text,text,text,text) to service_role;
revoke all on function public.conta_bitrix_secreto(uuid) from public, anon, authenticated, service_role;
grant execute on function public.conta_bitrix_secreto(uuid) to service_role;
revoke all on function public.conta_bitrix_guardar_fichas(uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.conta_bitrix_guardar_fichas(uuid,jsonb) to service_role;
revoke all on function public._conta_bitrix_campo_sensible(jsonb) from public, anon, authenticated, service_role;
grant execute on function public._conta_bitrix_campo_sensible(jsonb) to authenticated, service_role;
revoke all on function public._conta_crm_a_bitrix() from public, anon, authenticated, service_role;
grant execute on function public._conta_crm_a_bitrix() to service_role;
revoke all on function public._conta_crm_desde_bitrix() from public, anon, authenticated, service_role;
grant execute on function public._conta_crm_desde_bitrix() to service_role;
create table public.conta_crm_bitrix (
  account_id          uuid primary key references public.accounts(id) on delete cascade,
  entorno             text not null check (entorno in ('real', 'pruebas')),
  url_ref             uuid,
  portal              text,
  mapa                jsonb,
  campos_medidos      jsonb,
  conectada_at        timestamptz,
  conectada_por_name  text,
  ultima_lectura_at   timestamptz,
  empresas_leidas     integer,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
insert into public.conta_crm_bitrix (account_id, entorno, url_ref, portal, mapa, campos_medidos, conectada_at, conectada_por_name, ultima_lectura_at, empresas_leidas, created_at, updated_at)
select account_id, entorno, url_ref, portal, mapa, campos_medidos, conectada_at, conectada_por_name, ultima_lectura_at, empresas_leidas, created_at, updated_at
  from public.conta_crm where crm = 'bitrix24';
comment on table public.conta_crm_bitrix is
  'G01c · Mientras dura el cambio: el espejo de conta_crm de Bitrix24 (lo que se escribe en una se copia a la otra). La quita la tanda siguiente. G01 · El Bitrix24 de una cuenta (uno para todos sus emisores). La dirección con su clave, en Vault (url_ref, «conta_bitrix:<cuenta>»); portal: solo el nombre del portal, sin clave. mapa: el de campos (UF_CRM_… → Sumied), propuesto con crm.company.fields; campos_medidos: lo que devolvió.';
alter table public.conta_crm_bitrix enable row level security;
revoke all on table public.conta_crm_bitrix from public, anon, authenticated;
grant select on table public.conta_crm_bitrix to authenticated;
grant all on table public.conta_crm_bitrix to service_role;
create policy conta_crm_bitrix_leer on public.conta_crm_bitrix for select to authenticated using (public.belongs_to_account(account_id));
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then grant select on table public.conta_crm_bitrix to conta_lectura; end if;
end $$;
create trigger conta_crm_a_bitrix after insert or update or delete on public.conta_crm for each row execute function public._conta_crm_a_bitrix();
create trigger conta_crm_bitrix_a_crm after insert or update or delete on public.conta_crm_bitrix for each row execute function public._conta_crm_desde_bitrix();

-- 1 · Los tipos y el origen de antes, en las filas que cambió la tanda (de su copia); los CHECK de después del PR A.
delete from public.conta_gestoria_diferencia where tipo = 'ya_no_es_cliente_en_crm';
alter table public.conta_gestoria_diferencia drop constraint if exists conta_gestoria_diferencia_tipo_check;
update public.conta_gestoria_diferencia d set tipo = c.antes
  from public._copia_g01c_crm_neutro_b c where c.tabla = 'conta_gestoria_diferencia' and c.id = d.id;
alter table public.conta_gestoria_diferencia add constraint conta_gestoria_diferencia_tipo_check check (tipo = any (array[
  'bitrix_sin_cobro', 'gocardless_sin_ficha', 'emisor_distinto', 'nif_repetido_en_bitrix', 'correo_repetido_en_bitrix', 'nif_distinto',
  'suscripcion_sin_convertir', 'totales_distintos', 'mandato_por_firmar', 'falla_a_menudo', 'abono_en_otra_cuenta',
  'fichas_repetidas', 'nif_no_valido', 'ficha_no_guardada', 'contacto_solo_negociacion', 'contacto_empresa_con_datos',
  'crm_sin_cobro', 'nif_repetido_en_crm', 'correo_repetido_en_crm']));
alter table public.conta_gestoria_lectura drop constraint if exists conta_gestoria_lectura_origen_check;
update public.conta_gestoria_lectura l set origen = c.antes
  from public._copia_g01c_crm_neutro_b c where c.tabla = 'conta_gestoria_lectura' and c.id = l.id;
alter table public.conta_gestoria_lectura add constraint conta_gestoria_lectura_origen_check check (origen = any (array['bitrix', 'gocardless', 'crm']));
drop table if exists public._copia_g01c_crm_neutro_b;
