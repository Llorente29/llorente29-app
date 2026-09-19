# PARTE · Las pegatinas dejan de salir al entrar

**19/09/2026, 16:50.** Un solo cambio. **Escrito y SIN EJECUTAR: lo aplica Julio.**

---

## 1 · Los dos momentos, y cuál he movido

Los dos viven **en la base**, no en el front. El repositorio los guarda en
`supabase/migrations/20260811094226_print_job_no_fallar_en_silencio.sql`:

| momento | función | qué encola hoy |
|---|---|---|
| **al entrar** el pedido (`order_status='accepted'`) | `tg_auto_print_on_accept` | cocina, pegatinas, y la bolsa si el local no la saca al «Listo» |
| **al «Listo»** (`order_status='awaiting_collection'`) | `tg_auto_print_bag_on_ready` | la bolsa |

**He movido `labels` del primero al segundo.** La cocina no se toca. **No hay
cambio de front**: esto no pasa por Vercel ni publica nada en las tablets.

## 2 · Comprobado contra lo desplegado, no contra el fichero

Las dos funciones vivas son **byte a byte** la migración del 11/08. **No hay
deriva.** Sus md5, que la propia migración vuelve a comprobar antes de tocar
nada:

```
tg_auto_print_on_accept      ec875f94cb19cdc1eca148c646fcff72
tg_auto_print_bag_on_ready   e5cd73be1ec8530b8afdb305c5b64253
```

**Si alguien despliega algo entre ahora y que la ejecutes, la migración
aborta y no cambia nada.**

## 3 · A quién afecta, medido

| local | impresora | doc_types | activa | bag_on_ready |
|---|---|---|---|---|
| **Alcalá** | Cocina | `{kitchen}` | sí | **true** |
| **Alcalá** | Pase | `{bag}` | sí | **true** |
| **Alcalá** | **Pegatina** | **`{labels}`** | sí | **true** ← el caso |
| Carabanchel | Cocina | `{bag,kitchen,labels}` | **NO** | false |
| Carabanchel | Impre | `{kitchen,bag}` | sí | false ← sin `labels`: intacto |
| Plaza Castilla | NT311 | `{bag,kitchen,labels}` | sí | false ← 0 impresiones en 7 días |

**Las 528 pegatinas de los últimos 7 días son TODAS de Alcalá.**

**El diseño: las pegatinas viajan con la bolsa, no a una hora nueva.** Se
enganchan a `bag_on_ready`, que ya decide cuándo sale la bolsa:
- `bag_on_ready = true` (Alcalá) → bolsa y pegatinas al «Listo»;
- `bag_on_ready = false` (Carabanchel, Plaza Castilla) → **nada cambia**, su
  bolsa ya sale al entrar y las pegatinas siguen con ella.

Así no hay un tercer momento que explicar, y **ningún local cambia sin que su
bolsa cambie con él**. Carabanchel no se activa, como pide el encargo.

## 4 · Los cuatro cuidados, uno por uno

1. **La reimpresión sigue funcionando y no hace falta tocarla.**
   `reprint_order(p_sale_id, p_doc_type)` recorre `printer.doc_types`
   genéricamente y **no depende de estos disparadores para nada**. Leído hoy
   en su definición viva. Con `p_doc_type='labels'` saca las pegatinas en la
   Pegatina. 12 reimpresiones de bolsa en 7 días: alguien las usa.
2. **No se encola dos veces** si el pedido se cierra, se reabre y se vuelve a
   cerrar: la guarda `not exists (sale_id, source='auto', doc_type,
   printer_id)` es la de siempre, y ahora se evalúa **por cada doc_type**.
3. **Carabanchel no se ve afectado.** Su impresora viva no tiene `labels`.
4. **La cámara** no entra hoy. El orden imprimir → pegar → foto queda escrito
   para cuando esté.

## 5 · Lo que se pierde, con su número

