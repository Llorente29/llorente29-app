// src/modules/conta/documentos/FichaRecibidaBloques.tsx
//
// Los bloques de la ficha de la factura recibida (tablero 3b), los mismos para
// la que entra sola y para la que se escribe a mano (regla de Julio: «es la
// misma pantalla para las dos»): proveedor y factura, importes por tipo de IVA,
// a qué gasto va, el pago, el hueco del PDF y el historial. Cada campo editable
// lleva su marca «CAMBIADO» con «Antes: … · Deshacer» (la pieza común,
// diseno/plantillas). Lo que decide, sin pintar, está en fichaRecibida.ts.
//
// `data-prueba` y los nombres accesibles van pensados para las e2e de la ficha.

import { useId, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { Boton, Fecha, Icono, Tecla } from '@/modules/conta/diseno'
import { BloqueFicha, BuscarCuentaHoja, MarcaCambiado, type CambioCampo, type CuentaHoja, type TonoCampo } from '@/modules/conta/diseno/plantillas'
import { eurosExactos } from '@/modules/conta/lib/formato'
import {
  ESTADOS_PAGO, FORMAS_PAGO, TIPOS_RETENCION, contraElPdf, cuadraElGasto, diaDeHecho, gastosConImporte, importeEs, otroTipo, rehacerCuota, textoTipo,
  ACEPTA_PAPEL, type Adicional, type HechoHistorial, type LineaGasto, type LineaIva, type Totales,
} from './fichaRecibida'
import { cuotaIva } from '@/modules/conta/lib/libro'

type Cambio = CambioCampo | undefined

/** Un campo de la ficha que se edita: su rótulo (con PROPUESTO o CAMBIADO), el control y, debajo, su motivo o «Antes: … · Deshacer». */
export function CampoEditable({ etiqueta, cambio, alDeshacer, tono = 'normal', motivo, children, prueba, ancho = 1 }: {
  etiqueta: ReactNode
  cambio?: Cambio
  alDeshacer?: () => void
  tono?: TonoCampo
  motivo?: ReactNode
  children: ReactNode
  prueba?: string
  ancho?: 1 | 2 | 3
}) {
  const cambiado = !!cambio && !!alDeshacer
  return (
    <div className="s-campo-ficha cxf-campo" data-tono={cambiado ? 'normal' : tono} data-cambiado={cambiado ? '' : undefined} data-prueba={prueba}
      style={ancho > 1 ? { gridColumn: `span ${ancho}` } : undefined}>
      <span className="s-campo-ficha-etiqueta">
        {etiqueta}
        {!cambiado && tono === 'propuesto' && <span className="s-campo-propuesto">Propuesto</span>}
        {!cambiado && tono === 'revisar' && <span className="s-campo-revisar">Por revisar</span>}
        {cambiado && <MarcaCambiado cambio={cambio} onDeshacer={alDeshacer!} parte="etiqueta" />}
      </span>
      {children}
      {cambiado ? <MarcaCambiado cambio={cambio} onDeshacer={alDeshacer!} parte="antes" /> : motivo && <span className="s-campo-ficha-motivo">{motivo}</span>}
    </div>
  )
}

// ── Proveedor y factura ─────────────────────────────────────────────────────

export function BloqueProveedorFactura({ proveedorId, numero, fecha, proveedores, alCambiar, cambioDe, deshacer, motivoProveedor, tonoProveedor, motivoNumero, soloLectura, errores = {}, altaProveedor, debajo }: {
  proveedorId: string
  numero: string
  fecha: string
  proveedores: readonly { id: string; nombre: string; nif: string | null }[]
  alCambiar: (c: { proveedorId?: string; numero?: string; fecha?: string }) => void
  cambioDe: (campo: 'proveedorId' | 'numero' | 'fecha') => Cambio
  deshacer: (campo: 'proveedorId' | 'numero' | 'fecha') => void
  motivoProveedor?: ReactNode
  tonoProveedor?: TonoCampo
  motivoNumero?: ReactNode
  soloLectura: boolean
  errores?: Partial<Record<'proveedor' | 'numero' | 'fecha', string>>
  /**
   * «Dar de alta a …» y «Es uno que ya tengo» (S01b). Con una función, recibe
   * cómo abrir la lista de proveedores para elegir uno.
   */
  altaProveedor?: ReactNode | ((abrirLista: () => void) => ReactNode)
  /** S01b · Lo que va dentro del bloque, debajo de la fila: el alta, el aviso del NIF distinto (con cómo abrir la lista). */
  debajo?: ReactNode | ((abrirLista: () => void) => ReactNode)
}) {
  const [cambiando, setCambiando] = useState(!proveedorId)
  const idLista = useId()
  const abrirLista = () => {
    setCambiando(true)
    // Ya pintada, al foco y, donde se pueda, desplegada.
    setTimeout(() => { const el = document.getElementById(idLista) as HTMLSelectElement | null; if (!el) return; el.focus(); try { (el as HTMLSelectElement & { showPicker?: () => void }).showPicker?.() } catch { /* sin gesto: solo el foco */ } }, 0)
  }
  const alta = typeof altaProveedor === 'function' ? altaProveedor(abrirLista) : altaProveedor
  const nombre = proveedores.find((p) => p.id === proveedorId)?.nombre
  return (
    <BloqueFicha titulo="Proveedor y factura">
      <div className="s-fila-campos cxf-fila-proveedor">
        <CampoEditable etiqueta="Proveedor" cambio={cambioDe('proveedorId')} alDeshacer={() => deshacer('proveedorId')} tono={tonoProveedor} prueba="campo-proveedor"
          motivo={errores.proveedor ? <span className="cxf-error" role="alert">{errores.proveedor}</span> : <>
            {motivoProveedor}
            {!soloLectura && proveedorId && !cambiando && <> · <button type="button" className="s-boton s-boton-enlace" onClick={() => setCambiando(true)}>Cambiar de proveedor</button></>}
            {alta && <> · {alta}</>}
          </>}>
          {cambiando && !soloLectura
            ? <select id={idLista} className="s-control" aria-label="Proveedor" value={proveedorId} onChange={(e) => alCambiar({ proveedorId: e.target.value })} autoFocus={!!proveedorId}>
                <option value="">{proveedores.length ? 'Elige el proveedor…' : 'No tienes proveedores dados de alta'}</option>
                {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.nif ? ` · ${p.nif}` : ''}</option>)}
              </select>
            : <input className="s-control" aria-label="Proveedor" value={nombre ?? 'Sin proveedor'} readOnly />}
        </CampoEditable>
        <CampoEditable etiqueta="Nº de factura" cambio={cambioDe('numero')} alDeshacer={() => deshacer('numero')} tono={numero ? 'normal' : 'revisar'} prueba="campo-numero"
          motivo={errores.numero ? <span className="cxf-error" role="alert">{errores.numero}</span> : motivoNumero}>
          <input className="s-control" aria-label="Nº de factura" value={numero} readOnly={soloLectura} maxLength={60} autoComplete="off"
            onChange={(e) => alCambiar({ numero: e.target.value })} />
        </CampoEditable>
        <CampoEditable etiqueta="Fecha de la factura" cambio={cambioDe('fecha')} alDeshacer={() => deshacer('fecha')} tono={fecha ? 'normal' : 'revisar'} prueba="campo-fecha"
          motivo={errores.fecha ? <span className="cxf-error" role="alert">{errores.fecha}</span> : undefined}>
          {soloLectura
            ? <input className="s-control" aria-label="Fecha de la factura" value={fecha ? `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}/${fecha.slice(0, 4)}` : ''} readOnly />
            : <Fecha id="cxf-fecha" aria-label="Fecha de la factura" valor={fecha} alCambiar={(v) => alCambiar({ fecha: v })} />}
        </CampoEditable>
      </div>
      {typeof debajo === 'function' ? debajo(abrirLista) : debajo}
    </BloqueFicha>
  )
}

