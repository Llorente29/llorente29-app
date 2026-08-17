# Folvy · Sistema visual v1

**Fijado:** 17/08/2026. **Ámbito:** gobierna toda la Fase 3 (y toda pantalla nueva a partir de aquí).
**Fuente de verdad de marca:** `docs/folvy-brand-spec.md`, dirección cerrada el 30/06/2026.

> **Procedencia de este documento.** Su contenido se transcribe del §2 y §4 del
> `ENCARGO_CODE_rediseno_modal_precios_20260817.md` (mismo directorio), que trajo el
> diseño en texto porque los documentos del proyecto de claude.ai no son legibles desde
> el contenedor de Claude Code. Si el original de Julio contenía secciones que el encargo
> no reprodujo, faltan aquí y hay que añadirlas.

---

## 1. Paleta — la vigente

La paleta **marino / terracota / crema está ARCHIVADA**. Cualquier encargo, documento o
línea anterior que la mencione —incluido `folvy_hubrise_fase3_diseno.md`— queda superado.
En `tailwind.config.js` el token `terracota` está jubilado y apunta a tinta; esa migración
`terracota→accent` y sus usos legacy son **otro frente** y no se tocan desde aquí.

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

## 2. La tesis, y su consecuencia dura

> **En Folvy, el color es dinero.**

La única cromática fuerte de una pantalla es **la salud del margen**. Todo lo demás es
monocromo en tinta.

De ahí la regla que gobierna el resto del sistema:

**Ningún estado de interfaz puede resolverse con un color nuevo.** Los estados se
distinguen con **estructura**: trazo (sólido / discontinuo), relleno (claro / invertido),
peso, y posición (filete de fila, sangrado).

El ámbar significa **una sola cosa** en todo Folvy: margen apretado. No significa
"pendiente", ni "sin guardar", ni "atención". El verde significa que se gana dinero. No
significa "guardado" ni "correcto".

**Prueba de aceptación del sistema:** una captura desaturada a escala de grises debe seguir
distinguiendo todos los estados. Si al desaturar se pierden, el diseño está mal.

### Excepción única: identidad de terceros

El cuadradito de 8px que identifica una plataforma (Glovo `#F5C000`, Just Eat `#FF8000`,
Uber Eats `#111`) lleva el color de esa marca. Es identidad ajena, no paleta Folvy, y por
eso se permite. No se extiende a nada más de la fila.

## 3. Tipografía

| Rol | Familia | Detalle |
|---|---|---|
| Títulos | **Space Grotesk** | 500/600, `letter-spacing` −.02 / −.035em |
| Interfaz | **Inter** | 400/500 |
| Toda cifra | **JetBrains Mono** | `font-variant-numeric: tabular-nums` |

Tabular obligatorio en precios, márgenes y porcentajes: las columnas de cifras tienen que
alinearse al céntimo. Es la seña de la marca, no un detalle.

## 4. Patrón de los tres estados de un valor editable

Patrón general, no exclusivo del modal de precios. Aplica a cualquier campo que pueda
heredar de un ámbito superior.

**El estado se deriva de DOS fuentes, nunca de una.** Lo persistido viene del servidor; lo
tecleado vive en pantalla. Confundirlos es el bug que originó este sistema.

```
guardado = <lo que devolvió el RPC>        // NUNCA el contenido del input
tecleado = valorInput !== (valorGuardado ?? '')

C  si tecleado
B  si !tecleado && guardado
A  si !tecleado && !guardado
```

### A · Heredado
- Input **vacío**, `placeholder` = la cifra que hereda.
- Borde normal `--linea-fuerte`, sin peso.
- Debajo: **de dónde Y cuánto** — la cifra en JetBrains Mono `tinta-70`, la procedencia en
  `tinta-45`. «Hereda `15,90 €` / precio base» vs «… / precio de la marca».
- Así la cascada se lee sin necesidad de saber que existe una cascada.

### B · Propio guardado
- Input con valor, borde `1.5px solid var(--tinta)`, `font-weight:600`.
- Píldora **clara**: fondo `--lavado`, texto tinta, borde `--linea-fuerte`, 9,5px mayúsculas.
- Su acción de deshacer es un **botón** con borde tinta que **nombra la cifra de destino**,
  no un enlace diminuto.

