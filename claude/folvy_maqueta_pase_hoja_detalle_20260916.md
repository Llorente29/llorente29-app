# La hoja de detalle del Pase, contra la maqueta aprobada — 16/09/2026, 23:35

Respuesta al encargo de las 23:05. El paquete **305 está retenido** y las tres
tablets siguen en el 303; nada de esto ha llegado a ninguna pantalla de local.

---

## 0 · La retención, con la prueba delante

| | |
|---|---|
| lo que ven las tablets (`apps/bundle.json`) | **no existe** → no hay actualización que ofrecer |
| `_ultimo_bundle_publicado()` | **303** |
| retenido, no borrado | `retenido-20260916/bundle.json` · `retenido-20260916/bundle-305.zip` |
| las tres tablets | Cocina 303 · Pase 303 · camichi4 303 |

Sin manifiesto, `checkForBundleUpdate()` ve `resp.ok = false` y devuelve `null`
(`appUpdate.ts:325`): no descarga, no reintenta y no sale nada en pantalla. El
zip sale también del patrón `^bundle-\d+\.zip$` para que
`kds_device_stale_bundle_check` no invente mañana una alerta de «tablet con
código viejo» por un paquete retenido a propósito.

**Vuelta atrás:** las dos mismas líneas con los nombres al revés.

🔴 **Mientras dure la retención no se empuja código a `main`.** `build-apk.yml`
publica un `bundle.json` nuevo en CUALQUIER push que no sea `docs/**`, `**/*.md`
o `supabase/**` — o sea que un `.png` en `claude/` levantaría la retención solo.
Por eso las capturas van por el chat y no al repositorio.

---

## 1 · 🔴 Y una que causé yo con el enlace de las 22:40

La fila de la tablet «Pase» decía `platform: web`, `app_version: web`, escrito a
las **23:15:26**. Lo hace `reportAppVersion()` (`appUpdate.ts:271`): cuando no
es la app nativa manda `version='web'` y `platform='web'`, y **pisa la fila del
aparato de verdad**. Yo dije que abrir `/estacion` desde un ordenador sólo
falseaba el latido. Falseaba también esto, y es peor: `kds_device_stale_bundle_check`
lee `app_version` para sacar «· bundle N», y con `'web'` cae en la rama de «no se
ha podido leer qué versión corre: **este aparato NO está vigilado**».

Restaurado a `android` / `1.0.49 (49) · bundle 303`, con `app_version_at` en
08:30:47. **Es una reconstrucción y va dicho:** `bundle_applied` = 303 quedó
intacto (el navegador no lo toca) y las otras dos tablets cogieron el mismo
bundle esa misma mañana --08:30:39 y 08:30:49-- y reportan esa versión exacta.
No se arregla solo: `reportAppVersion` sólo corre al ARRANCAR, y estas tablets
llevan desde las 08:30 sin reiniciarse a propósito.

Comprobado después: las tres filas vuelven a dar `303` al regex del vigía.

**Deuda nueva:** ni el latido ni el reporte de versión tienen puerta de
plataforma. Mientras no la tengan, abrir `/estacion` desde un ordenador
**deteriora la fila del aparato**, no sólo la observa. El arreglo son tres
líneas --no reportar versión si `Capacitor.isNativePlatform()` es falso y el
aparato ya consta como android-- pero vive en el front, o sea en un bundle, o
sea detrás de la retención. Y la solución de verdad sigue siendo D14.

---

## 2 · Lo que se ha construido

| pieza | fichero | qué es |
|---|---|---|
| la lógica | `src/modules/pase/lib/laFicha.ts` | qué se puede llamar, qué no y POR QUÉ no. Sin pintar nada. |
| la hoja | `src/modules/pase/components/HojaDelPase.tsx` | el panel que sube desde abajo. |
| los datos | `supabase/migrations/20260916234500_la_hoja_de_detalle_del_pase.sql` | `pase_ficha(token, venta)`. |
| la puerta | `paseService.getFicha` | a demanda, nunca en el bucle del tablero. |
| la tarjeta | `PaseBoard.tsx` | pastilla, código corto, toque para abrir, y lo demás fuera. |
| las pruebas | `tests/unit/modules/pase/laFicha.test.ts` | 22, contra la población real. |

**`pase_ficha` NO va dentro de `pase_board`**: el tablero se pregunta cada diez
segundos en tres tablets, y ahí viajarían teléfonos de cliente de veinte pedidos
para enseñar los de uno.

