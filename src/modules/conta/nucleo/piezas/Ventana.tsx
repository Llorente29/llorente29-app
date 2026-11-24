// src/modules/conta/nucleo/piezas/Ventana.tsx
//
// K12 · Piezas comunes de ERP10 (concepto_erp10_en_todo_sumied.md), 1 a 4: la ventana del documento (su título como
// en ERP10 y la pestaña abajo), la barra (siempre en el mismo sitio y con los mismos iconos), los bloques con su
// nombre en la línea y la casilla (el rótulo encima, en azul; blanca se escribe, gris la pone el programa).
// Se hacen una vez y las usan todas las pantallas. Cada una lleva `data-pieza`: la e2e mide que cabe a 1366 × 768.

import type { ReactNode } from 'react'
import './piezas.css'

/** 1 · La ventana: el título de ERP10 («Asiento general»…), su aspa, el cuerpo y la pestaña de abajo. */
export function Ventana({ id, titulo, pestanas, activa, alPestana, alCerrar, children }: {
  id: string; titulo: string; pestanas: readonly string[]; activa?: string; alPestana?: (p: string) => void; alCerrar?: () => void; children: ReactNode
}) {
  return (
    <section className="kp-ventana" aria-labelledby={`${id}-titulo`} data-pieza="ventana">
      <header className="kp-ventana-titulo">
        <h1 id={`${id}-titulo`}>{titulo}</h1>
        {alCerrar && <button type="button" className="kp-ventana-aspa" aria-label="Cerrar" title="Cerrar (Esc)" onClick={alCerrar}>✕</button>}
      </header>
      <div className="kp-ventana-cuerpo">{children}</div>
      <div className="kp-ventana-pestanas" role="tablist" aria-label="Pestañas de la ventana">
        {pestanas.map((p) => (
          <button key={p} type="button" role="tab" aria-selected={(activa ?? pestanas[0]) === p} onClick={() => alPestana?.(p)}>{p}</button>
        ))}
      </div>
    </section>
  )
}

const Icono = ({ d, relleno = false }: { d: string; relleno?: boolean }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"
    fill={relleno ? 'currentColor' : 'none'} stroke={relleno ? 'none' : 'currentColor'} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
)
const ICONOS = {
  guardar: 'M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm2 1.8V9h9V4.8H7zm5 8.2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  cancelar: 'M6 6l12 12M18 6L6 18',
  nuevo: 'M12 5v14M5 12h14',
  anterior: 'M19 12H5M11 6l-6 6 6 6',
  siguiente: 'M5 12h14M13 6l6 6-6 6',
} as const

/** `datos`: atributos `data-…` de la pantalla en el botón (K11b: la recibida conserva `data-guardar-y-siguiente`). */
export interface BotonBarra { hacer: () => void; puede?: boolean; titulo?: string; datos?: Readonly<Record<`data-${string}`, string>> }

/**
 * 2 · La barra: guardar, cancelar, nuevo, anterior y siguiente; y, según la pantalla, «Documento» y lo demás (`extra`).
 * Siempre en el mismo sitio y con los mismos iconos. Lo que acaba de pasar (regla 8) va a su derecha, en `aviso`.
 */
export function Barra({ guardar, cancelar, nuevo, anterior, siguiente, documento, extra, aviso }: {
  guardar: BotonBarra; cancelar: BotonBarra; nuevo: BotonBarra; anterior: BotonBarra; siguiente: BotonBarra
  documento?: BotonBarra & { hay: boolean }; extra?: ReactNode; aviso?: ReactNode
}) {
  const b = (clave: keyof typeof ICONOS, nombre: string, x: BotonBarra, relleno = false) => (
    <button type="button" className="kp-barra-icono" data-boton={clave} aria-label={nombre} title={x.titulo ?? nombre} disabled={x.puede === false} onClick={x.hacer} {...x.datos}>
      <Icono d={ICONOS[clave]} relleno={relleno} />
    </button>
  )
  return (
    <div className="kp-barra" role="toolbar" aria-label="La barra" data-pieza="barra">
      {b('guardar', 'Guardar', guardar, true)}
      {b('cancelar', 'Cancelar', cancelar)}
      {b('nuevo', 'Nuevo', nuevo)}
      {b('anterior', 'El anterior', anterior)}
      {b('siguiente', 'El siguiente', siguiente)}
      {documento && (
        <button type="button" className="kp-barra-texto" data-boton="documento" title={documento.titulo ?? 'Documento'} disabled={documento.puede === false} onClick={documento.hacer}>
          Documento <span className="kp-barra-hoja" data-hay={documento.hay ? 'si' : undefined} aria-hidden="true" />
        </button>
      )}
      {extra}
      {aviso && <div className="kp-barra-aviso">{aviso}</div>}
    </div>
  )
}

/**
 * 3 · Un bloque con su nombre en la línea, como en ERP10 («Datos asiento», «Apuntes», «Observaciones»). Con `recuadro`,
 * como las fichas de ERP10 (X27c): en su recuadro, con el título en su franja.
 */
