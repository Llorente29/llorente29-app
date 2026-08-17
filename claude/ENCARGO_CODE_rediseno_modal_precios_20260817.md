# ENCARGO CODE — Rediseño de EditPricesModal (marca real)

**Fecha:** 17/08/2026
**Rama:** `claude/redesign-pricing-modal-amxuzy` (ya existe, `325e973`)
**Desbloquea:** los "dos ficheros de diseño" que pediste.

---

## 0. Antes de nada — tu entorno y la persistencia

Tu propio diagnóstico lo dejó claro: corres en un **contenedor cloud efímero**, clonas el repo por sesión y te reciclan por inactividad. Julio está 15 días en un portátil, pero **su ubicación es irrelevante**: el riesgo es tu contenedor.

Consecuencias, en firme:

1. **GitHub es la única persistencia.** Todo lo que exista se empuja a `origin` en el momento en que existe. Nada se queda en el contenedor "para el commit final".
2. `npm install` está **permitido y esperado** antes de cualquier `tsc -b` / `vite build`. No lo consultes.
3. **Los documentos del proyecto de claude.ai son INVISIBLES para ti.** Esto ya te bloqueó tres veces los días 16 y 17. Por eso este encargo trae el diseño en texto, no como referencia a un doc que no puedes abrir.
4. **Primera tarea de esta sesión:** crea en el repo `claude/folvy_sistema_visual_v1.md` y `claude/ENCARGO_CODE_rediseno_modal_precios_20260817.md` (este fichero) con el contenido pegado, commit y push. A partir de ahí el diseño vive en el repo y deja de depender de un pegado.

---

## 1. Lo que NO se toca

Bajo ningún concepto:

- `handleSave` y `handleClearLocal` de `EditPricesModal.tsx` — **la lógica está certificada**. El rediseño es de presentación.
- Nada de backend: RPC `menu_item_channel_economics`, `set_menu_item_override`, `clear_menu_item_override`, `effective_price()`.
- `hubrise-webhook` (no se despliega, ni se toca, en ninguna circunstancia).
- **Foodint Alcalá está en producción.** Nada de este encargo puede rozarla.

Ventana de despliegue: ~~nunca entre las 11:00 y las 23:45~~ → **CORREGIDA el 17/08**:
despliegues **hasta las 12:15**, prohibido **12:15 → 23:45**. Ver
`claude/folvy_protocolo_15dias_portatil.md`. El 11:00 era una estimación sin
comprobar; el dato real de ventas lo desmiente.

---

## 2. Ficha de marca — la vigente

La paleta marino/terracota/crema está **ARCHIVADA**. Lo confirmaste tú leyendo `tailwind.config.js` (donde `terracota` está retirado y apunta a tinta). La fuente de verdad es `folvy-brand-spec.md`, dirección cerrada 30/06/2026.

```
--tinta:        #15171A   texto, estructura, botón primario, chrome
--tinta-70:     #4A4E54
--tinta-45:     #868B92
--tinta-25:     #B9BDC2
--lienzo:       #F6F7F8   fondo de app
--tarjeta:      #FFFFFF
--linea:        #E9EBED
--linea-fuerte: #D6D9DC
--lavado:       #F0F1F2

--sano:    #1F9D6B   margen sano
--aprieta: #C2890F   margen ajustado
--pierde:  #E0492E   margen negativo
```

**Tesis de la ficha: «en Folvy, el color es dinero».** La única cromática fuerte de la pantalla es el margen. Todo lo demás es monocromo en tinta.

Esto tiene una consecuencia dura de diseño, y es el corazón del encargo: **los tres estados del precio hay que distinguirlos SIN color** — con estructura, trazo, relleno y posición. Nada de "verde = propio, ámbar = sin guardar". El ámbar significa una sola cosa en todo Folvy: margen apretado.

Tipografías: **Space Grotesk** (títulos, 500/600, `letter-spacing` negativo −.02/−.035em), **Inter** (interfaz), **JetBrains Mono** con `font-variant-numeric: tabular-nums` (toda cifra: precios, márgenes, porcentajes).

---