**Un pedido que se acepta y nunca llega a «Listo» ya no saca pegatinas solo.**
En Alcalá, 7 días: **528 aceptados, 510 llegaron a bolsa, 18 no — el 3,4 %**
(estados `accepted`, `cancelled`, `completed`, `delivery_failed`). Son unos
2-3 al día. Para esos, la pegatina se saca por la reimpresión, que es lo que
dice el encargo. Lo digo con la cifra porque hoy esos 18 sí sacaban pegatina.

## 6 · La vuelta atrás, escrita ANTES

`claude/sql/20260919_VUELTA_ATRAS_pegatinas_con_la_bolsa.sql`

Devuelve las dos funciones **exactamente** a lo desplegado hoy — no
reconstruidas del fichero, sino `pg_get_functiondef` copiado tal cual — y
**comprueba los dos md5 al final**. Es un `create or replace`: tarda un commit
y no toma cierre de ninguna tabla.

**Cuándo usarla:** si un pedido nuevo de Alcalá no saca cocina, no saca bolsa,
o salen pegatinas duplicadas.

**Lo que no deshace:** los `print_job` ya encolados con el comportamiento
nuevo siguen encolados. No borro filas a ciegas.

## 7 · La banda de servicio: esto SÍ está en el camino del pedido

No lo escondo:

| | |
|---|---|
| **1 · ¿En el camino del pedido?** | **NO SE CUMPLE.** Son dos funciones de disparador sobre `sale` |
| **2 · ¿Toma cierre exclusivo?** | Se cumple. Un `create or replace` de función no bloquea ninguna tabla |
| **3 · ¿Se dice antes?** | Esto es ese «antes» |

**Lo que acota el daño, y se lee en el código:** el cuerpo entero de las dos
funciones va dentro de un `begin … exception when others then raise warning …
end`. **Si esto fallara, el pedido se acepta igual y lo que se pierde es la
impresión, no la venta.** No es el caso del 10/09, donde la excepción se
llevaba la transacción por delante.

**Y la migración se protege sola:** va entera en `begin … commit`, así que un
error de sintaxis en el `create or replace` aborta el conjunto y **deja las
funciones vivas intactas**.

**Aun así, la condición 1 falla y la decisión no es mía.** Falta el sí de
Julio y, si se puede, un hueco medido — como el 16/09 con `hubrise-webhook`:
se contaron 0 pedidos en 5 minutos antes de empujar.

## 8 · Lo que NO he hecho

- **No he ejecutado nada.** Ni un `create or replace`, ni un ensayo con
  `rollback` contra producción: la única forma de comprobar la sintaxis de
  plpgsql es crear la función, y crear es escribir. He revisado construcción
  por construcción (`foreach … in array`, el operador `&&`, `= any(...)`),
  y digo que **no está ejecutada ni probada corriendo**.
- Ni el número del día, ni la pegatina nueva, ni la pantalla de entrega, ni
  la cola. Nada del encargo grande.

## 9 · Después de aplicar

La consulta del encargo, con la hora del `commit`:

```sql
select doc_type, source,
       round(avg(extract(epoch from (pj.created_at - s.created_at))))::int as seg_tras_entrada
from print_job pj join sale s on s.id = pj.sale_id
where pj.created_at > '<hora del commit>'
group by 1,2 order by 1;
```

**El criterio es una cifra: `labels` deja de salir en ~1 s y pasa a salir
cuando sale `bag`.** Si sigue diciendo 1, no está hecho.

**Un aviso para no perseguir un fantasma:** esa consulta mezcla locales. Hoy
no importa —las 528 pegatinas son de Alcalá y Plaza Castilla no imprime—,
pero si Plaza Castilla arranca, su `labels` seguirá saliendo a 0 s **y estará
bien**, porque allí la bolsa también sale a 0 s. Si hay dudas, añade
`join locations l on l.id = pj.location_id` y agrupa por local.

**Lo que no puedo comprobar yo:** que el papel sale de la máquina. Eso, con
una pegatina en la mano.