export function Bloque({ titulo, children, className, crece = false, recuadro = false }: { titulo: string; children: ReactNode; className?: string; crece?: boolean; recuadro?: boolean }) {
  return (
    <section className={`kp-bloque${className ? ` ${className}` : ''}`} data-crece={crece ? 'si' : undefined} data-recuadro={recuadro ? 'si' : undefined} aria-label={titulo} data-pieza="bloque">
      <h2 className="kp-bloque-titulo"><span>{titulo}</span></h2>
      {children}
    </section>
  )
}

/**
 * Lo que mide una casilla, por su dato, como en ERP10 (X27c, Julio, 22/11: «cada casilla mide lo que su dato»; en una
 * pantalla grande no se estira). Las medidas, de la captura de ERP10 y la maqueta a 1366 (piezas.css, [data-mide]):
 *   · cifra: días, %, un código de 1 a 3 cifras o letras (el país, el tipo de IVA): 48 px;
 *   · corto: el NIF, el código postal, un importe: 110 px;
 *   · subcuenta: 8 cifras con su lupa: 120 px;
 *   · medio: una provincia, una población, un teléfono, un local: 220 px;
 *   · nombre: el nombre gris al lado de una lupa: 280 px;
 *   · largo: nombre, domicilio, correo, observaciones: con tope, 560 px.
 * Sin `mide`, como hasta ahora (lo que le dé su fila).
 */
export type Mide = 'cifra' | 'corto' | 'subcuenta' | 'medio' | 'nombre' | 'largo'

/**
 * 4 · La casilla: el rótulo encima, en azul, con el nombre contable de ERP10. Blanca se escribe; gris (`gris`) la pone
 * el programa. En ámbar (`ambar`), la que Sumied propone y conviene mirar: la única ayuda visible (sin frases).
 */
export function Casilla({ rotulo, htmlFor, gris = false, ambar = false, className, children, mas, mide, title, datos }: {
  rotulo: string; htmlFor: string; gris?: boolean; ambar?: boolean; className?: string; children: ReactNode; mas?: ReactNode; mide?: Mide
  /** K11b · El motivo del ámbar (o de dónde sale el dato), al pasar el ratón: sin frases en la pantalla. */
  title?: string
  /** K11b · Atributos `data-…` de la pantalla (la recibida: `data-comprobacion`). */
  datos?: Readonly<Record<`data-${string}`, string>>
}) {
  return (
    <div className={`kp-casilla${className ? ` ${className}` : ''}`} data-gris={gris ? 'si' : undefined} data-ambar={ambar ? 'si' : undefined} data-mide={mide} data-pieza="casilla" title={title} {...datos}>
      <label className="kp-rotulo" htmlFor={htmlFor}>{rotulo}</label>
      <div className="kp-casilla-dentro">{children}{mas}</div>
    </div>
  )
}

/** 6 · El ⊕: abre «Otros datos» o añade una línea. */
export function BotonMas({ etiqueta, hacer, abierto, texto }: { etiqueta: string; hacer: () => void; abierto?: boolean; texto?: string }) {
  return (
    <button type="button" className="kp-mas" aria-label={etiqueta} title={etiqueta} aria-expanded={abierto} onClick={hacer} data-pieza="mas">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M12 7v10M7 12h10" stroke="currentColor" strokeWidth="1.6" /></svg>
      {texto && <span>{texto}</span>}
    </button>
  )
}

/** «Otros datos» (el ⊕ de la cabecera): una hoja pequeña encima, con su título y sus casillas. Esc o el aspa la cierran. */
export function OtrosDatos({ titulo = 'Otros datos', alCerrar, children }: { titulo?: string; alCerrar: () => void; children: ReactNode }) {
  return (
    <div className="kp-otros" role="dialog" aria-label={titulo} data-pieza="otros-datos"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); alCerrar() } }}>
      <header><strong>{titulo}</strong><button type="button" className="kp-ventana-aspa" aria-label={`Cerrar ${titulo}`} onClick={alCerrar}>✕</button></header>
      <div className="kp-otros-cuerpo">{children}</div>
    </div>
  )
}

export interface LineaVisible { importe: number; cuenta: string; nombre: string; lado: 'debe' | 'haber' }

/** 7 · La visualización del asiento: el debe a la izquierda y el haber a la derecha; en cada línea, el importe, la cuenta entre paréntesis y su nombre. */
export function VisualizacionAsiento({ lineas, cifra }: { lineas: readonly LineaVisible[]; cifra: (n: number) => string }) {
  const col = (lado: 'debe' | 'haber') => (
    <ul className="kp-visual-col" aria-label={lado === 'debe' ? 'Debe' : 'Haber'}>
      {lineas.filter((l) => l.lado === lado).map((l, i) => (
        <li key={i}><span className="kp-num">{cifra(l.importe)}</span> <span className="kp-visual-cuenta">({l.cuenta})</span> <span>{l.nombre}</span></li>
      ))}
    </ul>
  )
  return <Bloque titulo="Visualización del asiento" className="kp-visual">{col('debe')}{col('haber')}</Bloque>
}
