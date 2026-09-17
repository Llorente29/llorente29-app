# Parte — el Pase, los doce puntos y el cierre a mano · 17/09/2026, 02:10

Rama `claude/cool-mccarthy-5we9rc`, commit **`6e674d8d`**. Nada en `main`: el
paquete **305 sigue retenido** y las tres tablets en el **303**, comprobado al
terminar.

**Las dos migraciones de esta vuelta están escritas y SIN APLICAR.** Desde tu
regla de las 00:00, ninguna escritura en producción sin tu sí.

---

## 0 · Lo que ya estaba hecho de tu §0

**El nombre de la migración ya coincide.** Lo renombré anoche y va dentro del
commit `2b0da8c0`: el fichero se llama `20260916214617_la_hoja_de_detalle_del_pase.sql`,
igual que la fila de `schema_migrations`. Lo que miraste era el estado de antes
del renombrado.

---

## 1 · Los doce puntos

**1 · La pastilla y la línea de debajo del nombre.** Fuera la línea. La misma
idea salía tres veces en una tarjeta de cinco líneas: pastilla «GLOVO», «Glovo ·
lo recoge su repartidor» y «Esperando al rider de Glovo». Se queda sólo lo que
la pastilla no cabe a decir: el nombre de nuestro repartidor y el aviso en ámbar
de que no lo ha cogido nadie. Capturas 1, 2 y 5.

**2 · El aviso de zona nombra a todas las plataformas.** «Glovo y Uber no nos
dicen cuándo sale ni cuándo llega.» Y una corrección que salió al escribirlo: si
la lista incluyera a todo el grupo 2, un reparto nuestro sin coger habría hecho
decir **«nosotros no nos dice cuándo sale»**. Sólo cuentan las que esperan a un
rider de plataforma. Probado con los cinco casos.

**3 · Nuestros, con y sin repartidor.** Con repartidor, su nombre en la nota
(captura 2: «Lelis Daibeth Ibarguen Valencia», y debajo «Recogido a las 22:49»).
Sin repartidor, la nota en ámbar y el recuadro «Listo, esperando a que alguien lo
coja» (captura 5, compuesta: esta noche no hubo ninguno).

**4 · El retraso en «En ruta», con el número medido.** 387 repartos con recogida
Y entrega selladas, 30 días, de `handed_to_courier_at` a `delivered_at`:

| | n | media | mediana | p75 | **p90** | máximo |
|---|---|---|---|---|---|---|
| flota nuestra | 378 | 14,6 | 12,6 | 18,0 | 25,3 | 67,9 |
| Uber por HubRise | 9 | 20,0 | 15,7 | 26,8 | 32,4 | 50,6 |
| **todos** | **387** | **14,7** | 12,7 | 18,1 | **25,7** | 67,9 |

- **La frase dice la media**, «la media de reparto son 15 min», que es lo que
  aprobó la maqueta y es verdad: 14,7 redondea a 15.
- **El ámbar salta en el p90: 26 minutos**, uno de cada diez. Avisar en la media
  pintaría de ámbar media pantalla, y entonces el ámbar deja de decir nada.
- Un solo umbral para los dos grupos, y va dicho: nueve casos de Uber por HubRise
  no dan para un número propio.
- 🔴 Antes la constante valía **30** con un comentario que decía «medido: 15 min
  de media». Ni el número era el medido ni el comentario correspondía al número.

Captura 6, con U8C4DE: recogido 20:48, entregado 21:38, 51 minutos de calle. El
reloj de esa captura está a las 21:30 porque a las 22:55 ese pedido ya estaba
entregado hacía rato — un caso real no se puede enseñar a una hora en la que no
existía.

**5 · G740 fuera de «En ruta».** Hecho: un pedido del grupo 2 al que se le pulsa
«Se lo ha llevado» **se va del Pase**. En el corte real de las 22:55 eso son
**cinco** tarjetas que desaparecen de la zona (G740, G522, G284, G013, G804), y
«En ruta» queda con las dos de flota. Captura 2. No había otra salida: de un
Glovo por Glovo no llega ninguna entrega nunca, así que la zona era un cajón que
sólo crecía.

