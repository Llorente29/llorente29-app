// src/modules/conta/diseno/plantillas/Ficha.tsx
//
// S02 · La plantilla FICHA (tableros 3 y 9): una factura, un movimiento, un
// contacto. Los datos a la izquierda, por bloques; a la derecha, el PDF o el
// detalle, grande, ampliable a pantalla completa y plegable (se recuerda por
// persona). Arriba, «3 de 9» con flechas y el principal («Validar y
// siguiente» con Intro); abajo y desplegable, el asiento que se crea.
//
// Y la regla 3 del patrón (la IA da un veredicto con su motivo): arriba, una
// banda «Lista para contabilizar», «Revisa esto» o «No encaja» con una frase
// que dice por qué y un enlace «Por qué» que abre el detalle; en cada campo
// propuesto, la etiqueta PROPUESTO y una línea con su motivo; lo que no se
// supo rellenar, en ámbar («Por revisar»).

import { useState, type ReactNode } from 'react'
import { Icono } from '../Icono'

/** «‹ 3 de 9 ›»: recorrer la cola sin volver a la lista. */
export function NavegaFicha({ pos, total, anterior, siguiente, etiqueta = 'Facturas' }: {
  /** 0 si no está en la cola. */
  pos: number
  total: number
  anterior: (() => void) | null
  siguiente: (() => void) | null
  etiqueta?: string
}) {
  if (total === 0 || pos === 0) return null
  return (
    <div className="s-navega" role="group" aria-label={`${etiqueta}: ${pos} de ${total}`}>
      <button type="button" className="s-navega-flecha" aria-label="La anterior" aria-keyshortcuts="ArrowLeft" disabled={!anterior} onClick={() => anterior?.()}>
        <Icono nombre="izquierda" />
      </button>
      <span className="s-navega-cuenta s-cifra">{pos} de {total}</span>
      <button type="button" className="s-navega-flecha" aria-label="La siguiente" aria-keyshortcuts="ArrowRight" disabled={!siguiente} onClick={() => siguiente?.()}>
        <Icono nombre="derecha" />
      </button>
    </div>
  )
}

export type TipoVeredicto = 'lista' | 'revisa' | 'no_encaja' | 'hecha'
const TONO: Record<TipoVeredicto, string> = { lista: 'propuesto', revisa: 'duda', no_encaja: 'falta', hecha: 'seguro' }

/** La banda del veredicto, con su porqué y el detalle detrás de «Por qué». */
export function Veredicto({ tipo, titulo, porque, detalle }: {
  tipo: TipoVeredicto
  titulo: string
  porque: string
  /** Lo que sale al pulsar «Por qué»: cada comprobación y cada decisión, con su porqué. */
  detalle?: readonly { ok: boolean | null; texto: string }[]
}) {
  const [abierto, setAbierto] = useState(false)
  return (
    <section className="s-veredicto" data-tono={TONO[tipo]} aria-label="Lo que dice Sumied de esta factura">
      <Icono nombre={tipo === 'hecha' ? 'ok' : tipo === 'lista' ? 'ia' : 'aviso'} />
      <div className="s-veredicto-texto">
        <h2 className="s-veredicto-titulo">{titulo}</h2>
        <p className="s-veredicto-porque">{porque}</p>
        {abierto && detalle && detalle.length > 0 && (
          <ul className="s-veredicto-detalle">
            {detalle.map((d, i) => (
              <li key={i} data-ok={d.ok === null ? undefined : d.ok ? 'si' : 'no'}>
                <span aria-hidden="true">{d.ok === null ? '·' : d.ok ? '✓' : '!'}</span> {d.texto}
              </li>
            ))}
          </ul>
        )}
      </div>
      {detalle && detalle.length > 0 && (
        <button type="button" className="s-boton s-boton-enlace s-veredicto-por-que" aria-expanded={abierto} onClick={() => setAbierto((x) => !x)}>
          {abierto ? 'Ocultar' : 'Por qué'}
        </button>
      )}
    </section>
  )
}

