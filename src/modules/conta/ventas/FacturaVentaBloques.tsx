// src/modules/conta/ventas/FacturaVentaBloques.tsx
//
// V01 · Entrega 1 · Los bloques de la ficha de una factura de venta (tablero
// 11): el cliente, las líneas, los totales, el cobro y los diálogos (cliente
// nuevo, emitir, registrar cobro, corregir). La página los junta en
// FacturaVentaPage.tsx; lo que se decide sin React, en lib/facturasVenta.ts.

import { useState } from 'react'
import { BloqueFicha, CampoFicha, FilaCampos } from '@/modules/conta/diseno/plantillas'
import { Boton, Campo, Dialogo, Fecha, Selector, Texto } from '@/modules/conta/diseno'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { normalizarNif, tipoEntidadPorNif, validarNifEs } from '@/modules/conta/lib/nif'
import { guardarCliente, terceroDelMismoNif } from '@/modules/conta/services/tercerosService'
import type { Catalogos, CobroFactura } from '@/modules/conta/services/ventasService'
import {
  NOMBRE_CORRECCION, baseDeLinea, lineaVacia, numeroDeTexto, textoDeNumero,
  type CifrasFactura, type LineaEnEdicion, type LineaFactura,
} from '@/modules/conta/lib/facturasVenta'

const fechaEs = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—')

// ── Las líneas ─────────────────────────────────────────────────────────────────