## 3. Anatomía del modal — de arriba abajo

### 3.1 Cabecera

Título "Editar precios" en Space Grotesk 17px/600. Debajo, 12,5px en `tinta-45`: `{producto} · {marca}`. Cierre ✕ en `tinta-25`.

### 3.2 Franja de ámbito — **lo más importante del rediseño**

Deja de ser "un desplegable más en el cuerpo". Es una **franja completa inmediatamente bajo la cabecera**, con dos variantes visuales:

| Ámbito | Fondo franja | Selector | Frase |
|---|---|---|---|
| Todos los locales | `--lienzo` + borde inferior `--linea` | blanco, borde `--linea-fuerte`, texto tinta | «Vale para **los N locales**.» |
| Un local | **fondo `--tinta` (oscuro)** | `#25282D`, borde `#383C42`, texto blanco | «Solo **este local**. Los demás no se tocan.» |

Etiqueta "APLICAR A" a 9,5px, `letter-spacing:.1em`, mayúsculas, 600.

El objetivo es que sea **imposible teclear un precio creyendo que aplica a los tres locales**. La franja oscura es la señal. No uses color de marca para esto — usa el contraste de la propia tinta.

### 3.3 Precio base de la marca

Fila propia con borde inferior.

- En ámbito **Todos los locales**: input editable, `SIN IVA` bajo él a 9,5px, y `PVP {x} €` calculado.
- En ámbito **un local**: input **`disabled`**, fondo `--lavado`, texto `--tinta-25`, borde transparente. Copy: «Es de toda la marca — [cámbialo en «Todos los locales»]» con el enlace subrayado en tinta 600, que **conmuta el selector de ámbito**. El título de la fila baja a `--tinta-45`.

### 3.4 Tabla de canales

Rejilla de 4 columnas: `1fr 122px 106px 56px` → **Canal · Precio (o "Precio aquí") · Margen · Disp.** Cabecera 9,5px mayúsculas `tinta-45`. La columna Precio cambia de rótulo a **"Precio aquí"** cuando el ámbito es un local.

Nombre de canal con un cuadradito de 8px `border-radius:2px` del color propio de la plataforma (Glovo `#F5C000`, Just Eat `#FF8000`, Uber Eats `#111`) — es identidad de terceros, no paleta Folvy, y por eso se permite. Bajo él, 11px `tinta-45`: `+ coste de canal est. {x} €`.

---

## 4. Los tres estados del precio — el bug que hay que matar

**Hoy "propio guardado" y "tecleado sin guardar" se ven exactamente igual.** Es el fallo que Julio detectó en sus capturas. Se resuelve así:

### Estado A — Heredado

- Input **vacío**, con `placeholder` = la cifra que hereda.
- Borde normal `--linea-fuerte`, sin peso.
- Debajo, a la derecha, 11px: **«Hereda `15,90 €`» / «precio base»** — la cifra en JetBrains Mono `tinta-70`, la procedencia en `tinta-45`.
- **Dice de dónde Y cuánto.** Si hereda de un override de marca, la segunda línea es «precio de la marca», no «precio base». Así la cascada se lee sin saber que existe una cascada.

### Estado B — Propio guardado

- Input con **valor**, borde `1.5px solid var(--tinta)`, `font-weight:600`.
- Píldora bajo el input: fondo `--lavado`, texto tinta, borde `--linea-fuerte`, 9,5px mayúsculas → **«PROPIO DE ESTE LOCAL»** (o «PRECIO PROPIO DEL CANAL» en ámbito marca).
- `PVP {x} €` calculado.
- **Botón** «↩ Volver a 15,90 €» — borde tinta 1px, fondo blanco, 11,5px/600, `border-radius:7px`, padding `6px 10px`. **Deja de ser un enlace de 10px y nombra la cifra de destino.**

### Estado C — Tecleado sin guardar

- Input con valor, borde **`1.5px dashed var(--tinta)`**, fondo `#FCFCFD`, 600.
- Píldora **invertida**: fondo `--tinta`, texto blanco → **«SIN GUARDAR»**.
- **La fila entera se marca**: fondo `#FAFBFB`, `border-left:3px solid var(--tinta)`, sangrada a los bordes del modal.
- El pie **cuenta**: «1 cambio sin guardar» en tinta 600.

