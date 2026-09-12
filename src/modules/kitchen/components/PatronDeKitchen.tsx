// src/modules/kitchen/components/PatronDeKitchen.tsx
//
// B79 lote 4. Las dos piezas que comparten las tres pantallas del patrón de
// Casado: la CIFRA con nombre humano y el CAMPO de la cabecera.
//
// POR QUÉ SE EXTRAEN. El patrón dice «una pregunta arriba, cinco cifras con
// nombre humano y nada más encima del contenido», y con tres pantallas escritas
// había tres copias del mismo marcado. Tres copias es una pantalla que se
// desalinea de las otras el día que alguien retoque una clase «para mejorarlo» —
// y entonces el principio 3, «aprender una es aprender todas», deja de ser cierto.
//
// EL MARCADO NO CAMBIA. Está copiado LETRA A LETRA del que ya tenía Rentabilidad,
// y hay una prueba (`patronDeKitchen.test.tsx`) que lo fija: si alguien cambia
// una clase, se pone roja antes de llegar a la pantalla de nadie. Es el mismo
// contrato que Julio puso al extraer `KpiCard`: «si algo cambia de aspecto, es un
// fallo del refactor, no una mejora».

import type { ReactNode } from 'react'

// Los tokens viajan CON el patrón, no con cada pantalla. El TPV los importa en
// su página y funciona porque es una sola; aquí van a ser varias, y una que se
// olvide de importarlos no se rompe: se pinta sin color, que es peor.
import '@/modules/kitchen/estilo/cocinaTokens.css'

/** Un campo de la cabecera: su etiqueta pequeña en mayúsculas y el control debajo. */
export function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-text-secondary">{label}</span>
      {children}
    </label>
  )
}

/**
 * Una de las cinco cifras. `pie` es obligatorio a propósito: una cifra sin la
 * frase que dice de qué es no cumple el patrón — es un número sin dueño.
 *
 * `alerta` pinta el número en rojo. Es para lo que hay que arreglar, no para lo
 * que va mal: un food cost alto no es una alerta, es un dato.
 */
