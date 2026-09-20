# Parte · El número del paquete no es el id de Capgo

**21/09/2026, 00:30–00:55 (Madrid).** Rama `claude/jolly-carson-exjwn3`, commit
`81fcb0b`. Cocina cerrada, fuera de la banda.

---

## 0. Lo que no pude comprobar, dicho antes

**No me llegó el parche `ota-el-numero-no-es-el-id.patch`.** No hay adjunto en el
turno ni fichero en el árbol; lo busqué en el repositorio entero, en todas las
ramas y en el disco. Tampoco está `claude/ENCARGO_CODE_la_tablet_no_coge_el_paquete_20260920.md`.

Así que **esto no es tu parche aplicado con `git am`: es un arreglo escrito de
cero contra tu diagnóstico.** Si tu parche aparece, no lo apliques encima sin
mirar: puede tocar las mismas líneas con otra forma.

Lo que sí hice antes de escribir nada fue verificar el diagnóstico en el
fichero, y es exacto.

---

## 1. La causa, y la cadena cierra sola

Capgo no guarda los paquetes por su número. Les pone un identificador **suyo**,
y no es un derivado de la versión: `CapgoUpdater.java:1316` lo genera con
`randomString()` en el momento de descargar. Ese identificador es lo único que
entiende `set()`. El número publicado —el `308` de `bundle.json`— viaja aparte,
en `version`, porque se lo pasamos nosotros al descargar.

Mientras sólo hacía falta uno, `prefetchOtaBundle` devolvía el `id` suelto y
bastaba. Desde la retención del 17/09 hacen falta los **dos**, y un `string`
suelto no dice cuál es. Se pasó el `id` donde iba el número:

```ts
// ab7026e
return String(remote.bundleId) === String(bundleId)   // "308" === "9f3c1a2b…"
```

El propio `UpdateGate.tsx:105` lo tenía escrito al lado —«id LOCAL de Capgo,
listo para set()»— y se lo pasaba igual a la comparación contra el manifiesto.

Como el id es aleatorio, **no fallaba a veces: fallaba siempre.** La respuesta
era invariablemente «ya no está publicado», y la tablet tiraba en silencio lo
que acababa de bajarse.

**La cadena, con las horas:**

| | |
|---|---|
| `ab7026e` commiteado | 17/09 **08:22** Madrid |
| `bundle-306.zip` subido | 17/09 **09:03:32** |
| las dos tablets aplican el 306 | 17/09 **09:07** y **10:04** |
| `bundle-307.zip` | 19/09 13:01 — **no entró** |
| `bundle-308.zip` | 20/09 11:45 — **no entró** |

El 306 pudo entrar porque el paquete **anterior** todavía no llevaba la
comprobación. Del 306 en adelante quedaron sordas. Encaja hasta el minuto.

---

## 2. El arreglo

No es cambiar la comparación: es que no se pueda volver a confundir.

`prefetchOtaBundle` ya no devuelve un `string`. Devuelve `PaqueteDescargado`,
con los dos campos y su nombre puesto:

```ts
export interface PaqueteDescargado {
  id: string      // identificador LOCAL de Capgo. Lo ÚNICO que acepta set().
  numero: number  // el número de bundle.json. Lo ÚNICO que se compara.
}
```

y `sigueEstandoPublicado(numeroDescargado: number)`. El comprobador de tipos no
distingue dos cadenas, pero sí dos campos: **pasar el id donde va el número
ahora no compila.**

`UpdateGate` guarda los dos y usa cada uno en su sitio: `otaPaquete.numero` para
mirar el manifiesto, `otaPaquete.id` para `set()`.

### Medido a los dos lados, con la misma vara

| | antes | después |
|---|---|---|
| pruebas | 1.633 en 106 ficheros | **1.642 en 107** (+9, las nuevas) |
| lint | 1.377 problemas / 1.077 errores | **1.377 / 1.077**, idéntico |
| `npm run build` exacto, borrando los `*.tsbuildinfo` | verde | **verde** |

Y la prueba nueva **contra el código viejo**: 2 de 9 en rojo, justo las dos que
miden el fallo. Contra el arreglado, 9 verdes. No es un espejo.

---

## 3. 🔴 Bloqueado: no puedo fusionar a `main`

`git push origin main` lo **denegó la pasarela del entorno** («Production
Deploy»). No es un fallo del trabajo: es el permiso. El arreglo está commiteado
y empujado a la rama, la fusión sería un avance rápido de dos commits
(`2a97027` + `81fcb0b`) y el árbol ya tiene el build verde.

**Hace falta que lo autorices o que lo hagas tú.** Sin eso, los pasos 2 a 5 no
pueden empezar.

---

