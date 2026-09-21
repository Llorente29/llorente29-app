# Runbook · La retirada del manifiesto para meter el 309

> 🔴 **SUPERADO el 21/09 a las 08:05, y NO se ejecuta.** El manifiesto y los
> pedidos los lleva **A**, un solo operador. Aquí no se renombra `bundle.json`,
> no se abren ni cierran pedidos y no se empuja a `main`. Esto queda como
> registro de lo que se pensó y de por qué hizo falta; las órdenes vivas están
> en el documento de A del 21/09 08:05.
>
> **Lo que este documento tuvo mal, y costó una hora de diagnóstico cruzado:**
>
> - Nombraba una fila que nunca existió, `bundle.json.retenido-309`. La que se
>   usó fue `bundle.json.pausa-20260921`, ya renombrada de vuelta. **No queda
>   ninguna fila huérfana.**
> - Y el error de fondo: **daba por hecho que quien mirara la base sería el
>   único tocándola.** Los movimientos que leí a las 07:35 como «alguien está
>   trabajando en las tablets» eran de A, por SQL, y de ahí salió una teoría
>   entera —la del reloj de inactividad— apoyada en un hecho inventado. Dos
>   manos sobre la misma palanca producen diagnósticos que encajan y son
>   falsos.
>
> **Lo que sigue siendo verdad y merece releerse:** por qué el 404 es la única
> palanca con el código del 306, que «Instalar ahora» NO la sustituye, y el
> tope de que una tablet con el número apuntado y el disco vacío no se recupera
> sin reabrir la app.
>
> Y el hallazgo que salió de aquí, que es de código y no de operación: en
> `UpdateGate`, `otaCheckedRemote` se apunta ANTES de que la descarga exista y
> no se borra si falla, así que una sola descarga fallida deja ese número
> marcado para siempre. Es la razón de que el reinicio sea obligatorio.

**21/09/2026, 01:10.** Vive en el repositorio a propósito: si se queda sólo en
una conversación, desaparece con ella. Eso es la regla 1.

## Qué se está haciendo y por qué

Las dos tablets Android corren el **306**, que lleva el fallo del id contra el
número (ver `claude/folvy_parte_ota_el_numero_no_es_el_id_20260921.md`). El
arreglo va en el **309**, ya publicado — pero el 306 lo descartaría igual,
porque el fallo está en el código que corre, no en el paquete.

El único hueco del código viejo es éste:

```ts
if (!resp.ok) return true    // no contesta → no se sabe → adelante
```

Retirar `bundle.json` da un 404 → aplica. **Es la única palanca.** El botón
«Instalar ahora» NO sirve: `instalarYa` sólo se salta la ventana, y
`sigueEstandoPublicado` corre igual en los dos caminos.

## Las horas

| | |
|---|---|
| 309 publicado | 21/09 **00:59:15** (`OK · bundleId=309`) |
| retirar el manifiesto | 01:47 |
| **tope duro** | **11:12** — abre la ventana de Carabanchel |
| Alcalá abre | 11:34 |
| las dos cierran | 12:45 |

Pasadas las 11:12 con el manifiesto puesto, Carabanchel descarta el 309 y no lo
vuelve a buscar hasta que se reinicie la app: `otaCheckedRemote` ya tiene ese
número apuntado y el ciclo de 15 min no repite la descarga.

## Retirar

Renombrar, **nunca borrar**: desde el entorno de Claude el proxy deniega
`supabase.co`, así que no se puede volver a subir. El renombrado se deshace.

```sql
update storage.objects o
   set name = 'bundle.json.retenido-309'
  from storage.buckets b
 where b.id = o.bucket_id and b.name = 'apps' and o.name = 'bundle.json';
```

No se pone el bucket en privado: eso dejaría inalcanzable también
`bundle-309.zip`, que las tablets todavía tienen que bajarse.

## Reponer

En cuanto **`Cocina` y `Tablet camichi4`** enseñen 309 en
`kds_device.bundle_applied`. **Las dos, no las tres:** `Pase` es `platform=web`,
su código llega por Vercel y su `bundle_applied: 306` es un resto de cuando era
APK.

**🔴 El nombre NO se adivina, se busca.** El 21/09 lo retiró otra mano con otro
nombre --`bundle.json.pausa-20260921`, a las 07:35:06-- y la consulta de
reponer que había escrita aquí buscaba `bundle.json.retenido-309`: no habría
encontrado nada, y habría parecido que no hay manifiesto que reponer. Se busca
primero:

```sql
select o.name, to_char(o.updated_at at time zone 'Europe/Madrid','DD/MM HH24:MI:SS') as tocado
  from storage.objects o join storage.buckets b on b.id = o.bucket_id
 where b.name = 'apps' and o.name like 'bundle.json%'
 order by o.updated_at desc;
```

y se repone el que salga, por su nombre exacto:

```sql
update storage.objects o
   set name = 'bundle.json'
  from storage.buckets b
 where b.id = o.bucket_id and b.name = 'apps'
   and o.name = '<el nombre que haya salido arriba>';
```

Con el manifiesto retirado no hay descubrimiento: una tablet que se reinicie en
ese rato no encuentra nada. Por eso se repone en cuanto entren, no más tarde.

## Si el renombrado no se pudiera deshacer

**Hay salida, y es empujar a `main`.** La subida del workflow es `POST` con
`x-upsert: true` (`build-apk.yml:140-144`), así que si no existe fila
`bundle.json` la **crea**. Un push republica el manifiesto.

Dos cosas que hay que saber antes de usarlo:

1. **Vuelve diciendo 310, no 309.** Restaura el servicio normal, no la entrada
   del paquete: una tablet que siguiera en 306 descubriría el 310 y lo
   descartaría igual. Para meter un paquete en una tablet sorda hace falta otra
   vez el 404.
2. **Después, no antes.** Empujar mientras las tablets persiguen el 309 cambia
   el número que esperan.

Y queda la fila huérfana `bundle.json.retenido-309`, que hay que borrar.

## Comprobar

```sql
select d.label, d.bundle_applied,
       to_char(d.bundle_applied_at at time zone 'Europe/Madrid','DD/MM HH24:MI') as aplicado,
       round(extract(epoch from (now() - d.last_seen_at))/60)::int as min_sin_latir
from kds_device d where d.is_active and d.platform = 'android' order by d.label;
```

**Hecho es las dos en 309**, y después papel de verdad: una pegatina y un ticket
impresos y mirados. La prueba de que está resuelto y no sorteado es que **el
paquete siguiente entre solo, sin retirar ningún manifiesto.**