export function Cifra({
  titulo, valor, pie, alerta,
}: { titulo: string; valor: string; pie: string; alerta?: boolean }) {
  return (
    <div className="bg-card border border-border-default rounded-lg p-3">
      <div className="text-[11px] text-text-secondary">{titulo}</div>
      <div className={`text-2xl font-semibold mt-0.5 ${alerta ? 'text-danger' : 'text-text-primary'}`}>{valor}</div>
      <div className="text-[11px] text-text-secondary mt-1 leading-snug">{pie}</div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// EL ESTÁNDAR NUEVO (§9 del encargo de Extras, 07/09) — «limpio y pro»
// ══════════════════════════════════════════════════════════════════════════
//
// COPIADO de `build.py::CSS` de la maqueta aprobada, no adaptado (§9.1). Cada
// pieza dice de qué clase de la maqueta sale, para que comparar sea leer.
//
// Las dos piezas de arriba se quedan COMO ESTÁN, y no por cariño: las usan el
// Resumen y Rentabilidad, y el §9.2 dice que esas pantallas pasan al estándar
// nuevo **en el lote siguiente, con captura al lado de la maqueta**. Si les
// cambiara la cifra hoy cambiarían de aspecto sin esa comprobación y a medias:
// cifras nuevas sobre el resto del marcado viejo, que es peor que no tocarlas.
//
// DEUDA CON FECHA DE CIERRE: cuando las tres pantallas de B79 pasen, `Campo` y
// `Cifra` de arriba se borran y estas se quedan solas.
//
// Todo esto pinta con los tokens de `cocinaTokens.css`, que sólo existen
// dentro de `.cocina`. Fuera de esa clase sale sin color: es a propósito —
// obliga a envolver la pantalla, que es lo que hace la migración explícita en
// vez de silenciosa.

/**
 * `.sel` de la maqueta: el campo de la cabecera, con su etiqueta dentro y la
 * FLECHA al final. La flecha no es adorno: sin ella el campo parece una
 * etiqueta y nadie descubre que se abre.
 */
export function CampoCocina({ label, children }: { label: string; children: ReactNode }) {
  return (
    // B84.2 · UNA SOLA FLECHA. El `<select>` de dentro trae la suya del sistema
    // y aquí se dibuja la de la maqueta: salían las dos, una al lado de otra.
    // `appearance-none` se aplica desde fuera, al select hijo, para que ninguna
    // pantalla tenga que acordarse de ponerlo.
    <label className="inline-flex items-center gap-2 h-9 px-3 border border-cocina-linea bg-cocina-superficie rounded-cocina text-[13px] font-medium text-cocina-tinta cursor-pointer [&>select]:appearance-none [&>select]:bg-transparent [&>select]:outline-none [&>select]:cursor-pointer">
      <span className="text-[10.5px] font-bold tracking-[0.06em] uppercase text-cocina-tinta-3">{label}</span>
      {children}
      {/* La misma que la maqueta: 14×14, trazo 1.8, sin relleno. */}
      <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 shrink-0 stroke-cocina-tinta-3 fill-none" strokeWidth={1.8}>
        <path d="M4 6l4 4 4-4" />
      </svg>
    </label>
  )
}

/**
 * `.kpis` de la maqueta: las cinco cifras son UNA rejilla con separaciones de
 * 1 px sobre el color de línea, no cinco tarjetas sueltas con hueco. Es la
 * diferencia que más se ve de lejos, y la que yo había hecho mal al deducirla
 * de la captura.
 */
export function CifrasCocina({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-5 gap-px bg-cocina-linea-suave border border-cocina-linea rounded-cocina-md overflow-hidden shadow-cocina">
      {children}
    </div>
  )
}

/**
 * `.kpi` de la maqueta. El pie es obligatorio por lo mismo de siempre: una
 * cifra sin la frase que dice de qué es no cumple el patrón. Y aquí se vio hoy
 * mismo: «en 18 marcas» bajo los 120 extras contaba las marcas de la cuenta,
 * no las de los extras. El pie es donde se caza eso.
 */
export function CifraCocina({
  titulo, valor, sufijo, pie, tono,
}: {
  titulo: string
  valor: string
  /** Lo pequeño que va pegado al número: «€», «de 120». */
  sufijo?: string
  pie: ReactNode
  /** `aviso` es el `.kpi.flag` de la maqueta: algo que mirar, no algo roto. */
  tono?: 'malo' | 'bueno' | 'aviso'
}) {
  const color = tono === 'malo' ? 'text-cocina-rojo'
    : tono === 'bueno' ? 'text-cocina-verde'
    : tono === 'aviso' ? 'text-cocina-ambar'
    : ''
  return (
    <div className="bg-cocina-superficie px-4 pt-3.5 pb-3 flex flex-col gap-1 min-h-[96px]">
      <div className="text-[12px] font-semibold text-cocina-tinta-2">{titulo}</div>
      <div className={`num text-[28px] font-bold tracking-[-0.02em] leading-[1.1] ${color}`}>
        {valor}
        {sufijo && <small className="text-[14px] font-medium text-cocina-tinta-3 tracking-normal ml-[3px]">{sufijo}</small>}
      </div>
      <div className="text-[11.5px] text-cocina-tinta-3 leading-[1.4]">{pie}</div>
    </div>
  )
}

/** `.pill` de la maqueta. Cuatro tonos, los de la hoja de estilo. */
export function PastillaCocina({
  tono, children,
}: { tono: 'rojo' | 'verde' | 'ambar' | 'apagado'; children: ReactNode }) {
  const clases = {
    rojo:     'bg-cocina-rojo-bg text-cocina-rojo',
    verde:    'bg-cocina-verde-bg text-cocina-verde',
    ambar:    'bg-cocina-ambar-bg text-cocina-ambar',
    apagado:  'bg-cocina-superficie-2 text-cocina-tinta-3',
  }[tono]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-cocina px-2 py-[3px] text-[11px] font-semibold tracking-[0.02em] whitespace-nowrap ${clases}`}>
      {children}
    </span>
  )
}

/** `.btn` de la maqueta: 34 px, tres pesos. */
export function BotonCocina({
  peso = 'relleno', disabled, onClick, children, type = 'button',
}: {
  peso?: 'relleno' | 'borde' | 'fantasma' | 'aviso'
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
  type?: 'button' | 'submit'
}) {
  const clases = {
    relleno:  'border-cocina-acento bg-cocina-acento text-white',
    borde:    'border-cocina-acento bg-cocina-superficie text-cocina-acento-ink',
    fantasma: 'border-cocina-linea bg-transparent text-cocina-tinta-2',
    // `aviso`: el siguiente paso que NO es aprobar. Tiene que verse sin pensar
    // y no puede confundirse con el botón que aplica (11/09/2026).
    aviso:    'border-cocina-ambar bg-cocina-ambar-bg text-cocina-ambar',
  }[peso]
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center h-[34px] px-[13px] rounded-cocina border text-[12.5px] font-semibold whitespace-nowrap transition-base disabled:opacity-45 disabled:cursor-not-allowed ${clases}`}
    >
      {children}
    </button>
  )
}