**6 · «Entregado a Javier · hace 4 min».** Hecho, con el nombre cuando lo
tenemos — 1.667 de 1.667 ventas de 14 días lo traen — y sin inventarse un
«Entregado a —» cuando no. Captura 3.

**7 · La bolsa sin salir, en captura.** Captura 4: botón rojo **en lugar de**
«Listo», la frase, «Intentado 3 veces» y **la hora, 22:42**. Compuesto, y va
dicho en la propia captura: esta noche no falló ninguna impresora.

**8 · La hoja recupera los dos datos.** «Bolsa · impresa 22:49» y el cómo avanzó
pegado al «Listo». 🔴 `avanzo_quien` sigue siendo NULL y la hoja escribe **«lo
marcó una persona»**, no «por Ana»: la base no guarda quién pulsó. Inventarse un
nombre sería peor que no decirlo. El día que se guarde, la clave se llena y la
pantalla lo dice sola.

**9 · El código de la centralita, y aquí el número corrige al encargo.**
Medido sobre 1.061 códigos de 30 días:

| canal | códigos | dígitos | ¿vienen agrupados? |
|---|---|---|---|
| Uber | 987 | **8**, todos | **sí**, todos: «325 19 763» |
| JustEat | 74 | **9**, todos | **no**, ninguno: «464322807» |

**Ocho dígitos no se parten en treses.** Forzar el 3-3-3 daría «567 303 08», un
ritmo que Uber no usa en ningún sitio: quien compare la tablet con otra pantalla
vería dos agrupaciones del mismo número, que es justo como se teclea un dígito de
menos. Lo que he hecho: **se respeta la agrupación que manda el conector, y al
que no manda ninguna se le pone de tres en tres.** Queda Uber «567 30 308» y
JustEat «878 795 717» — que es el 3-3-3 que pedías, porque nueve sí se parten.
**Si prefieres el otro reparto, se cambia en una línea.**

**10 · Datos coherentes con el reloj.** Rehecho de raíz: las capturas salen de un
**corte real de la base a las 22:55**, sacado con una consulta que reproduce la
forma de `pase_board` y anula los instantes posteriores al corte. Son las **20
comandas** que había vivas en Alcalá a esa hora. No hay ni una hora escrita a
mano. Lo único compuesto son dos casos, y cada uno lo dice en su captura.

**11 · El pie de las que se fueron solas.** Captura 1: «**7** se fueron solas a
los 30 min sin que nadie tocara · ver». Salen de los datos reales, no de un
contador puesto a mano.

**12 · La barra de arriba.** **Sí la pone `TabletStationRoute`**, y le faltaba lo
que pedía la maqueta: **la hora**. Añadida. Captura 0, que es la pantalla entera
de la tablet: «Folvy | Foodint Alcalá | Pedidos · Cocina · Disponibilidad ·
Impresoras | **22:55** | Desvincular».
🔴 En esa captura **no sale la pestaña «Pase»**, y no es que no exista: está en
el DOM (comprobado volcándolo), pero Chromium saca la foto antes de que termine
de resolverse la llamada que decide si el Pase está encendido. Es un límite de
cómo hago las capturas, no de la pantalla. Lo digo en vez de recortarlo.

**13 · El código `J191403139` en la esquina.** No lo he tocado, como pediste. En
la tarjeta sale acortado «…3139» y **entero en la cabecera de la hoja**, que es
donde se compara con la pegatina. Tú decides.

---

## 2 · «Cerrar a mano»

**Primero lo que ya había, que era la pregunta:**

- `set_order_status_by_token(token, venta, 'completed')` **existe**, comprueba
  cuenta Y local, y al poner `completed` dispara `trg_sale_close_on_complete` →
  `close_sale`. **Es el camino único**, el mismo del botón «Completar» de
  Pedidos. La RPC nueva hace exactamente ese UPDATE: no se abre un segundo
  camino.