/** Un bloque de la ficha, con su título. */
export function BloqueFicha({ titulo, children, accion }: { titulo: string; children: ReactNode; accion?: ReactNode }) {
  return (
    <section className="s-bloque-ficha" aria-label={titulo}>
      <div className="s-bloque-ficha-cabeza"><h2>{titulo}</h2>{accion}</div>
      {children}
    </section>
  )
}

export type TonoCampo = 'propuesto' | 'revisar' | 'ok' | 'normal'

/**
 * Un dato de la ficha: su etiqueta encima, el valor en su caja y, debajo, su
 * motivo. Propuesto: la etiqueta PROPUESTO y la caja en el verde de Sumied.
 * Por revisar: en ámbar. Bien: con su ✓ al lado («NIF de su ficha»).
 */
export function CampoFicha({ etiqueta, valor, codigo, motivo, tono = 'normal', marca, ancho = 1, cifra = false }: {
  etiqueta: string
  valor: ReactNode
  /** El número de cuenta, debajo del nombre (nunca en su lugar). */
  codigo?: string
  /** La línea de debajo: por qué está así. */
  motivo?: string
  tono?: TonoCampo
  /** Lo que va dentro de la caja, a la derecha («✓ NIF de su ficha»). */
  marca?: string
  /** Cuántas columnas ocupa en su bloque (1 o 2). */
  ancho?: 1 | 2 | 3
  cifra?: boolean
}) {
  return (
    <div className="s-campo-ficha" data-tono={tono} style={ancho > 1 ? { gridColumn: `span ${ancho}` } : undefined}>
      <span className="s-campo-ficha-etiqueta">
        {etiqueta}
        {tono === 'propuesto' && <span className="s-campo-propuesto">Propuesto</span>}
        {tono === 'revisar' && <span className="s-campo-revisar">Por revisar</span>}
      </span>
      <div className={`s-campo-ficha-caja${cifra ? ' s-campo-ficha-cifra' : ''}`}>
        <span className="s-campo-ficha-valor">
          <span>{valor}</span>
          {codigo && <span className="s-campo-ficha-codigo">{codigo}</span>}
        </span>
        {marca && <span className="s-campo-ficha-marca"><Icono nombre="ok" /> {marca}</span>}
      </div>
      {motivo && <span className="s-campo-ficha-motivo">{motivo}</span>}
    </div>
  )
}

/** Una fila de campos dentro de un bloque. */
export function FilaCampos({ children, columnas = 3 }: { children: ReactNode; columnas?: 2 | 3 | 4 }) {
  return <div className="s-fila-campos" data-columnas={columnas}>{children}</div>
}