## 4. Dos correcciones al plan, y las dos cambian lo que se puede esperar

### 4a. No son tres tablets: son **dos**

`Pase` es `platform: web` — corre en navegador y su código le llega por **Vercel,
no por OTA**. Su `bundle_applied: 306` es un valor viejo de cuando era la APK; su
`app_version` dice `web` y se reselló hoy a las 00:08.

Las que toman paquetes son `Cocina` (Alcalá) y `Tablet camichi4` (Carabanchel),
las dos `android`, las dos en `1.0.49 (49) · bundle 306`.

**Si el paso 5 espera a que las TRES enseñen el número nuevo, espera para
siempre** — y espera con el manifiesto retirado, que es justo el estado que
avisaste que es peligroso. La condición son las dos Android.

### 4b. 🔴 Alcalá no puede aplicar **ningún** paquete hoy

Hoy es **lunes**. Medido con `extract(dow …)`, que es la misma vara que usa
`_ventana_de_mantenimiento`:

| local | tramos declarados hoy | días con horario | ventas en lunes (60 d) |
|---|---|---|---|
| **Foodint Alcalá** | **0** | 0,2,3,4,5,6 — **falta el 1** | **330** |
| Foodint Carabanchel | 2 | 0,1,2,3,4,5,6 | 180 |

`sePuedeAplicarAhora` exige `enVentana === true && safe === true`. Alcalá da
`en_ventana: false`, motivo `sin_horario_declarado_hoy`. No es que la ventana
esté cerrada: **hoy no existe.**

Y `[force-update]` **no la abre**: `urgente` sólo cuenta dentro de
`lasDos && (tabletLibre || urgente)`, y `lasDos` ya es falso.

Salidas, y son las tres que hay:

1. **Declarar el lunes** en `business_hours` de Alcalá. Una fila. Es producción
   y es tuya.
2. **Alguien pulsa «Instalar ahora»** en la tablet de Alcalá. `instalarYa` es lo
   único que se salta la ventana. Es una persona en el local, y tienes que
   saberlo tú, no descubrirlo.
3. **Esperar a mañana martes**, que sí tiene horario.

Esto estaba en la cola como deuda. Hoy no es deuda: es el tapón del paso 4.

---

## 5. Por qué el truco del manifiesto funciona, y cuánto margen hay

Las tablets corren el **306**, que lleva el fallo. Cualquier paquete nuevo lo
descartarían igual. El truco es el hueco que deja el propio código viejo:

```ts
if (!resp.ok) return true    // no contesta → no se sabe → adelante
```

Retirar `bundle.json` da un 404 → `resp.ok` falso → **aplica**. Por eso el orden
es: publicar, dejar que se lo bajen, **luego** retirar.

Y hay margen de sobra, no por suerte: la ventana está cerrada. Ahora mismo

| | Cocina (Alcalá) | camichi4 (Carabanchel) |
|---|---|---|
| `en_ventana` | **false** (sin horario hoy) | true, hasta **12:45** |
| `safe` | false | false |
| `active_orders` | 9 | 8 |
| última venta | hace 52 min | hace 80 min |

`active_orders` cuenta pedidos sin terminar de las **últimas 12 horas**, así que
se vacía solo. El más nuevo de Carabanchel es de las 23:12 → llega a cero sobre
las **11:12**, y su ventana se cierra a las 12:45. Ahí está el hueco real:
**~1 h 30 esta mañana, y sólo para Carabanchel.**

O sea que hay horas para retirar el manifiesto con calma, no sesenta segundos.
Pero **tiene que estar retirado antes de las ~11:12**, o Carabanchel descartará
el paquete y no lo volverá a buscar: `otaCheckedRemote` ya tendrá ese número
apuntado y el ciclo de 15 min no vuelve a descargarlo hasta reiniciar la app.

---

## 6. Al margen, visto de paso y sin abrir nada

**70 ventas `open`**, la más vieja del **15/08**: 52 en Carabanchel, 18 en
Alcalá. Sólo 8 y 9 entran en el conteo de 12 h, así que no atascan la ventana
más allá de esta noche — pero ahí están.

---

## 7. Lo que queda, en orden

1. 🔴 **Tu visto para fusionar** — está bloqueado por permiso, no por el trabajo.
2. Fusionar → sale el paquete **309**.
3. Esperar ~30 min a que las dos se lo bajen.
4. Retirar `bundle.json`, **antes de las 11:12**.
5. Carabanchel entra entre las ~11:12 y las 12:45. **Alcalá no, hoy no puede.**
6. Reponer `bundle.json` en cuanto Carabanchel enseñe el 309.
7. Papel de verdad: una pegatina y un ticket impresos y mirados.

**Nada de esto toca producción sin tu sí.**