- `cancel_sale(venta, motivo)` **existe y NO sirve**: pone `status='cancelled'` y
  llama a `revert_sale_consumption`. Cerrar a mano no es anular — la comida se
  hizo y el stock salió. Y reciclar `cancel_reason` dejaría filas cerradas con un
  «motivo de anulación»: hoy hay **26 ventas con ese campo y las 26 son
  anulaciones de verdad**. Cualquiera que las cuente las leería mal.
- No hay ninguna tabla de eventos de pedido donde meterlo: `local_event` es de
  eventos de demanda (fiestas, obras), 38 filas.

**Por eso el SQL propone dos columnas nuevas, y es lo que hay que aprobar:**

```sql
alter table public.sale add column if not exists manual_close_reason text;
alter table public.sale add column if not exists manual_close_note   text;
alter table public.sale add column if not exists manual_closed_at    timestamptz;
```

Y una RPC `cerrar_a_mano_by_token(token, venta, motivo, texto)` que, en **una
sola transacción**: comprueba cuenta y local, valida el motivo contra los cuatro,
exige texto si es «otro», escribe el motivo y **después** pone
`order_status='completed'`. Si algo falla no queda un pedido cerrado sin decir
por qué. Y si ya estaba cerrado, no lo vuelve a cerrar ni pisa el motivo
anterior: devuelve lo que hay.

⚠️ **Ese `alter table` sí toma `ACCESS EXCLUSIVE` sobre `sale`**, que es la tabla
del camino del pedido. No cumple la condición 2 de la banda, así que **se aplica
después de las 23:45**, aunque añadir una columna anulable sean milisegundos.

**Dónde va el botón, que era la otra pregunta: desde el pie, no desde la
tarjeta.** Y no es una preferencia:

1. La **regla 3 de la maqueta** prohíbe que la hoja cambie el estado del pedido.
   Tocar la tarjeta abre la hoja; un «cerrar» dentro sería exactamente lo
   prohibido, en una pantalla que se abre con la bolsa en una mano.
2. **Lo que hay que cerrar a mano suele no estar en pantalla.** En el corte de
   las 22:55, de los seis primeros de la lista, **cuatro ya no están en ninguna
   zona** (se fueron solas a los 30 min) y dos son del grupo 2 recogidos. Si sólo
   se pudiera cerrar lo que se toca, lo que más falta hace cerrar sería justo lo
   que no se puede.

Captura 7. La lista enseña todo lo vivo, esté o no en una zona; «Cerrar el
pedido» no se puede pulsar hasta que hay pedido y motivo, y **debajo se dice qué
falta** en vez de dejar un botón gris y callado.

---

## 3 · Lo que queda en tus manos

1. **La ficha de la tablet «Pase».** Sigue en `web`, reescrita a las **23:38:09**
   — la pestaña seguía abierta. Cuando la cierres, dímelo: compruebo que
   `app_version_at` no se mueve en cinco minutos y la restauro **una vez**, con
   antes y después.
2. **El sí para las dos migraciones.** `pase_ficha` v2 (la bolsa y el cómo
   avanzó) y el cierre a mano. Ninguna aplicada.
3. **T2** (el código de JustEat en la esquina) y **el punto 9** (la agrupación
   del código): los dos son tuyos.

## 4 · Medido a los dos lados

| | antes | después |
|---|---|---|
| lint | 1025 problemas · 757 errores · 268 avisos | **1025 · 757 · 268** |
| pruebas | 1569 en 104 ficheros | **1596 en 105** |
| `tsc -b` | limpio | limpio |
| `npm run build` exacto y en limpio | exit 0 | **exit 0** |

Las 27 pruebas nuevas van contra la población real. Una cazó un fallo antes de
salir: con `quienReparte()`, la frase de la centralita de un JustEat repartido
por nosotros salía **«nosotros da un número único para todos»** — además de mal
escrito, falso: la centralita es del canal.

## 5 · Lo que no se ha tocado

La base y las funciones de ayer, `pase_board`, y las tablets. El 305 sigue
retenido: `bundle.json` no existe, `_ultimo_bundle_publicado()` = 303 y las tres
tablets en 303.