// ── Importes por tipo de IVA ────────────────────────────────────────────────

export function BloqueImportesIva({ iva, retencion, recargo, tipos, totales, pdf, fuente, alCambiar, cambioDe, deshacer, soloLectura, errores = [], masDecimales = false, abono = false }: {
  /** S01h · Un abono: todo va a tu favor, sin signo; el total se llama «Total a tu favor». */
  abono?: boolean
  iva: readonly LineaIva[]
  retencion: Adicional | null
  recargo: Adicional | null
  /** Los tipos que se ofrecen (los de la cuenta). */
  tipos: readonly number[]
  totales: Totales
  /** Lo que dice el PDF, para «Igual que el PDF»; null si no hay con qué comparar (la a mano que se está escribiendo). */
  pdf: { base: number | null; iva: number | null; total: number | null } | null
  fuente: 'pdf' | 'factura'
  alCambiar: (c: { iva?: LineaIva[]; retencion?: Adicional | null; recargo?: Adicional | null }) => void
  cambioDe: (campo: 'iva' | 'retencion' | 'recargo') => Cambio
  deshacer: (campo: 'iva' | 'retencion' | 'recargo') => void
  soloLectura: boolean
  /** Lo que falta o está mal en los importes (la a mano, al guardar). */
  errores?: readonly string[]
  /** Sus líneas traen más de dos decimales: 1 céntimo de diferencia es redondeo. */
  masDecimales?: boolean
}) {
  const ofrecidos = [...new Set([...tipos, ...iva.map((l) => Number(l.tipo)).filter((x) => Number.isFinite(x))])].sort((a, b) => b - a)
  const poner = (i: number, l: Partial<LineaIva>, rehacer: boolean) => {
    const nuevas = iva.map((x, k) => (k === i ? (rehacer ? rehacerCuota({ ...x, ...l }) : { ...x, ...l }) : x))
    alCambiar({ iva: nuevas })
  }
  const contra = pdf ? contraElPdf(totales, pdf, fuente, { masDecimales }) : null
  const cIva = cambioDe('iva'), cRet = cambioDe('retencion'), cRec = cambioDe('recargo')
  const base = totales.base
  return (
    <BloqueFicha
      titulo="Importes por tipo de IVA"
      accion={(cIva ?? cRet ?? cRec) && (
        <MarcaCambiado
          cambio={(cIva ?? cRet ?? cRec)!}
          onDeshacer={() => deshacer(cIva ? 'iva' : cRet ? 'retencion' : 'recargo')}
          parte="etiqueta"
        />
      )}
    >
      <div className="cxf-iva" data-prueba="importes-iva" data-cambiado={cIva ? '' : undefined}>
        <div className="cxf-iva-cabeza" aria-hidden="true"><span>Base</span><span>Tipo de IVA</span><span>Cuota</span><span /></div>
        {iva.map((l, i) => {
          const de = l.tipo === '' ? `la línea ${i + 1}` : `al ${textoTipo(l.tipo)}`
          return (
            <div key={i} className="cxf-iva-linea" role="group" aria-label={`IVA ${de}`} data-prueba="linea-iva">
              <input className="s-control s-cifra cxf-importe" aria-label={`Base ${de}`} inputMode="decimal" value={l.base} readOnly={soloLectura}
                onChange={(e) => poner(i, { base: e.target.value }, true)} />
              <select className="s-control" aria-label={`Tipo de IVA de la línea ${i + 1}`} value={l.tipo} disabled={soloLectura}
                onChange={(e) => poner(i, { tipo: e.target.value }, true)}>
                {l.tipo === '' && <option value="">— Elige el tipo</option>}
                {ofrecidos.map((t) => <option key={t} value={String(t)}>{textoTipo(t)}</option>)}
              </select>
              <input className="s-control s-cifra cxf-importe" aria-label={`Cuota ${de}`} inputMode="decimal" value={l.cuota} readOnly={soloLectura}
                onChange={(e) => poner(i, { cuota: e.target.value }, false)} />
              {!soloLectura && iva.length > 1
                ? <button type="button" className="cxf-quitar" aria-label={`Quitar la línea ${de}`} onClick={() => alCambiar({ iva: iva.filter((_, k) => k !== i) })}><Icono nombre="cerrar" /></button>
                : <span />}
            </div>
          )
        })}
        {retencion && (
          <div className="cxf-iva-linea" role="group" aria-label="Retención (IRPF)" data-prueba="linea-retencion" data-cambiado={cRet ? '' : undefined}>
            <span className="cxf-iva-rotulo">Retención (IRPF)</span>
            <select className="s-control" aria-label="Tipo de la retención" value={retencion.tipo} disabled={soloLectura}
              onChange={(e) => {
                const t = Number(e.target.value)
                alCambiar({ retencion: { tipo: e.target.value, importe: e.target.value && Number.isFinite(t) ? importeEs(cuotaIva(base, t)) : retencion.importe } })
              }}>
              <option value="">— Elige el tipo</option>
              {TIPOS_RETENCION.map((t) => <option key={t} value={String(t)}>{textoTipo(t)}</option>)}
            </select>
            <input className="s-control s-cifra cxf-importe" aria-label="Importe de la retención" inputMode="decimal" value={retencion.importe} readOnly={soloLectura}
              onChange={(e) => alCambiar({ retencion: { ...retencion, importe: e.target.value } })} />
            {!soloLectura ? <button type="button" className="cxf-quitar" aria-label="Quitar la retención" onClick={() => alCambiar({ retencion: null })}><Icono nombre="cerrar" /></button> : <span />}
          </div>
        )}
        {recargo && (
          <div className="cxf-iva-linea" role="group" aria-label="Recargo de equivalencia" data-prueba="linea-recargo" data-cambiado={cRec ? '' : undefined}>
            <span className="cxf-iva-rotulo">Recargo de equivalencia</span>
            <span />
            <input className="s-control s-cifra cxf-importe" aria-label="Importe del recargo de equivalencia" inputMode="decimal" value={recargo.importe} readOnly={soloLectura}
              onChange={(e) => alCambiar({ recargo: { ...recargo, importe: e.target.value } })} />
            {!soloLectura ? <button type="button" className="cxf-quitar" aria-label="Quitar el recargo" onClick={() => alCambiar({ recargo: null })}><Icono nombre="cerrar" /></button> : <span />}
          </div>
        )}
        {errores.map((e) => <p key={e} className="cxf-error" role="alert">{e}</p>)}
        {!soloLectura && (
          <div className="cxf-anadir">
            <button type="button" className="s-boton s-boton-enlace" onClick={() => alCambiar({ iva: [...iva, otroTipo(iva, ofrecidos)] })}>+ Otro tipo de IVA</button>
            {!retencion && <button type="button" className="s-boton s-boton-enlace" onClick={() => alCambiar({ retencion: { tipo: '15', importe: importeEs(cuotaIva(base, 15)) } })}>+ Retención (IRPF)</button>}
            {!recargo && <button type="button" className="s-boton s-boton-enlace" onClick={() => alCambiar({ recargo: { tipo: '', importe: '' } })}>+ Recargo de equivalencia</button>}
          </div>
        )}
        <div className="cxf-totales" role="status" aria-live="polite" data-prueba="totales-iva">
          <span>Base <strong className="s-cifra">{importeEs(totales.base)}</strong></span>
          <span>IVA <strong className="s-cifra">{importeEs(totales.iva)}</strong></span>
          {!!totales.recargo && <span>Recargo <strong className="s-cifra">{importeEs(totales.recargo)}</strong></span>}
          {!!totales.retencion && <span>Retención <strong className="s-cifra">−{importeEs(totales.retencion)}</strong></span>}
          <span className="cxf-total">{abono ? 'Total a tu favor' : 'Total'} <strong className="s-cifra">{eurosExactos(totales.total)}</strong></span>
          {contra && (
            <span className="cxf-contra" data-igual={contra.redondeo ? 'redondeo' : contra.igual === true ? 'si' : contra.igual === false ? 'no' : undefined} data-prueba="contra-pdf">
              {contra.igual === true && !contra.redondeo && <Icono nombre="ok" />} {contra.texto}
            </span>
          )}
        </div>
        {(cIva || cRet || cRec) && (
          <div className="cxf-antes">
            {cIva && <MarcaCambiado cambio={cIva} onDeshacer={() => deshacer('iva')} parte="antes" />}
            {cRet && <MarcaCambiado cambio={cRet} onDeshacer={() => deshacer('retencion')} parte="antes" />}
            {cRec && <MarcaCambiado cambio={cRec} onDeshacer={() => deshacer('recargo')} parte="antes" />}
          </div>
        )}
      </div>
    </BloqueFicha>
  )
}