Sólido vs. discontinuo, píldora clara vs. invertida, fila limpia vs. fila marcada. Tres estados, cero color.

### 4.bis — La causa real del bug, en código

`inherits` se está calculando **contra el input tecleado (`prices`), no contra el resultado del RPC**. Por eso en cuanto Julio teclea, la UI ya canta "precio de este local" aunque no haya guardado nada.

Corrección: el estado se deriva de **dos** fuentes, no de una.

```
guardado  = channels[ch].has_own_override   // del RPC, NO del input
tecleado  = prices[ch] !== (valorGuardado ?? '')

C  si tecleado
B  si !tecleado && guardado
A  si !tecleado && !guardado
```

`channels` viene de `menu_item_channel_economics` (que ya acepta `p_location_id uuid DEFAULT NULL`). Nunca infieras "tiene precio propio" del contenido de un input.

---

## 5. Columna de margen — agrupar por modo de servicio

El "canal repetido sin explicación" que Julio vio **no eran duplicados**: son las tarifas por modo de servicio. Glovo tiene tres filas reales en `channel_rate`: `own_delivery` 15 % + 0,97 €, `pickup` 15 %, `platform_delivery` 30 %. El bug es **presentacional**: la UI pinta el canal N veces sin rotular.

Presentación correcta, en una sola fila de canal:

- Rótulo del modo dominante arriba, 9px mayúsculas `tinta-45` → «REPARTO PLATAFORMA».
- Cifra grande: JetBrains Mono 16px/600, color según salud (`--sano` / `--aprieta` / `--pierde`). **Aquí, y sólo aquí, hay color.**
- Porcentaje debajo, 10,5px `tinta-45`.
- Los demás modos en un bloque `subs` separado por un `border-top`, 10,5px, `justify-content:space-between`.
- **Modo con 0 pedidos → `opacity:.42`** y la etiqueta lleva el conteo: «Reparto propio · 0 ped.»

Usa `groupChannelEconomicsByChannel()`, `SERVICE_TYPE_LABEL` y `ordersLast30d`, que ya construiste en `menuOverrideService.ts`.

⚠️ El laboratorio (Folvy Interno) sólo tiene **1 tarifa por canal**, así que allí no puedes ver el agrupado. Verifica el render contra **Foodint en SOLO LECTURA** — consulta, no escritura.

---

## 6. Columna de disponibilidad

Switch 38×22, `--sano` cuando está activo (es dinero: el producto vende). En ámbito de un local, nota bajo el switch a 9px `tinta-45` centrada: «solo en / este local».

---

## 7. Pie

- Izquierda: «Sin cambios sin guardar» en `tinta-45`, o «N cambios sin guardar» en **tinta 600** cuando los hay.
- Derecha: «Cancelar» (fantasma, `tinta-70`) + primario.
- **Guardar apagado mientras no haya nada que guardar**: fondo `--lavado`, texto `--tinta-25`, borde `--linea`. Cuando hay cambios: fondo `--tinta`, texto blanco, rótulo **«Guardar cambios»**.

---

## 8. Criterio de hecho

1. `npm install` && `tsc -b` && `vite build` limpios.
2. Los dos ficheros de diseño **commiteados en `claude/` del repo** y empujados.
3. Los tres estados distinguibles en una captura, **en escala de grises** — si al desaturar la imagen dejan de distinguirse, el diseño está mal.
4. `handleSave` y `handleClearLocal` **idénticos** al diff de partida (`git diff` debe mostrarlos sin tocar).
5. Cero cambios en migraciones, RPC o Edge Functions.
6. Verificación del agrupado de márgenes contra Foodint **en solo lectura**, con la consulta pegada en el informe.
7. Todo empujado a `origin` antes de terminar la sesión.

---

## 9. Antes de esto, un minuto

Mergea **PR #81** (certificada). **Merge normal, nunca squash** — hay tres ramas apiladas y un squash las rompe.