/** Las líneas mientras se escriben: concepto, cantidad, precio, descuento, IVA, cuenta e importe. */
export function LineasEditables({ lineas, catalogos, alCambiar, soloImportes = false }: {
  lineas: readonly LineaEnEdicion[]
  catalogos: Catalogos
  alCambiar: (ls: LineaEnEdicion[]) => void
  /** Una rectificativa de importes: se cambian las cifras, no se añaden ni quitan líneas de otra cosa. */
  soloImportes?: boolean
}) {
  const tipoDeSerie = catalogos.tipos.find((t) => t.tipo === 21)?.id ?? catalogos.tipos[0]?.id ?? ''
  const cuentaDeSerie = catalogos.cuentas.find((c) => c.code.startsWith('705'))?.id ?? catalogos.cuentas[0]?.id ?? ''
  const poner = (i: number, c: Partial<LineaEnEdicion>) => alCambiar(lineas.map((l, j) => (j === i ? { ...l, ...c } : l)))
  const importe = (l: LineaEnEdicion) => {
    const cant = numeroDeTexto(l.cantidad); const precio = numeroDeTexto(l.precio); const dto = l.descuento.trim() ? numeroDeTexto(l.descuento) : 0
    return cant === null || precio === null || dto === null ? null : baseDeLinea({ cantidad: cant, precio, descuento: dto })
  }
  return (
    <div className="cxv-lineas" role="group" aria-label="Líneas de la factura">
      <table className="cxv-lineas-tabla">
        <thead>
          <tr>
            <th scope="col">Concepto</th><th scope="col" className="cxv-num">Cantidad</th><th scope="col" className="cxv-num">Precio</th>
            <th scope="col" className="cxv-num">Dto. %</th><th scope="col">IVA</th><th scope="col">Cuenta</th><th scope="col" className="cxv-num">Importe</th><th scope="col"><span className="s-solo-lector">Quitar</span></th>
          </tr>
        </thead>
        <tbody>
          {lineas.map((l, i) => {
            const imp = importe(l)
            return (
              <tr key={i}>
                <td data-titulo="Concepto"><Texto valor={l.concepto} alCambiar={(v) => poner(i, { concepto: v })} aria-label={`Concepto de la línea ${i + 1}`} maxLength={500} placeholder="Menú del día" /></td>
                <td data-titulo="Cantidad" className="cxv-num"><Texto valor={l.cantidad} alCambiar={(v) => poner(i, { cantidad: v })} aria-label={`Cantidad de la línea ${i + 1}`} inputMode="decimal" /></td>
                <td data-titulo="Precio" className="cxv-num"><Texto valor={l.precio} alCambiar={(v) => poner(i, { precio: v })} aria-label={`Precio de la línea ${i + 1}`} inputMode="decimal" placeholder="0,00" /></td>
                <td data-titulo="Dto. %" className="cxv-num"><Texto valor={l.descuento} alCambiar={(v) => poner(i, { descuento: v })} aria-label={`Descuento de la línea ${i + 1}`} inputMode="decimal" placeholder="0" /></td>
                <td data-titulo="IVA"><Selector valor={l.tipoId} alCambiar={(v) => poner(i, { tipoId: v })} aria-label={`IVA de la línea ${i + 1}`}
                  opciones={catalogos.tipos.map((t) => ({ valor: t.id, texto: `${textoDeNumero(t.tipo, 0)} %` }))} /></td>
                <td data-titulo="Cuenta"><Selector valor={l.cuentaId} alCambiar={(v) => poner(i, { cuentaId: v })} aria-label={`Cuenta de la línea ${i + 1}`}
                  opciones={catalogos.cuentas.map((c) => ({ valor: c.id, texto: `${c.code} · ${c.nombre}` }))} /></td>
                <td data-titulo="Importe" className="cxv-num s-cifra">{imp === null ? '—' : eurosExactos(imp)}</td>
                <td>{!soloImportes && lineas.length > 1 && <Boton variante="fantasma" onClick={() => alCambiar(lineas.filter((_, j) => j !== i))} aria-label={`Quitar la línea ${i + 1}`}>✕</Boton>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {!soloImportes && <Boton variante="enlace" icono="nuevo" onClick={() => alCambiar([...lineas, lineaVacia(tipoDeSerie, cuentaDeSerie)])}>Añadir línea</Boton>}
    </div>
  )
}

/** Las líneas de una emitida, para leer. */
export function LineasLeer({ lineas, debiaSer = false }: { lineas: readonly LineaFactura[]; debiaSer?: boolean }) {
  return (
    <table className="cxv-lineas-tabla" aria-label="Líneas de la factura">
      <thead>
        <tr><th scope="col">Concepto</th><th scope="col" className="cxv-num">Cantidad</th><th scope="col" className="cxv-num">Precio</th><th scope="col" className="cxv-num">IVA</th><th scope="col" className="cxv-num">{debiaSer ? 'Debía ser' : 'Importe'}</th></tr>
      </thead>
      <tbody>
        {lineas.map((l, i) => (
          <tr key={i}>
            <td data-titulo="Concepto">{l.concepto}{l.descuento ? <span className="s-tarjeta-apoyo"> · dto. {textoDeNumero(l.descuento, 0)} %</span> : null}</td>
            <td data-titulo="Cantidad" className="cxv-num s-cifra">{textoDeNumero(l.cantidad, 3)}</td>
            <td data-titulo="Precio" className="cxv-num s-cifra">{eurosExactos(l.precio)}</td>
            <td data-titulo="IVA" className="cxv-num s-cifra">{textoDeNumero(l.tipo, 0)} %</td>
            <td data-titulo={debiaSer ? 'Debía ser' : 'Importe'} className="cxv-num s-cifra">{eurosExactos(baseDeLinea(l))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Base e IVA por tipo, la retención y el total. */
export function Totales({ cifras, retencionPct, diferencia = false }: { cifras: CifrasFactura; retencionPct: number; diferencia?: boolean }) {
  return (
    <dl className="cxv-totales" aria-label={diferencia ? 'La diferencia' : 'Totales'}>
      {diferencia && <p className="s-apoyo">Los importes son la diferencia con la factura que rectifica.</p>}
      {cifras.porTipo.map((t) => (
        <div key={t.tipo} className="cxv-totales-tipo">
          <div><dt>Base {textoDeNumero(t.tipo, 0)} %</dt><dd className="s-cifra">{eurosExactos(t.base)}</dd></div>
          <div><dt>IVA {textoDeNumero(t.tipo, 0)} %</dt><dd className="s-cifra">{eurosExactos(t.iva)}</dd></div>
        </div>
      ))}
      {cifras.retencion !== 0 && <div><dt>Retención IRPF {textoDeNumero(retencionPct, 0)} %</dt><dd className="s-cifra">−{eurosExactos(cifras.retencion)}</dd></div>}
      <div className="cxv-totales-total"><dt>Total</dt><dd className="s-cifra">{eurosExactos(cifras.total)}</dd></div>
    </dl>
  )
}

// ── El cobro ─────────────────────────────────────────────────────────────────

export function BloqueCobro({ total, cobros, alRegistrar, anulada }: { total: number; cobros: readonly CobroFactura[]; alRegistrar: (() => void) | null; anulada: boolean }) {
  const cobrado = cobros.reduce((t, c) => t + Math.round(c.importe * 100), 0) / 100
  const queda = Math.max(0, Math.round(total * 100) - Math.round(cobrado * 100)) / 100
  return (
    <BloqueFicha titulo="Cobro" accion={alRegistrar ? <Boton variante="enlace" onClick={alRegistrar}>Registrar cobro</Boton> : undefined}>
      {anulada ? <p className="s-apoyo">Anulada: no se cobra.</p> : total <= 0 ? <p className="s-apoyo">Va en negativo: no se cobra (se descuenta de lo que te debe el cliente).</p> : (
        <>
          <FilaCampos columnas={3}>
            <CampoFicha etiqueta="Total" valor={eurosExactos(total)} cifra />
            <CampoFicha etiqueta="Cobrado" valor={eurosExactos(cobrado)} cifra />
            <CampoFicha etiqueta="Queda" valor={eurosExactos(queda)} cifra tono={queda > 0 ? 'revisar' : 'normal'} />
          </FilaCampos>
          {cobros.length > 0 && (
            <ul className="cxv-cobros" aria-label="Cobros">
              {cobros.map((c) => <li key={c.id}><span className="s-cifra">{fechaEs(c.fecha)}</span> · <strong className="s-cifra">{eurosExactos(c.importe)}</strong>{c.forma ? ` · ${c.forma}` : ''}{c.nota ? ` · ${c.nota}` : ''}{c.quien ? ` · ${c.quien}` : ''}</li>)}
            </ul>
          )}
          {cobros.length === 0 && <p className="s-apoyo">Sin cobros todavía. El asiento del cobro lo hace Bancos al casar el movimiento.</p>}
        </>
      )}
    </BloqueFicha>
  )
}

// ── Diálogos ────────────────────────────────────────────────────────────────

/** Un cliente nuevo, sin salir de la factura: nombre, NIF comprobado y dirección. */
export function DialogoClienteNuevo({ accountId, quien, alCerrar, alGuardar }: {
  accountId: string; quien: string | null; alCerrar: () => void; alGuardar: (partyId: string) => void
}) {
  const [d, setD] = useState({ nombre: '', nif: '', calle: '', cp: '', ciudad: '', provincia: '' })
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const nif = d.nif.trim() ? validarNifEs(d.nif) : null
  const listo = d.nombre.trim().length > 1 && (!nif || nif.ok)
  const guardar = async () => {
    setOcupado(true); setFallo(null)
    try {
      const n = nif && nif.ok ? nif.normalizado : null
      const r = await guardarCliente(accountId, null, d.nombre.trim(), n, {
        legalName: d.nombre.trim(), countryCode: 'ES', taxIdType: n ? 'nif_es' : null, entityKind: n ? tipoEntidadPorNif(normalizarNif(n)) : null,
        fiscalStreet: d.calle.trim() || null, fiscalPostalCode: d.cp.trim() || null, fiscalCity: d.ciudad.trim() || null, fiscalProvince: d.provincia.trim() || null,
      }, quien)
      alGuardar(r.party_id)
    } catch (e) {
      const otro = terceroDelMismoNif(e)
      setFallo(otro ? 'Ese NIF ya es de otro contacto: búscalo en la lista de clientes.' : e instanceof Error ? e.message : String(e))
    } finally { setOcupado(false) }
  }
  return (
    <Dialogo titulo="Cliente nuevo" alCerrar={alCerrar}
      explicacion="Queda en Contactos como cliente. Sin NIF se puede guardar, pero la factura no se puede emitir hasta que lo tenga."
      acciones={<>
        <Boton variante="secundario" onClick={alCerrar}>Cancelar</Boton>
        <Boton variante="principal" disabled={!listo || ocupado} onClick={() => void guardar()}>{ocupado ? 'Guardando…' : 'Guardar el cliente'}</Boton>
      </>}>
      <Campo etiqueta="Nombre o razón social">{(p) => <Texto {...p} valor={d.nombre} alCambiar={(v) => setD({ ...d, nombre: v })} maxLength={200} />}</Campo>
      <Campo etiqueta="NIF" error={nif && !nif.ok ? nif.motivo : null} ayuda={nif?.ok ? `Comprobado: ${nif.tipo === 'cif' ? 'CIF de empresa' : nif.tipo === 'nie' ? 'NIE' : 'NIF'} con su letra de control correcta.` : 'El de la empresa o la persona a la que facturas.'}>
        {(p) => <Texto {...p} valor={d.nif} alCambiar={(v) => setD({ ...d, nif: v })} maxLength={20} autoComplete="off" />}
      </Campo>
      <Campo etiqueta="Dirección">{(p) => <Texto {...p} valor={d.calle} alCambiar={(v) => setD({ ...d, calle: v })} maxLength={200} placeholder="Calle y número" />}</Campo>
      <div className="cxv-fila-dialogo">
        <Campo etiqueta="Código postal">{(p) => <Texto {...p} valor={d.cp} alCambiar={(v) => setD({ ...d, cp: v })} maxLength={10} inputMode="numeric" />}</Campo>
        <Campo etiqueta="Población">{(p) => <Texto {...p} valor={d.ciudad} alCambiar={(v) => setD({ ...d, ciudad: v })} maxLength={100} />}</Campo>
        <Campo etiqueta="Provincia">{(p) => <Texto {...p} valor={d.provincia} alCambiar={(v) => setD({ ...d, provincia: v })} maxLength={100} />}</Campo>
      </div>
      {fallo && <p className="s-aviso-lista" data-tono="falta" role="alert">{fallo}</p>}
    </Dialogo>
  )
}

/** Emitir: lo que va a pasar, y si se manda por correo. */
export function DialogoEmitir({ que, total, correo, hayCambios, alCerrar, alEmitir }: {
  que: string; total: number; correo: string; hayCambios: boolean; alCerrar: () => void; alEmitir: (enviar: boolean, para: string) => void
}) {
  const [enviar, setEnviar] = useState(!!correo)
  const [para, setPara] = useState(correo)
  const correoBueno = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(para.trim())
  return (
    <Dialogo titulo={`Emitir ${que}`} alCerrar={alCerrar}
      explicacion={<>Por {eurosExactos(total)}. Al emitir se le da su número, se hace su PDF y su asiento, y va a Diez. Una emitida ya no se borra: se corrige con una rectificativa.{hayCambios ? ' Antes se guardan tus cambios.' : ''}</>}
      acciones={<>
        <Boton variante="secundario" onClick={alCerrar}>Cancelar</Boton>
        <Boton variante="principal" disabled={enviar && !correoBueno} onClick={() => alEmitir(enviar, para.trim())}>Emitir</Boton>
      </>}>
      <label className="cxv-casilla"><input type="checkbox" checked={enviar} onChange={(e) => setEnviar(e.target.checked)} /> Mandársela al cliente por correo, con el PDF</label>
      {enviar && <Campo etiqueta="Correo del cliente" error={para && !correoBueno ? 'Ese correo no está bien escrito.' : null}>{(p) => <Texto {...p} type="email" valor={para} alCambiar={setPara} maxLength={200} />}</Campo>}
    </Dialogo>
  )
}

/** Registrar un cobro (puede ser una parte). */
export function DialogoCobro({ numero, queda, hoy, formas, alCerrar, alCobrar }: {
  numero: string; queda: number; hoy: string; formas: Catalogos['formas']; alCerrar: () => void
  alCobrar: (c: { fecha: string; importe: number; forma: string | null; nota: string | null }) => Promise<string | null>
}) {
  const [fecha, setFecha] = useState(hoy)
  const [importe, setImporte] = useState(textoDeNumero(queda))
  const [forma, setForma] = useState('')
  const [nota, setNota] = useState('')
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const n = numeroDeTexto(importe)
  const mal = n === null || n <= 0 ? 'Pon cuánto has cobrado.' : Math.round(n * 100) > Math.round(queda * 100) ? `Quedan ${eurosExactos(queda)} por cobrar: no puede ser más.` : null
  return (
    <Dialogo titulo={`Registrar cobro de la ${numero}`} alCerrar={alCerrar}
      explicacion={`Quedan ${eurosExactos(queda)}. Si te ha pagado una parte, pon esa parte. En efectivo, hace su asiento (570 Caja a 430); por banco, no: lo hace Bancos al casar el movimiento.`}
      acciones={<>
        <Boton variante="secundario" onClick={alCerrar}>Cancelar</Boton>
        <Boton variante="principal" disabled={!!mal || ocupado} onClick={() => {
          setOcupado(true); setFallo(null)
          void alCobrar({ fecha, importe: n!, forma: formas.find((f) => f.id === forma)?.nombre ?? null, nota: nota.trim() || null }).then((e) => { setFallo(e); setOcupado(false) })
        }}>{ocupado ? 'Guardando…' : 'Registrar cobro'}</Boton>
      </>}>
      <div className="cxv-fila-dialogo">
        <Campo etiqueta="Fecha">{(p) => <Fecha {...p} valor={fecha} alCambiar={setFecha} />}</Campo>
        <Campo etiqueta="Importe" error={importe && mal ? mal : null}>{(p) => <Texto {...p} valor={importe} alCambiar={setImporte} inputMode="decimal" />}</Campo>
      </div>
      <Campo etiqueta="Cómo te ha pagado">{(p) => <Selector {...p} valor={forma} alCambiar={setForma} opciones={[{ valor: '', texto: 'Sin decir' }, ...formas.map((f) => ({ valor: f.id, texto: f.nombre }))]} />}</Campo>
      <Campo etiqueta="Nota">{(p) => <Texto {...p} valor={nota} alCambiar={setNota} maxLength={200} placeholder="Opcional" />}</Campo>
      {fallo && <p className="s-aviso-lista" data-tono="falta" role="alert">{fallo}</p>}
    </Dialogo>
  )
}

/** Corregir una emitida: importes o líneas, anularla entera, o los datos del cliente. */
export function DialogoCorregir({ numero, alCerrar, alCorregir, sinDatos = false }: {
  numero: string; alCerrar: () => void; alCorregir: (tipo: 'importes' | 'anular' | 'datos', motivo: string) => Promise<string | null>
  /** V01 · Entrega 2: una factura resumen de un cierre no lleva cliente: no se corrigen «datos del cliente». */
  sinDatos?: boolean
}) {
  const [tipo, setTipo] = useState<'importes' | 'anular' | 'datos'>('importes')
  const [motivo, setMotivo] = useState('')
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  return (
    <Dialogo titulo={`Corregir la ${numero}`} alCerrar={alCerrar}
      explicacion="Una factura emitida no se cambia ni se borra: se corrige con una rectificativa (serie R), que queda enlazada a ella. Primero se prepara como borrador; al emitirla lleva su PDF, su asiento y va a Diez."
      acciones={<>
        <Boton variante="secundario" onClick={alCerrar}>Cancelar</Boton>
        <Boton variante="principal" disabled={!motivo.trim() || ocupado} onClick={() => {
          setOcupado(true); setFallo(null)
          void alCorregir(tipo, motivo.trim()).then((e) => { setFallo(e); setOcupado(false) })
        }}>{ocupado ? 'Preparando…' : 'Preparar la rectificativa'}</Boton>
      </>}>
      <div role="radiogroup" aria-label="Qué hay que corregir" className="cxv-opciones">
        {(sinDatos ? ['importes', 'anular'] as const : ['importes', 'anular', 'datos'] as const).map((t) => (
          <label key={t} className="cxv-opcion" data-elegida={tipo === t ? '' : undefined}>
            <input type="radio" name="corregir" checked={tipo === t} onChange={() => setTipo(t)} />
            <span><strong>{NOMBRE_CORRECCION[t].titulo}</strong><span className="s-tarjeta-apoyo">{NOMBRE_CORRECCION[t].texto}</span></span>
          </label>
        ))}
      </div>
      <Campo etiqueta="Motivo" ayuda="Sale en la rectificativa: «Eran 240 menús y fueron 232».">{(p) => <Texto {...p} valor={motivo} alCambiar={setMotivo} maxLength={300} />}</Campo>
      {fallo && <p className="s-aviso-lista" data-tono="falta" role="alert">{fallo}</p>}
    </Dialogo>
  )
}