/** `.chip` de la maqueta: el orden de la lista, donde `on` es el elegido. */
export function ChipCocina({
  activo, onClick, children,
}: { activo?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[12px] px-2.5 py-[5px] rounded-cocina border transition-base ${
        activo
          ? 'bg-cocina-acento-bg border-cocina-acento text-cocina-acento-ink font-semibold'
          : 'bg-cocina-superficie border-cocina-linea text-cocina-tinta-2'
      }`}
    >
      {children}
    </button>
  )
}

/** `.toggle` de la maqueta: el filtro que es la acción. */
export function InterruptorCocina({
  activo, onChange, children,
}: { activo: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!activo)}
      className="inline-flex items-center gap-[9px] text-[13px] font-semibold text-cocina-tinta"
    >
      <span className={`relative inline-block w-[34px] h-5 rounded-[10px] transition-base ${activo ? 'bg-cocina-acento' : 'bg-cocina-linea'}`}>
        <span className={`absolute top-[3px] w-3.5 h-3.5 rounded-[7px] bg-white transition-base ${activo ? 'right-[3px]' : 'left-[3px]'}`} />
      </span>
      {children}
    </button>
  )
}

/**
 * `.head` + `h1` + `.rule` de la maqueta: la pregunta y, debajo, la línea que
 * dice QUÉ se está contando, en castellano de persona. No es un subtítulo
 * decorativo: es la lección de B83, donde las cinco filas del Resumen pintaban
 * `price_impact > 0` en cursiva.
 */
export function CabeceraCocina({
  migaja, pregunta, regla, children,
}: { migaja?: string; pregunta: string; regla: ReactNode; children?: ReactNode }) {
  return (
    // 14 px entre la migaja y el título: en la maqueta son dos hijos de `.main`,
    // que separa a 14. Aquí van juntos en la cabecera, así que la separación hay
    // que ponerla, no heredarla — sin ella todo lo de abajo subía 14 px.
    <div className="flex flex-col gap-3.5">
      {migaja && (
        <div className="text-[11px] text-cocina-tinta-3 tracking-[0.08em] uppercase font-bold">{migaja}</div>
      )}
      <div className="flex justify-between items-end gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[24px] font-bold tracking-[-0.015em] leading-[1.2] mt-1 text-cocina-tinta">{pregunta}</h1>
          <p className="text-[12.5px] text-cocina-tinta-2 mt-1.5 leading-[1.5]">{regla}</p>
        </div>
        {children && <div className="flex gap-2 items-center shrink-0 flex-none">{children}</div>}
      </div>
    </div>
  )
}

/**
 * `.ok` de la maqueta: LO QUE HA PASADO, en verde y con contenido.
 *
 * Regla 8: un botón que hace algo importante confirma en pantalla, y la
 * confirmación lleva contenido —«Salsa Yogur lleva 40 g de yogur griego: 0,18 €.
 * Aplicado a 7 copias…»—, no un visto. Va aquí y no suelta en una página para
 * que la siguiente pantalla que confirme algo no invente su propia caja verde.
 */
export function AvisoCocina({ children, onCerrar }: { children: ReactNode; onCerrar?: () => void }) {
  return (
    <div className="rounded-cocina px-3.5 py-3 text-[13px] bg-cocina-verde-bg text-cocina-verde border border-cocina-verde/35 flex items-start justify-between gap-3">
      <span>{children}</span>
      {onCerrar && (
        <button type="button" onClick={onCerrar} className="shrink-0 opacity-70 hover:opacity-100">✕</button>
      )}
    </div>
  )
}

/**
 * `.qh` de la maqueta: la cabecera de un BLOQUE dentro del panel — el nombre en
 * 14 px negrita y, al lado y en pequeño, qué agrupa. Al lado, no en la otra
 * punta: la descripción explica el nombre, y separarlos los convierte en dos
 * cosas distintas.
 *
 * POR QUÉ SE EXTRAE, y es la lección de siempre: había CUATRO copias de una
 * cabecera de bloque y sólo la de Extras estaba bien. Rentabilidad e Ingeniería
 * habían escrito la suya con el marcado de `.panel-h` —11 px, versalitas,
 * separadas a los extremos— que en la maqueta es otra pieza para otra cosa.
 * Nadie lo habría visto nunca comparando su pantalla consigo misma.
 */
/**
 * `.banner` de la maqueta: la franja de arriba que enmarca la pantalla.
 *
 * NO es `AvisoCocina`. Esa es `.ok`, verde, y dice LO QUE ACABA DE PASAR
 * (regla 8). Ésta es el estado de fondo con el que se entra: qué hay sobre la
 * mesa antes de tocar nada. Mezclarlas haría que un estado permanente se leyera
 * como una confirmación, y al revés.
 *
 * El botón es OPCIONAL a propósito: en el tablero 1 de Modificadores la franja
 * nace sin él porque su destino —el tablero 7— llega en el paquete 3. Un botón
 * sin destino no se pinta (regla 35), pero la franja sí: la cifra que enmarca
 * la pantalla no espera a que exista el sitio adonde lleva.
 */
export function FranjaCocina({
  tono = 'aviso', titulo, detalle, children,
}: {
  tono?: 'aviso' | 'malo' | 'info'
  titulo: ReactNode
  detalle: ReactNode
  children?: ReactNode
}) {
  const clases = {
    aviso: 'border-cocina-ambar bg-cocina-ambar-bg',
    malo:  'border-cocina-rojo bg-cocina-rojo-bg',
    info:  'border-cocina-acento bg-cocina-acento-bg',
  }[tono]
  return (
    <div className={`flex gap-4 items-center justify-between px-4 py-3.5 rounded-cocina-md border ${clases}`}>
      <div className="min-w-0">
        <div className="text-[13.5px] font-bold text-cocina-tinta">{titulo}</div>
        <div className="text-[12.5px] text-cocina-tinta-2 mt-[3px] leading-[1.5]">{detalle}</div>
      </div>
      {children && <div className="flex gap-2 items-center shrink-0">{children}</div>}
    </div>
  )
}

export function CabeceraDeBloque({
  nombre, detalle,
}: { nombre: ReactNode; detalle?: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2.5 px-4 pt-3 pb-2 border-b border-cocina-linea-suave bg-cocina-superficie-2">
      <span className="text-[14px] font-bold text-cocina-tinta">{nombre}</span>
      {detalle && <span className="text-[12px] text-cocina-tinta-3">{detalle}</span>}
    </div>
  )
}

/**
 * `.panel-h` de la maqueta: el rótulo del panel entero, en versalitas pequeñas y
 * con lo de la derecha en la otra punta. Es la pieza de «esta tabla va ordenada
 * así», no la de «este bloque agrupa esto» — para eso está `CabeceraDeBloque`.
 *
 * Sin fondo, como la maqueta: `.panel-h` no tiene `background`. El fondo gris
 * es de `.qh` y de las cabeceras de columna, y ponérselo aquí hacía que el
 * rótulo pesara lo mismo que una fila de datos.
 */
export function RotuloDePanel({
  children, derecha,
}: { children: ReactNode; derecha?: ReactNode }) {
  return (
    <div className="flex justify-between items-center gap-3 px-4 py-2.5 border-b border-cocina-linea-suave text-[11px] font-bold tracking-[0.09em] uppercase text-cocina-tinta-3">
      <span>{children}</span>
      {derecha && <span>{derecha}</span>}
    </div>
  )
}

/** `.panel` de la maqueta: la caja de la tabla. */
export function PanelCocina({ children }: { children: ReactNode }) {
  return (
    <div className="bg-cocina-superficie border border-cocina-linea rounded-cocina-md shadow-cocina">
      {children}
    </div>
  )
}