### C · Tecleado sin guardar
- Input con valor, borde `1.5px dashed var(--tinta)`, fondo `#FCFCFD`, 600.
- Píldora **invertida**: fondo `--tinta`, texto blanco.
- **La fila entera se marca**: fondo `#FAFBFB`, `border-left:3px solid var(--tinta)`.
- El pie **cuenta**: «N cambios sin guardar».

Sólido vs. discontinuo · píldora clara vs. invertida · fila limpia vs. fila marcada.
Tres estados, cero color.

### La regla que hay detrás

**Ninguna etiqueta describe un estado persistido mientras el valor esté solo en pantalla.**
Es el mismo pecado que se persiguió todo el 16/08 en el backend: afirmar un estado que aún
no existe.

## 5. Patrón de ámbito

Cuando una pantalla escribe en un ámbito elegible (marca vs. local), el selector **no es un
campo más entre campos**: es una **franja completa** inmediatamente bajo la cabecera.

| Ámbito | Fondo | Selector | Frase |
|---|---|---|---|
| Todos | `--lienzo` + borde inferior `--linea` | blanco, borde `--linea-fuerte` | «Vale para **los N locales**.» |
| Uno | **`--tinta`** (oscuro) | `#25282D`, borde `#383C42`, texto blanco | «Solo **este local**. Los demás no se tocan.» |

Objetivo: que sea **imposible teclear creyendo que aplica a todos los locales**. La señal es
el contraste de la propia tinta, no un color de marca.

Un campo que pertenece al ámbito superior se muestra **bloqueado con su salida**: deshabilitado,
fondo `--lavado`, y un enlace que **conmuta el selector** al ámbito donde sí se puede editar.
Bloquear sin dar salida es un callejón.

## 6. Decisiones pendientes y deuda declarada

Deuda 0: ninguna deuda en silencio. Lo de abajo está también en el código, en el
punto exacto donde se decide, no solo aquí.

### 6.1 · Bandas de salud del margen — DECISIÓN INTERINA (17/08)

> `foodCostStatus === 'over'` es un sustituto interino del ámbar. No es lo mismo
> que «margen apretado»: es coste de comida por encima del objetivo. Las bandas
> de salud del margen (dónde acaba sano y empieza aprieta) son una decisión de
> diseño pendiente, no un detalle de implementación. Consecuencia asumida: hasta
> que haya escandallos, el ámbar no aparece.

Dónde vive: `marginTone()` en `EditPricesModal.tsx`. Se eligió así para **no
inventar un umbral de negocio en cliente**: los dos campos que usa (`netMargin`,
`foodCostStatus`) los calcula el servidor.

### 6.2 · Color de identidad del canal — deuda declarada (17/08)

La fuente de verdad es `sales_channel.color`. El componente ya lo lee y solo cae
a un mapa por nombre cuando viene NULL — el mapa es **fallback explícito, no
fuente de verdad**.

Estado real en BBDD a 17/08, verificado por consulta: **tres cuentas, 15 canales
vivos, 0 con color**.

| Cuenta | Canales vivos |
|---|---|
| Foodint | Glovo · JustEat · Mostrador · Shop · Uber |
| Folvy Interno | Glovo · JustEat · Mostrador · Shop · Uber |
| Kitchen Grill LstQ | Glovo · JustEat · **Salón** · Shop · Uber |

**El fallback ya falla hoy:** «Salón» (Kitchen Grill LstQ) no lo caza ninguna
regex y sale gris. Acoplar presentación al nombre que un tenant le puso a su
canal es deuda silenciosa en su forma más pura, y aparece justo en el frente de
Fase 0, **antes de admitir cliente 2**.

Disparador: poblar `sales_channel.color`. Es escritura → laboratorio primero y
con consulta de contraste delante. Hecho eso, el mapa por nombre se borra.

## 7. Norma de proceso

Recogida como **principio rector 6** en `CONTEXTO_CLAUDE.md` (commit `325e973`):
toda pantalla nueva de cara al cliente **se maqueta y se aprueba antes de construirse**.