// ── A qué gasto va ──────────────────────────────────────────────────────────

export function BloqueGasto({ gastos, base, cuentas, locales, nombreEje, alCambiar, cambio, alDeshacer, tono, motivo, soloLectura, elegirLocal, errorLocal, sinReparto }: {
  gastos: readonly LineaGasto[]
  base: number
  cuentas: readonly CuentaHoja[]
  /** Sin eje de local, no se pregunta el local. */
  locales: readonly { id: string; nombre: string }[] | null
  nombreEje: string
  alCambiar: (g: LineaGasto[]) => void
  cambio?: Cambio
  alDeshacer: () => void
  tono: TonoCampo
  motivo?: ReactNode
  soloLectura: boolean
  /** La a mano: el local hay que elegirlo («Elige el local…»), y «Común» es LOCAL_COMUN. */
  elegirLocal?: { comun: string }
  errorLocal?: string
  /** Sin «+ Repartir»: la a mano guarda una cuenta y un local (el reparto, en su ficha). */
  sinReparto?: boolean
}) {
  const [buscando, setBuscando] = useState<number | null>(null)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const conImporte = gastosConImporte(gastos, base)
  const cuadre = cuadraElGasto(gastos, base)
  const nombre = (c: string) => cuentas.find((x) => x.codigo === c)?.nombre ?? (c ? 'Cuenta' : 'Sin cuenta todavía')
  const poner = (i: number, l: Partial<LineaGasto>) => alCambiar(gastos.map((g, k) => (k === i ? { ...g, ...l } : g)))
  const cambiado = !!cambio
  return (
    <BloqueFicha titulo="A qué gasto va">
      <div className="cxf-gasto" data-prueba="gasto" data-cambiado={cambiado ? '' : undefined}>
        <div className="cxf-gasto-cabeza" aria-hidden="true" data-con-local={locales ? '' : undefined}>
          <span>Cuenta de gasto {!cambiado && tono === 'propuesto' && <span className="s-campo-propuesto">Propuesto</span>}
            {!cambiado && tono === 'revisar' && <span className="s-campo-revisar">Por revisar</span>}
            {cambiado && <MarcaCambiado cambio={cambio} onDeshacer={alDeshacer} parte="etiqueta" />}</span>
          {locales && <span>{nombreEje}</span>}
          <span className="s-lista-cifra">Importe</span>
          <span />
        </div>
        {gastos.map((g, i) => (
          <div key={i} className="cxf-gasto-linea" role="group" aria-label={`Gasto ${i + 1}`} data-con-local={locales ? '' : undefined} data-tono={cambiado ? undefined : tono} data-prueba="linea-gasto">
            <div className="cxf-cuenta">
              <button type="button" ref={(el) => { refs.current[i] = el }} className="s-control cxf-cuenta-boton" disabled={soloLectura}
                aria-label={`Cuenta de gasto${g.cuenta ? `: ${g.cuenta} ${nombre(g.cuenta)}` : ''}. F4 para buscarla`} aria-keyshortcuts="F4"
                onClick={() => setBuscando(i)} onKeyDown={(e) => { if (e.key === 'F4') { e.preventDefault(); setBuscando(i) } }}>
                {g.cuenta ? <><strong className="cxf-cuenta-codigo s-cifra">{g.cuenta}</strong> <span className="cxf-cuenta-nombre">{nombre(g.cuenta)}</span></> : <span className="cxf-cuenta-nombre">Elige la cuenta…</span>}
                {!soloLectura && <Tecla>F4</Tecla>}
              </button>
              {buscando === i && (
                <BuscarCuentaHoja cuentas={cuentas} inicial="" alElegir={(c) => { poner(i, { cuenta: c.codigo }); setBuscando(null); refs.current[i]?.focus() }}
                  alCerrar={(volver) => { setBuscando(null); if (volver) refs.current[i]?.focus() }} />
              )}
            </div>
            {locales && (
              <select className="s-control" aria-label={gastos.length === 1 ? nombreEje : `${nombreEje} del gasto ${i + 1}`} value={g.local} disabled={soloLectura}
                aria-invalid={errorLocal ? true : undefined} onChange={(e) => poner(i, { local: e.target.value })}>
                {elegirLocal ? <option value="">Elige el {nombreEje.toLowerCase()}…</option> : <option value="">Común (se reparte)</option>}
                {locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                {elegirLocal && <option value={elegirLocal.comun}>Común (se reparte)</option>}
              </select>
            )}
            <input className="s-control s-cifra cxf-importe" aria-label={`Importe del gasto ${i + 1}`} inputMode="decimal"
              readOnly={soloLectura || gastos.length === 1} title={gastos.length === 1 ? 'Toda la base' : undefined}
              value={g.importe === '' ? importeEs(conImporte[i]?.importe ?? 0) : g.importe}
              onChange={(e) => poner(i, { importe: e.target.value })} />
            {!soloLectura && gastos.length > 1
              ? <button type="button" className="cxf-quitar" aria-label={`Quitar el gasto ${i + 1}`} onClick={() => alCambiar(gastos.filter((_, k) => k !== i))}><Icono nombre="cerrar" /></button>
              : <span />}
          </div>
        ))}
        {cambiado ? <MarcaCambiado cambio={cambio} onDeshacer={alDeshacer} parte="antes" /> : motivo && <p className="s-campo-ficha-motivo">{motivo}</p>}
        {errorLocal && <p className="cxf-error" role="alert">{errorLocal}</p>}
        {cuadre && <p className="cxf-error" role="status">{cuadre}</p>}
        {!soloLectura && !sinReparto && (
          <div className="cxf-anadir">
            <button type="button" className="s-boton s-boton-enlace"
              onClick={() => alCambiar([...gastos.map((g, k) => (k === 0 && g.importe === '' ? { ...g, importe: importeEs(conImporte[0]?.importe ?? 0) } : g)), { cuenta: gastos[0]?.cuenta ?? '', local: '', importe: '' }])}>
              + Repartir en varias cuentas o locales
            </button>
          </div>
        )}
      </div>
    </BloqueFicha>
  )
}

// ── Pago ─────────────────────────────────────────────────────────────────────

export function BloquePago({ formaPago, vence, estadoPago, alCambiar, cambioDe, deshacer, motivoVence, tonoVence, motivoForma, pagada, soloLectura }: {
  formaPago: string
  vence: string
  estadoPago: string
  alCambiar: (c: { formaPago?: string; vence?: string; estadoPago?: string }) => void
  cambioDe: (campo: 'formaPago' | 'vence' | 'estadoPago') => Cambio
  deshacer: (campo: 'formaPago' | 'vence' | 'estadoPago') => void
  motivoVence?: ReactNode
  tonoVence?: TonoCampo
  motivoForma?: ReactNode
  /** Ya pagada: con qué y cuándo. */
  pagada: ReactNode
  soloLectura: boolean
}) {
  return (
    <BloqueFicha titulo="Pago">
      <div className="s-fila-campos">
        <CampoEditable etiqueta="Forma de pago" cambio={cambioDe('formaPago')} alDeshacer={() => deshacer('formaPago')} motivo={motivoForma} prueba="campo-forma-pago">
          <select className="s-control" aria-label="Forma de pago" value={formaPago} disabled={soloLectura} onChange={(e) => alCambiar({ formaPago: e.target.value })}>
            {FORMAS_PAGO.map((f) => <option key={f.valor} value={f.valor}>{f.texto}</option>)}
          </select>
        </CampoEditable>
        <CampoEditable etiqueta="Vence" cambio={cambioDe('vence')} alDeshacer={() => deshacer('vence')} motivo={motivoVence} tono={tonoVence} prueba="campo-vence">
          {soloLectura
            ? <input className="s-control" aria-label="Vence" value={vence ? `${vence.slice(8, 10)}/${vence.slice(5, 7)}/${vence.slice(0, 4)}` : ''} readOnly />
            : <Fecha id="cxf-vence" aria-label="Vence" valor={vence} alCambiar={(v) => alCambiar({ vence: v })} />}
        </CampoEditable>
        <CampoEditable etiqueta="Estado" cambio={cambioDe('estadoPago')} alDeshacer={() => deshacer('estadoPago')} prueba="campo-estado-pago"
          motivo={pagada ?? (estadoPago === 'sin_pagar' ? 'Se casará sola con el banco.' : undefined)}>
          <select className="s-control" aria-label="Estado del pago" value={estadoPago} disabled={soloLectura} onChange={(e) => alCambiar({ estadoPago: e.target.value })}>
            {ESTADOS_PAGO.map((f) => <option key={f.valor} value={f.valor}>{f.texto}</option>)}
          </select>
        </CampoEditable>
      </div>
    </BloqueFicha>
  )
}

// ── El hueco del PDF, cuando no lo hay ─────────────────────────────────────

/** «Arrastra aquí el PDF o la foto · Subir», y la casilla «Sin PDF» con su motivo. */
export function HuecoPapel({ alElegir, sinPdf, motivoSinPdf, alCambiarSinPdf, cambioSinPdf, deshacerSinPdf, soloLectura, nota }: {
  alElegir: (f: File) => void
  sinPdf: boolean
  motivoSinPdf: string
  alCambiarSinPdf: (c: { sinPdf?: boolean; motivoSinPdf?: string }) => void
  cambioSinPdf?: Cambio
  deshacerSinPdf: () => void
  soloLectura: boolean
  /** Lo que se dice encima («Llegó «x.pdf», pero no encuentro el fichero»). */
  nota?: ReactNode
}) {
  const [encima, setEncima] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const soltar = (e: DragEvent) => {
    e.preventDefault(); setEncima(false)
    const f = e.dataTransfer.files?.[0]
    if (f) alElegir(f)
  }
  return (
    <div className="cxf-hueco" data-prueba="hueco-pdf">
      {nota && <p className="s-documento-nada">{nota}</p>}
      {!sinPdf && !soloLectura && (
        <div className="cxf-soltar" data-encima={encima ? '' : undefined} onDragOver={(e) => { e.preventDefault(); setEncima(true) }} onDragLeave={() => setEncima(false)} onDrop={soltar}>
          <Icono nombre="documento" />
          <p>Arrastra aquí el PDF o la foto · <Boton variante="enlace" onClick={() => input.current?.click()}>Subir</Boton></p>
          <p className="s-apoyo">Una foto se guarda como PDF.</p>
          <input ref={input} type="file" accept={ACEPTA_PAPEL} hidden aria-label="Subir el PDF o la foto de la factura"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) alElegir(f); e.target.value = '' }} />
        </div>
      )}
      <div className="cxf-sin-pdf" data-cambiado={cambioSinPdf ? '' : undefined}>
        <label className="cxf-casilla">
          <input type="checkbox" checked={sinPdf} disabled={soloLectura} onChange={(e) => alCambiarSinPdf({ sinPdf: e.target.checked })} /> Sin PDF: de verdad no hay documento
        </label>
        {sinPdf && (
          <label className="cxf-motivo">Por qué no hay
            <input className="s-control" value={motivoSinPdf} readOnly={soloLectura} maxLength={200} placeholder="Ej.: ticket de gasolinera perdido; el proveedor no emite factura"
              onChange={(e) => alCambiarSinPdf({ motivoSinPdf: e.target.value })} />
          </label>
        )}
        {cambioSinPdf && <MarcaCambiado cambio={cambioSinPdf} onDeshacer={deshacerSinPdf} parte="antes" />}
      </div>
    </div>
  )
}