/** El asiento que se crea, abajo y desplegable: cuenta (nombre y número debajo), debe y haber, y si cuadra. */
export function AsientoQueSeCrea({ lineas, nota, abierto: deSerie = true, titulo = 'El asiento que se crea', vacio }: {
  lineas: readonly { nombre: string; codigo: string; debe: string | null; haber: string | null }[]
  /** «Al validar se envía también a Diez», o lo que diga la página. */
  nota?: string
  abierto?: boolean
  titulo?: string
  /** Lo que se dice si aún no hay asiento que enseñar. */
  vacio?: ReactNode
}) {
  const [abierto, setAbierto] = useState(deSerie)
  const cent = (x: string | null) => (x ? Math.round(Number(x.replace(/\./g, '').replace(',', '.')) * 100) : 0)
  const debe = lineas.reduce((s, l) => s + cent(l.debe), 0)
  const haber = lineas.reduce((s, l) => s + cent(l.haber), 0)
  const cuadra = lineas.length > 0 && debe === haber
  return (
    <details className="s-asiento-ficha" open={abierto} onToggle={(e) => setAbierto((e.currentTarget as HTMLDetailsElement).open)}>
      <summary><h2>{titulo}</h2></summary>
      {lineas.length === 0 ? <div className="s-asiento-vacio">{vacio}</div> : (
        <table className="s-asiento-tabla">
          <thead><tr><th scope="col">Cuenta</th><th scope="col" className="s-lista-cifra">Debe</th><th scope="col" className="s-lista-cifra">Haber</th></tr></thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={i}>
                <td><span className="s-asiento-cuenta">{l.nombre}</span> <span className="s-campo-ficha-codigo">{l.codigo}</span></td>
                <td className="s-lista-cifra">{l.debe ?? ''}</td>
                <td className="s-lista-cifra">{l.haber ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {lineas.length > 0 && (
        <p className="s-asiento-pie">
          {cuadra ? <span className="s-asiento-cuadra"><Icono nombre="ok" /> Cuadra</span> : <span className="s-asiento-descuadra">No cuadra</span>}
          {nota && <span className="s-asiento-nota"> · {nota}</span>}
        </p>
      )}
    </details>
  )
}

/** El documento de la derecha: grande, ampliable a pantalla completa y plegable. */
export function DocumentoFicha({ titulo, descargar, abrir, oculto, alOcultar, children }: {
  /** El nombre del fichero («24048027.pdf»). */
  titulo: string
  /** La dirección para descargarlo, si la hay. */
  descargar?: string | null
  /** Abrirlo aparte, si la hay. */
  abrir?: string | null
  oculto: boolean
  alOcultar: (oculto: boolean) => void
  children: ReactNode
}) {
  const [zoom, setZoom] = useState(100)
  const [completa, setCompleta] = useState(false)
  if (oculto) {
    return (
      <aside className="s-documento s-documento-oculto" aria-label="Documento">
        <button type="button" className="s-documento-mostrar" aria-expanded="false" onClick={() => alOcultar(false)} title="Enseñar el documento">
          <Icono nombre="desplegarDocumento" /><span>Documento</span>
        </button>
      </aside>
    )
  }
  return (
    <aside className={`s-documento${completa ? ' s-documento-completa' : ''}`} aria-label="Documento">
      <div className="s-documento-barra">
        <Icono nombre="documento" />
        <span className="s-documento-titulo" title={titulo}>{titulo}</span>
        <button type="button" className="s-documento-boton" aria-label="Alejar" disabled={zoom <= 50} onClick={() => setZoom((z) => Math.max(50, z - 25))}><Icono nombre="alejar" /></button>
        <button type="button" className="s-documento-boton" aria-label="Acercar" disabled={zoom >= 200} onClick={() => setZoom((z) => Math.min(200, z + 25))}><Icono nombre="acercar" /></button>
        {descargar && <a className="s-documento-boton" href={descargar} download aria-label="Descargar" title="Descargar"><Icono nombre="descargar" /></a>}
        {abrir && <a className="s-documento-boton" href={abrir} target="_blank" rel="noopener noreferrer" aria-label="Abrir aparte" title="Abrir aparte"><Icono nombre="abrirAparte" /></a>}
        <button type="button" className="s-documento-boton" aria-label={completa ? 'Salir de pantalla completa' : 'Pantalla completa'} aria-pressed={completa}
          onClick={() => setCompleta((x) => !x)}><Icono nombre={completa ? 'salirPantallaCompleta' : 'pantallaCompleta'} /></button>
        {!completa && <button type="button" className="s-documento-boton" aria-label="Plegar el documento" aria-expanded="true" onClick={() => alOcultar(true)}><Icono nombre="plegarDocumento" /></button>}
      </div>
      <div className="s-documento-hoja">
        <div className="s-documento-zoom" style={{ width: `${zoom}%` }}>{children}</div>
      </div>
    </aside>
  )
}

/** La ficha entera: los datos a la izquierda y el documento a la derecha (o a todo el ancho si está plegado). */
export function Ficha({ datos, documento, documentoOculto = false }: { datos: ReactNode; documento?: ReactNode; documentoOculto?: boolean }) {
  return (
    <div className="s-ficha" data-documento={documento ? (documentoOculto ? 'oculto' : 'si') : 'no'}>
      <div className="s-ficha-datos">{datos}</div>
      {documento}
    </div>
  )
}