**Devuelve datos, no frases.** El encargo pedía que la RPC mandara también
`quien_lo_lleva` y `cliente_explicacion`; no se hace, por la razón que ya está
escrita en `lasTresZonas.ts` para `quien_lo_lleva`: son FRASES, `quienLoLleva()`
ya las arma, y la misma regla en dos sitios es una regla que un día dice dos
cosas — y entonces la tarjeta y la hoja discrepan del mismo pedido. La única que
sí viaja armada es `cliente_marcacion`, porque no es una frase: es lo que se
marca, y si dos sitios lo arman con pausas distintas la llamada falla en la mano
de quien está sirviendo.

---

## 3 · Lo que la población real me corrigió (regla 31)

Medido el 16/09 sobre 14 días de Foodint, 1.669 ventas no anuladas:

| origen · canal · servicio | n | tel. rider | tel. cliente | código | dirección |
|---|---|---|---|---|---|
| Last · Glovo · plataforma | 844 | 0 | **0** | 0 | 0 |
| Last · Uber · plataforma | 350 | 0 | 350 | **350** | 0 |
| HubRise · Glovo · **nuestro** | 222 | **215** | 221 | 0 | 218 |
| HubRise · Uber · plataforma | 179 | 0 | 179 | **179** | 0 |
| HubRise · Glovo · plataforma | 41 | 0 | **0** | 0 | 0 |
| Last · JustEat · plataforma | 12 | 0 | 12 | **12** | 0 |
| HubRise · JustEat · **nuestro** | 6 | 6 | 6 | **6** | 6 |
| Last · JustEat · nuestro | 4 | 0 | 4 | **4** | 4 |
| recogidas | 11 | 0 | 6 | 6 | 0 |

Tres cosas que la maqueta del 14/09 no sabía:

1. **JustEat también es centralita con código**, 22 de 22. La maqueta sólo
   nombraba a Uber. El discriminador que he escrito es **tener código**, no ser
   Uber: hoy coinciden, pero el día que Glovo dé centralita o Uber deje de
   darla, manda el dato y la frase no se queda mintiendo.
2. **Siete repartos nuestros con flota traen nombre de repartidor y NO traen su
   teléfono** (215 de 222 + 6 de 6). Ese caso existe y ahora se dice --«Lo lleva
   Marta, pero de este pedido no nos ha llegado su teléfono»-- en vez de pintar
   un botón que no marca nada. Es la captura 8.
3. **No existe ningún campo de ALERGIAS.** Ni en `sale` ni en `sale_line`. La
   maqueta pedía «notas y alergias»; lo que hay es `sale.customer_note` --84 en
   14 días, y **ninguna** menciona una alergia-- y `sale_line.kitchen_note`, que
   está vacía en las **4.968** líneas del periodo. La hoja enseña la nota y dice
   que no llegan alergias. No se inventa una sección que estaría siempre vacía.

Y una prueba cazó un error de verdad antes de salir: con `quienReparte()`, la
frase de la centralita de `J191403139` --JustEat repartido por nosotros-- salía
**«nosotros da un número único para todos»**, que además de mal escrito es falso:
la centralita es de JustEat. Manda el CANAL, no quien reparte. Con ejemplos
inventados habría pasado en verde.

---

## 4 · Las capturas, contra la maqueta del 14/09

Todas a **1024 × 600** (el marco negro es el borde de la tablet), con los
componentes de verdad y los pedidos reales de Alcalá de esta noche. El reloj va
congelado a las **22:15**, en plena cena: con la hora real los minutos de espera
saldrían disparados y no se vería lo que ve el del pase.

| # | qué es | contra la maqueta |
|---|---|---|
| 1 | **Sigue aquí** | Pastilla al lado del nombre --«NOSOTROS» verde, «GLOVO» gris--, código corto con flecha en la esquina, y la bolsa rota en rojo con **«Reimprimir» en lugar de «Listo»**. ✔ |
| 2 | **En ruta** | «Sólo lo que sabemos que ha salido. Aquí no se pulsa nada.» ✔ |
| 3 | **Entregados** | «Sólo lo que sabemos que ha llegado. Se vacía sola.» ✔ |
| 4 | Hoja · **G805**, nuestro con flota | Los dos botones, la dirección y las notas. ✔ |
| 5 | Hoja · **U987F2**, Uber por HubRise | Centralita: el número escrito y el código **567 30 308** grande en ámbar. ✔ |
| 6 | Hoja · **G858**, Glovo por Glovo | Ni un hueco: dos recuadros que dicen por qué no hay ningún teléfono. ✔ |
| 7 | Hoja · **J191403139**, JustEat con flota | El caso completo: repartidor nuestro + centralita del canal. |
| 8 | Hoja · flota **sin teléfono** | Los siete de la tabla. |