// ── Historial ───────────────────────────────────────────────────────────────

export function BloqueHistorial({ hechos, error }: { hechos: readonly HechoHistorial[] | null; error?: string | null }) {
  return (
    <section className="cxf-historial" id="historial" aria-label="Historial" data-prueba="historial" tabIndex={-1}>
      <h2>Historial</h2>
      {error && <p className="s-apoyo">No se ha podido leer el historial: {error}</p>}
      {!error && !hechos && <p className="s-apoyo">Leyendo el historial…</p>}
      {hechos && (
        <ul>
          {hechos.map((h, i) => <li key={i}><span className="s-cifra">{diaDeHecho(h.cuando)}</span> · {h.texto}</li>)}
        </ul>
      )}
    </section>
  )
}

/** «Editar el asiento a mano»: cambiar la cuenta de una línea (F4 para buscarla). */
export function EditarAsientoAMano({ lineas, cuentas, aMano, alCambiar, alCerrar }: {
  lineas: readonly { codigo: string; nombre: string; importe: string }[]
  cuentas: readonly CuentaHoja[]
  aMano: Record<string, string>
  alCambiar: (m: Record<string, string>) => void
  alCerrar: () => void
}) {
  const [buscando, setBuscando] = useState<string | null>(null)
  return (
    <section className="cxf-a-mano" aria-label="Editar el asiento a mano" data-prueba="asiento-a-mano">
      <p className="s-apoyo">Cambia la cuenta de una línea. Lo tocado queda marcado «Cambiado a mano».</p>
      <ul>
        {lineas.filter((l) => l.codigo).map((l) => {
          const elegida = aMano[l.codigo] ?? l.codigo
          return (
            <li key={l.codigo} className="cxf-a-mano-linea">
              <span className="s-cifra">{l.importe}</span>
              <button type="button" className="s-control cxf-cuenta-boton" aria-label={`Cuenta de la línea de ${l.importe}: ${elegida}. F4 para buscarla`} aria-keyshortcuts="F4"
                onClick={() => setBuscando(l.codigo)} onKeyDown={(e) => { if (e.key === 'F4') { e.preventDefault(); setBuscando(l.codigo) } }}>
                <strong className="cxf-cuenta-codigo s-cifra">{elegida}</strong> <span className="cxf-cuenta-nombre">{cuentas.find((c) => c.codigo === elegida)?.nombre ?? l.nombre}</span>
              </button>
              {buscando === l.codigo && (
                <BuscarCuentaHoja cuentas={cuentas} inicial="" alElegir={(c) => { alCambiar({ ...aMano, [l.codigo]: c.codigo }); setBuscando(null) }} alCerrar={() => setBuscando(null)} />
              )}
            </li>
          )
        })}
      </ul>
      <Boton variante="secundario" onClick={alCerrar}>Hecho</Boton>
    </section>
  )
}
