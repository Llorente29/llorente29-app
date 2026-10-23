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
import { MarcaCambiado } from './CambiosSinGuardar'
import type { CambioCampo } from './cambios'
import { ordenarAsiento, totalesAsiento, type LineaAsientoVista } from './valores'

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
 * El asiento, como un asiento de verdad (encargo «Ficha de la recibida
 * completa», punto 7; tablero 3b): columnas Cuenta · Nombre · Debe · Haber; la
 * cuenta delante, en negrita y más grande, en cifras tabulares; cada importe a
 * la derecha, bajo su título; primero las líneas del debe y luego las del
 * haber; y la fila de totales con «Cuadra» (o «No cuadra: diferencia X», en
 * ámbar). Con `alEditar`, «Editar el asiento a mano»; la línea tocada a mano
 * lleva su marca. Es LA pieza para enseñar un asiento: la ficha de la
 * recibida, el panel del banco, los asientos del cierre, la muestra.
 */
export function AsientoQueSeCrea({ lineas, nota, abierto: deSerie = true, titulo = 'El asiento que se crea', vacio, alEditar, textoEditar = 'Editar el asiento a mano', nivel = 2 }: {
  lineas: readonly LineaAsientoVista[]
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
}) {
  const [abierto, setAbierto] = useState(deSerie)
  const ordenadas = ordenarAsiento(lineas)
  const t = totalesAsiento(lineas)
  const Titulo = `h${nivel}` as 'h2' | 'h3' | 'h4'
  return (
    <details className="s-asiento-ficha" open={abierto} onToggle={(e) => setAbierto((e.currentTarget as HTMLDetailsElement).open)}>
      <summary><Titulo>{titulo}</Titulo></summary>
      {alEditar && lineas.length > 0 && (
        <button type="button" className="s-boton s-boton-enlace s-asiento-editar" onClick={alEditar}>{textoEditar}</button>
      )}
      {lineas.length === 0 ? <div className="s-asiento-vacio">{vacio}</div> : (
        <div className="s-asiento-marco">
          <table className="s-asiento-tabla" aria-label={titulo}>
            <thead>
              <tr>
                <th scope="col" className="s-asiento-col-cuenta">Cuenta</th>
                <th scope="col">Nombre</th>
                <th scope="col" className="s-lista-cifra">Debe</th>
                <th scope="col" className="s-lista-cifra">Haber</th>
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((l, i) => (
                <tr key={i} data-a-mano={l.aMano ? '' : undefined}>
                  <td className="s-asiento-codigo">{l.codigo}</td>
                  <td>
                    <span className="s-asiento-cuenta">{l.nombre}</span>
                    {l.aMano && <span className="s-asiento-a-mano">Cambiado a mano</span>}
                  </td>
                  <td className="s-lista-cifra">{l.debe ?? ''}</td>
                  <td className="s-lista-cifra">{l.haber ?? ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr data-cuadra={t.cuadra ? 'si' : 'no'}>
                <td className="s-asiento-col-cuenta">
                  {t.cuadra
                    ? <span className="s-asiento-cuadra"><Icono nombre="ok" /> Cuadra</span>
                    : <span className="s-asiento-descuadra">No cuadra: diferencia {t.diferencia}</span>}
                </td>
                <td className="s-asiento-totales">Totales</td>
                <td className="s-lista-cifra">{t.debe}</td>
                <td className="s-lista-cifra">{t.haber}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
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
