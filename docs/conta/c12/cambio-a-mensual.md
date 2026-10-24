# C12 · El cambio de Foodint al traspaso mensual (segunda tanda, después de fusionar)

**Propuesta: no está en ninguna tanda.** Va en su propia rama y tanda, con
`autorizo`, **cuando `conta-diez-traspaso` y el front del C12 estén en
producción** (Vercel READY y la función desplegada, comprobada por su md5).
Antes no: hasta entonces no hay botón para traspasar.

## Qué hace

1. Foodint pasa a `modo = 'mensual'`. «Enviar a Diez» sigue encendido (es lo
   que dice que la empresa trabaja con Diez); lo que cambia es que nada sale
   suelto: ni la cola del servidor (`conta_diez_por_enviar` ya no la coge), ni
   al validar, ni con «Reintentar» (`despacharADiez` lo para en el servidor,
   también desde una pantalla vieja).
2. La cola se vacía **sin enviar**: a los envíos pendientes de Foodint se les
   quita el reintento (`next_try_at = null`). La fila se queda con su motivo;
   el asiento sigue validado y va en el primer traspaso (el de octubre), porque
   pendiente no es «en Diez».
3. No borra nada ni toca lo que ya está en Diez.

## Recuentos antes de apagar (producción, solo lectura, 24/10 13:14 UTC)

Octubre de Foodint: 230 validados, 12 anulados, 36 propuestos; 215 ya en Diez;
27 validados sin llegar (25 de banco, 1 recibida, 1 pago a proveedor); 27
envíos pendientes, 26 con reintento puesto, ninguno de antes de octubre.
Se vuelven a medir el día que se aplique.

## El SQL (transaccional; lo revisa y lo lanza Julio)

```sql
-- cambia: public.conta_diez_envio_empresa (datos) · autorizo
begin;
do $$
declare v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710'; v_n int;
begin
  if to_regprocedure('public.conta_traspaso_confirmar(uuid, date)') is null then
    raise exception 'C12 · primero la 1250 (el traspaso), después este cambio.';
  end if;
  update public.conta_diez_envio_empresa set modo = 'mensual', cambiado_por_nombre = 'Julio (C12, traspaso mensual)', cambiado_en = now()
   where account_id = v_acc and enviar;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'C12 · se esperaba 1 empresa de Foodint con Diez encendido, y hay %.', v_n; end if;
  update public.external_send set next_try_at = null, updated_at = now()
   where account_id = v_acc and status = 'pendiente' and next_try_at is not null;
end $$;
commit;
```

Después, la comprobación: `conta_diez_por_enviar(50)` no devuelve nada de
Foodint; `conta_traspaso_revisar` de octubre dice `modo = mensual`; y los
pendientes con reintento de Foodint, 0.

Vuelta atrás: `modo = null` en la fila de Foodint (vuelve el envío al validar;
los pendientes salen en la siguiente pasada de la cola si se les pone
`next_try_at`).
