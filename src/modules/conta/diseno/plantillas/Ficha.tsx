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

import { Fragment, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icono } from '../Icono'
import { MarcaCambiado } from './CambiosSinGuardar'
import type { CambioCampo } from './cambios'
import { claveLineaAsiento, lineasEnOrden, totalesAsiento, type LineaAsientoVista, type OrdenAsiento } from './valores'

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
export function Veredicto({ tipo, titulo, porque, detalle, quien = 'Sumied' }: {
  tipo: TipoVeredicto
  /** El nombre de la marca que lo dice (MARCA.nombre): la plantilla no lo sabe. */
  quien?: string
  titulo: string
  porque: string
  /** Lo que sale al pulsar «Por qué»: cada comprobación y cada decisión, con su porqué. */
  detalle?: readonly { ok: boolean | null; texto: string }[]
}) {
  const [abierto, setAbierto] = useState(false)
  return (
    <section className="s-veredicto" data-tono={TONO[tipo]} aria-label={`Lo que dice ${quien} de esta factura`}>
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
export function CampoFicha({ etiqueta, valor, codigo, motivo, tono = 'normal', marca, ancho = 1, cifra = false, cambio, alDeshacer }: {
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
  /** Cambiado y sin guardar (useCambiosSinGuardar().cambioDe(campo)): «CAMBIADO» junto al rótulo y «Antes: … · Deshacer» debajo. */
  cambio?: CambioCampo | null
  alDeshacer?: () => void
}) {
  const cambiado = !!cambio && !!alDeshacer
  return (
    <div className="s-campo-ficha" data-tono={tono} data-cambiado={cambiado ? '' : undefined} style={ancho > 1 ? { gridColumn: `span ${ancho}` } : undefined}>
      <span className="s-campo-ficha-etiqueta">
        {etiqueta}
        {tono === 'propuesto' && <span className="s-campo-propuesto">Propuesto</span>}
        {tono === 'revisar' && <span className="s-campo-revisar">Por revisar</span>}
        {cambio && alDeshacer && <MarcaCambiado cambio={cambio} onDeshacer={alDeshacer} parte="etiqueta" />}
      </span>
      <div className={`s-campo-ficha-caja${cifra ? ' s-campo-ficha-cifra' : ''}`}>
        <span className="s-campo-ficha-valor">
          <span>{valor}</span>
          {codigo && <span className="s-campo-ficha-codigo">{codigo}</span>}
        </span>
        {marca && <span className="s-campo-ficha-marca"><Icono nombre="ok" /> {marca}</span>}
      </div>
      {motivo && <span className="s-campo-ficha-motivo">{motivo}</span>}
      {cambio && alDeshacer && <MarcaCambiado cambio={cambio} onDeshacer={alDeshacer} parte="antes" />}
    </div>
  )
}

/** Una fila de campos dentro de un bloque. */
export function FilaCampos({ children, columnas = 3 }: { children: ReactNode; columnas?: 2 | 3 | 4 }) {
  return <div className="s-fila-campos" data-columnas={columnas}>{children}</div>
}

/**
 * Una columna de más en la tabla del asiento (local, marca, IVA, retención…):
 * su título y lo que pinta en cada línea. Va entre «Nombre» y «Debe»; en la
 * tabla compacta (móvil) baja debajo del nombre, con su título delante.
 */
export interface ColumnaAsiento<L extends LineaAsientoVista = LineaAsientoVista> {
  id: string
  titulo: string
  celda: (linea: L) => ReactNode
  /** Una cifra: a la derecha y en cifras tabulares. */
  cifra?: boolean
}

/** Lo que admite la tabla del asiento, además de sus líneas. Todo opcional: sin nada, Cuenta · Nombre · Debe · Haber. */
export interface OpcionesTablaAsiento<L extends LineaAsientoVista = LineaAsientoVista> {
  /** Columnas entre «Nombre» y «Debe». */
  columnas?: readonly ColumnaAsiento<L>[]
  /** Lo que se puede hacer con cada línea («Cambiar cuenta»…): su columna al final. */
  acciones?: (linea: L) => ReactNode
  /** El título (para el lector) de la columna de acciones. */
  tituloAcciones?: string
  /** Lo que va debajo del nombre, en pequeño: chips, el concepto de la línea… */
  apoyo?: (linea: L) => ReactNode
  /** Una fila a todo el ancho debajo de la línea (p. ej. el buscador de «Cambiar cuenta»); null, nada. */
  debajo?: (linea: L) => ReactNode
  /** El número de cuenta lleva a esta dirección (su mayor). */
  enlaceCuenta?: (linea: L) => string | null | undefined
  /** De serie, primero el debe y luego el haber; 'posicion', tal como vienen. */
  orden?: OrdenAsiento
  /** Móvil: las columnas de más y las acciones bajan debajo del nombre (la tabla sigue en Cuenta · Nombre · Debe · Haber). */
  compacta?: boolean
}

const vacia = (x: ReactNode) => x === null || x === undefined || x === false || x === ''

/**
 * La tabla del asiento, sola (sin título ni desplegable): Cuenta · Nombre ·
 * Debe · Haber; la cuenta delante, en negrita y más grande, en cifras
 * tabulares; cada importe a la derecha, bajo su título; primero las líneas del
 * debe y luego las del haber; y la fila de totales con «Cuadra» (o «No cuadra:
 * diferencia X», en ámbar). Con sus opciones, columnas de más y acciones por
 * línea. La usan AsientoQueSeCrea y las páginas que ya tienen su propio marco
 * (el asiento abierto, los apuntes del libro).
 */
export function TablaAsiento<L extends LineaAsientoVista>({ lineas, etiqueta = 'Asiento', columnas = [], acciones, tituloAcciones = 'Acciones', apoyo, debajo, enlaceCuenta, orden = 'debe-haber', compacta = false }: {
  lineas: readonly L[]
  /** El nombre de la tabla para el lector. */
  etiqueta?: string
} & OpcionesTablaAsiento<L>) {
  const enOrden = lineasEnOrden(lineas, orden)
  const t = totalesAsiento(lineas)
  const enFila = compacta ? [] : columnas
  const conAcciones = !!acciones && !compacta
  const ancho = 4 + enFila.length + (conAcciones ? 1 : 0)
  return (
    <div className="s-asiento-marco" data-compacta={compacta ? '' : undefined}>
      <table className="s-asiento-tabla" aria-label={etiqueta}>
        <thead>
          <tr>
            <th scope="col" className="s-asiento-col-cuenta">Cuenta</th>
            <th scope="col">Nombre</th>
            {enFila.map((c) => <th key={c.id} scope="col" className={c.cifra ? 's-lista-cifra' : 's-asiento-col-extra'}>{c.titulo}</th>)}
            <th scope="col" className="s-lista-cifra">Debe</th>
            <th scope="col" className="s-lista-cifra">Haber</th>
            {conAcciones && <th scope="col" className="s-asiento-col-acciones"><span className="s-oculto">{tituloAcciones}</span></th>}
          </tr>
        </thead>
        <tbody>
          {enOrden.map((l, i) => {
            const clave = claveLineaAsiento(l, i)
            const enlace = enlaceCuenta?.(l)
            const deApoyo = apoyo?.(l)
            const bajo = debajo?.(l)
            const datos = compacta ? columnas.map((c) => ({ c, v: c.celda(l) })).filter((x) => !vacia(x.v)) : []
            const hacer = acciones && compacta ? acciones(l) : null
            return (
              <Fragment key={clave}>
                <tr data-a-mano={l.aMano ? '' : undefined} data-linea={clave}>
                  <td className="s-asiento-codigo">{enlace ? <Link to={enlace} className="s-asiento-codigo-enlace" title={`El mayor de la ${l.codigo}`}>{l.codigo}</Link> : l.codigo}</td>
                  <td className="s-asiento-col-nombre">
                    <span className="s-asiento-cuenta">{l.nombre}</span>
                    {l.aMano && <span className="s-asiento-a-mano">Cambiado a mano</span>}
                    {!vacia(deApoyo) && <span className="s-asiento-apoyo">{deApoyo}</span>}
                    {datos.length > 0 && (
                      <span className="s-asiento-datos">
                        {datos.map(({ c, v }) => <span key={c.id} className="s-asiento-dato"><span className="s-asiento-dato-titulo">{c.titulo}</span> {v}</span>)}
                      </span>
                    )}
                    {!vacia(hacer) && <span className="s-asiento-acciones">{hacer}</span>}
                  </td>
                  {enFila.map((c) => <td key={c.id} className={c.cifra ? 's-lista-cifra' : 's-asiento-extra'}>{c.celda(l)}</td>)}
                  <td className="s-lista-cifra">{l.debe ?? ''}</td>
                  <td className="s-lista-cifra">{l.haber ?? ''}</td>
                  {conAcciones && <td className="s-asiento-acciones">{acciones(l)}</td>}
                </tr>
                {!vacia(bajo) && <tr className="s-asiento-debajo" data-linea={clave}><td colSpan={ancho}>{bajo}</td></tr>}
              </Fragment>
            )
          })}
        </tbody>
        <tfoot>
          <tr data-cuadra={t.cuadra ? 'si' : 'no'}>
            <td className="s-asiento-col-cuenta">
              {t.cuadra
                ? <span className="s-asiento-cuadra"><Icono nombre="ok" /> Cuadra</span>
                : <span className="s-asiento-descuadra">No cuadra: diferencia {t.diferencia}</span>}
            </td>
            <td className="s-asiento-totales">Totales</td>
            {enFila.map((c) => <td key={c.id} />)}
            <td className="s-lista-cifra">{t.debe}</td>
            <td className="s-lista-cifra">{t.haber}</td>
            {conAcciones && <td />}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/**
 * El asiento, como un asiento de verdad (encargo «Ficha de la recibida
 * completa», punto 7; tablero 3b): la TablaAsiento dentro de su desplegable,
 * con su título. Con `alEditar`, «Editar el asiento a mano»; la línea tocada a
 * mano lleva su marca. Admite las mismas opciones que la tabla (columnas,
 * acciones por línea, enlace al mayor, orden, compacta). Es LA pieza para
 * enseñar un asiento: la ficha de la recibida, el panel del banco, los
 * asientos del cierre, la muestra.
 */
export function AsientoQueSeCrea<L extends LineaAsientoVista>({ lineas, nota, abierto: deSerie = true, titulo = 'El asiento que se crea', vacio, alEditar, textoEditar = 'Editar el asiento a mano', nivel = 2, ...opciones }: {
  lineas: readonly L[]
  /** «Al validar se envía también a Diez», o lo que diga la página. */
  nota?: ReactNode
  abierto?: boolean
  titulo?: string
  /** Lo que se dice si aún no hay asiento que enseñar. */
  vacio?: ReactNode
  /** «Editar el asiento a mano»: sin él, no sale. */
  alEditar?: () => void
  textoEditar?: string
  /** El nivel del título, para que encaje en su página (un panel con h3 lo quiere en h4). */
  nivel?: 2 | 3 | 4
} & OpcionesTablaAsiento<L>) {
  const [abierto, setAbierto] = useState(deSerie)
  const Titulo = `h${nivel}` as 'h2' | 'h3' | 'h4'
  return (
    <details className="s-asiento-ficha" open={abierto} onToggle={(e) => setAbierto((e.currentTarget as HTMLDetailsElement).open)}>
      <summary><Titulo>{titulo}</Titulo></summary>
      {alEditar && lineas.length > 0 && (
        <button type="button" className="s-boton s-boton-enlace s-asiento-editar" onClick={alEditar}>{textoEditar}</button>
      )}
      {lineas.length === 0 ? <div className="s-asiento-vacio">{vacio}</div> : <TablaAsiento lineas={lineas} etiqueta={titulo} {...opciones} />}
      {lineas.length > 0 && nota && <p className="s-asiento-pie">{nota}</p>}
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
