# Parte final — el Pase, publicado · 17/09/2026, 09:15

**Publicado y en las dos tablets de Alcalá, dos horas y tres cuartos antes del
límite.** La cocina abre a las 13:00; esto entró con el local cerrado.

---

## 1 · La cadena entera, con sus horas

| paso | resultado |
|---|---|
| Fusión a `main` | `ef7f1f97` |
| **Vercel, producción** | **`dpl_DxjPEtmuiANvMWTUw8Ja7AXuDQxD` · READY a las 09:04:45** · sirviendo `app.folvy.app` |
| Paquete OTA | **run 306**, `bundle-306.zip` · manifiesto reescrito a las **09:03:32** |
| `_ultimo_bundle_publicado()` | **306** |
| El 305 retenido | sigue en `retenido-20260916/`, sin volver a publicarse |

### Las tablets

| tablet | bundle | lo aplicó | reporta |
|---|---|---|---|
| Alcalá · **Pase** | **306** | **09:07:02** | `1.0.49 (49) · bundle 306` |
| Alcalá · **Cocina** | **306** | **09:07:48** | `1.0.49 (49) · bundle 306` |
| Carabanchel · camichi4 | 303 | 16/09 08:30:49 | `1.0.49 (49) · bundle 303` |

**Cuatro minutos** desde que se subió el manifiesto hasta que lo aplicaron las
dos, con el local cerrado y sin forzar nada. No hizo falta esperar a las 12:45.

**Carabanchel sigue en el 303** y no es un fallo: nunca llegó a descargarse el
305 —por eso la retención sí funcionó allí— y el 306 lo cogerá en su propia
ventana. Lo dejo dicho para que no sorprenda.

### 🔴 Y la ficha de la tablet «Pase» se ha arreglado sola

Decía `platform = web` desde que se abrió `/estacion` en un ordenador. Al
aplicar el 306 la tablet se reinicia y reporta su versión de verdad, así que
ahora dice **`1.0.49 (49) · bundle 306` en android**. No la he tocado a mano,
como pediste.

⚠️ **Si la pestaña sigue abierta en ese ordenador, volverá a pisarla** en cuanto
se recargue: `reportAppVersion()` manda `web` en cada arranque de esa pestaña.
La señal para saberlo es `app_version_at` moviéndose sin que la tablet se haya
reiniciado.

---

## 2 · Los dos retoques de texto

**1 · Cada hito lleva SU fuente, y «lo dice la flota» va con la salida.** Tenías
razón y la tabla lo enseñaba sola: `J191403139` tiene el «Listo» a las 22:49:11
y la recogida a las 22:49:49 — **38 segundos**. Alguien pulsó «Listo», se
imprimió la bolsa, y la flota avisó después. Ahora:

- **El «Listo»**, con la misma regla en todos los repartos, porque el mecanismo
  es el mismo: hueco de **2 s o menos** → «nadie lo pulsó: lo puso la recogida
  de X», y con nuestra flota X es «nuestro repartidor». Si no, «lo marcó una
  persona».
- **La salida y la entrega**: nuestra flota → «lo dice la flota»; plataforma con
  ciclo conocido → «lo dice Uber»; lo demás sólo puede haber llegado por el
  botón, así que «lo marcó una persona» — es G740, un Glovo por Glovo.

En la captura: **«Listo 22:49 · lo marcó una persona»** y **«Salió 22:49 · lo
dice la flota»**. Una prueba por cada uno de los cuatro casos que pediste, más
una que comprueba que cada hito recibe su fuente y ninguna otra.

**2 · El punto que sobraba.** «Intentado 3 veces · 22:42».

**Y las dos de no bloqueo, hechas igual:** la hoja montada de G918 lleva ahora
**MONTADA en su propio título dentro de la imagen**, con la nota de que en la
base ese pedido sí tiene teléfono; y el subtítulo de la confirmación ya no
promete lo que no enseña — dice que si el pedido estaba en «En ruta» la frase lo
añade, y que G858 estaba esperando, así que ahí no sale.

**Los ficheros de migración renombrados** a lo que quedó anotado en la base:
`20260917060246` y `20260917060306`.

---

## 3 · Lo único que no puedo hacer yo

**La captura desde la tablet.** No llego a la tablet ni a `app.folvy.app` desde
esta máquina —el proxy corta la salida: `CONNECT tunnel failed, 403`—, así que
**esa foto tiene que hacerla alguien en el local**. Lo que sí está comprobado por
la base: las dos tablets corren el 306, el mismo commit que produción web.

Y lo que **no** voy a hacer para conseguirla: abrir `/estacion` con el token
desde un ordenador. Eso es justo lo que lleva desde anoche pisando la ficha de
la tablet y falseando su latido.

**Lo que pediría en la foto:** la barra de arriba con «Folvy · Foodint Alcalá» y
la hora, y una hoja abierta de cualquier pedido de flota — que es donde se ve de
un vistazo lo nuevo: los dos botones de llamar, el código de la centralita
grande, y cada hito con quién lo dice.

---

## 4 · Medido a los dos lados

| | antes | después |
|---|---|---|
| lint | 1025 problemas · 757 errores · 268 avisos | **1025 · 757 · 268** |
| pruebas | 1604 en 105 ficheros | **1606 en 105** |
| `tsc -b` | limpio | limpio |
| `npm run build` exacto y en limpio | exit 0 | **exit 0** |

---

## 5 · Lo que queda, para la cola

1. **La captura desde la tablet** (§3).
2. **Carabanchel**, que cogerá el 306 en su ventana.
3. **El vigía que lee `app_version` en vez de `bundle_applied`** — quedó en
   `PENDIENTE` y sigue ahí: es lo que hizo que una fila pisada por un navegador
   dejara una tablet sin vigilar.
4. **La deuda «Listo sin pulsar»**: guardar QUIÉN escribió `ready_at`. Mientras
   no exista, la regla de los 2 segundos es lo mejor que se puede afirmar, y así
   está escrita en el código, con su aviso.
5. **Rotar el token de la tablet «Pase»**, que sigue pendiente desde el 16/09.
