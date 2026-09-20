# Runbook · La retirada del manifiesto para meter el 309

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

```sql
update storage.objects o
   set name = 'bundle.json'
  from storage.buckets b
 where b.id = o.bucket_id and b.name = 'apps'
   and o.name = 'bundle.json.retenido-309';
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