### Lo que cambié sin preguntar, y por qué

- **La frase de «Sigue aquí»**: de «Lo que todavía está en la cocina. Un toque y
  se va.» a **«Lo que todavía está en el local.»**, que es tu propuesta. La
  anterior describía un comportamiento que dejó de existir con la opción A.
- **Dos columnas en la hoja, en apaisado.** Con una sola, en 1024 × 600 la hoja
  llegaba hasta «Dirección» y había que **arrastrar** para ver las notas y el
  botón de reimprimir. Una pantalla que se abre con la bolsa en una mano no se
  arrastra: o cabe, o no está. Se vio en la maqueta, no se supuso. En vertical
  vuelve a una columna.
- **El logo de la hoja, con el mismo respaldo que la tarjeta.** La primera
  versión pintaba un icono de imagen rota; ahora pone las iniciales en un
  recuadro discontinuo, que es un hueco a la vista y no un fallo.
- **Con la bolsa rota no hay «Listo»**, sale «Reimprimir» en su lugar. Lo dice
  la maqueta y además la propia tarjeta ya lo afirmaba dos líneas más arriba:
  sin etiqueta la bolsa no se puede dar. Hasta hoy la pantalla se contradecía
  ofreciendo las dos cosas.

### Lo que todavía difiere, y lo digo yo

1. **🔴 El pie de «Cerrar a mano» sigue sin salir en la tablet.** El componente
   lo tiene entero (`PaseBoard.tsx:526`) pero sólo se pinta si le pasan
   `onCerrarAMano`, y `TabletStationRoute.tsx:305` monta el `PaseBoard` sin esa
   prop. **No lo he conectado porque no existe a dónde conectarlo**: cerrar a
   mano pide un motivo y una RPC que no está escrita, y eso es una pieza nueva,
   no un cable suelto. Dime si la quieres y la hago; inventarme el flujo yo, no.
2. **Los logos no cargan en las capturas.** Viven en `supabase.co` y esta
   máquina no llega. En la tablet cargan; lo que se ve en la captura es el
   respaldo de iniciales.
3. **En la tablet caben tres tarjetas por pantalla**, no seis. La captura 1 lo
   enseña tal cual: se ve donde se corta. Con 17 pedidos abiertos eso son cinco
   arrastres. No es nuevo --es así desde el 14/09-- pero ahora se ve medido.
4. **La bolsa rota es el único caso COMPUESTO de toda la maqueta.** Esta noche
   no falló ninguna impresora, así que se toma un pedido real y se le pone el
   estado con tres intentos. Va dicho, no colado.
5. **Los tonos de la centralita no están verificados.** Ni con Uber ni con
   JustEat. Por eso el código va escrito y grande además de ir en la marcación:
   hasta la llamada de prueba desde la tablet de Alcalá, la persona tiene que
   poder teclearlo.
6. **`G292` no es un pedido de flota.** El encargo lo pedía como ejemplo de
   nuestro reparto y es Glovo repartido por Glovo (`platform_delivery`, sin
   rider). Y `G292` aparece **nueve veces** en 14 días: el código corto se
   repite, así que la hoja se pide por `sale_id`, nunca por código.
7. **🔴 `G805`, el de la captura 4, es de CARABANCHEL, no de Alcalá.** Lo cacé
   al ensayar la RPC: con el token de la tablet de Alcalá, `pase_ficha` lo
   rechazó con «ese pedido no es de este local». O sea que la guarda funciona
   --y se probó sola, con un pedido real de otro local, no con un caso
   inventado-- pero la captura 4 enseña un pedido que esa tablet no puede
   abrir. Los de flota de Alcalá de esta noche son **G161**, **G918**,
   **J191403139**, **G853** y **G064**. Si apruebas, rehago esa captura con
   G161; el comportamiento que enseña es el mismo.
8. **La centralita de JustEat no es la de Uber.** En la maqueta puse el mismo
   número para los dos; en la base, `J191403139` marca `tel:+34910381…` y
   U987F2 `tel:+34910780961`. El código es correcto en las dos.

---

## 5 · Lo que falta para publicar

1. Tú apruebas o corriges estas ocho.
2. Se aplica `pase_ficha` (fuera de banda: función nueva, **0** funciones, **0**
   crons y **0** disparadores la llaman — contado, no supuesto).
3. `npm run build` exacto y en limpio, paquete OTA nuevo desde ese commit,
   READY comprobado en Vercel y **se suelta la retención**.

Y lo del §4 de tu encargo sigue intacto: el cierre al entregar, la recogida y la
entrega de Uber, la guarda del consumo y los «Listo». Nada de esta noche los ha
tocado.
