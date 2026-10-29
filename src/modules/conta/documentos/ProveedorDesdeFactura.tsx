// src/modules/conta/documentos/ProveedorDesdeFactura.tsx
//
// S01b · El proveedor desde la propia factura (Julio, 28/10). Las piezas que
// van dentro de Revisar factura y de la recibida a mano:
//   · AltaDesdeFactura: «Dar de alta a Suministros del Ejemplo S.L.U.» y «Es uno que ya
//     tengo». El alta es el MISMO formulario de «Subir factura»
//     (FormularioAltaProveedor), dentro del bloque «Proveedor y factura», con
//     todo lo que trae el papel para revisar.
//   · NifDistinto: «Esta factura trae el NIF … y su ficha tiene …: ¿es otra
//     empresa?», con «Es la misma, guarda el nuevo» y «Elegir otro».
//   · LoQueHaCambiado: lo que no coincide con su ficha, con su pregunta («Su
//     dirección ha cambiado: ¿la actualizo?») y su botón.
//   · IbanNuevo: «Esta factura trae el IBAN …: ¿lo guardo en su ficha para
//     pagarle?», con «Guardar este IBAN». Nunca se guarda solo.
//   · AvisoIbanDistinto: el único aviso en rojo de la pantalla. Cambiarlo pide
//     confirmarlo otra vez y deja escrito quién, cuándo y de qué factura.
// Cada botón dice qué ha hecho o por qué no (regla 8).

import { useState } from 'react'
import { Boton } from '@/modules/conta/diseno'
import { FormularioAltaProveedor, type DelPapel } from '@/modules/conta/proveedor/NuevoProveedorDialogo'
import type { ProveedorExistente } from '@/modules/conta/lib/altaProveedor'
import { deLaFactura, type Cambiado, type EstadoIban } from '@/modules/conta/lib/fichaDesdeDocumento'
import { decidirIban, guardarIbanDeFactura } from '@/modules/conta/services/proveedorService'
import { guardarDesdeFactura, type FacturaOrigen, type Quien } from '@/modules/conta/services/fichaDesdeFacturaService'
import type { FichaProveedor } from '@/modules/conta/types'
import { textoAltaDesdeFactura } from '@/modules/conta/lib/proveedorDesdeFactura'

const mensajeDe = (e: unknown): string => (e instanceof Error ? e.message : String(e))

// ── Dar de alta ─────────────────────────────────────────────────────────────

/**
 * S01b2 · El nombre del proveedor dentro de un enlace, como una pieza: si no cabe en lo que queda de
 * línea, pasa ENTERO a la siguiente («Dar de alta a» / «OFITOR 2000 S.L.U.»), sin partirse por la mitad.
 * Solo se parte por dentro si es más ancho que la columna entera.
 */
export function NombreEntero({ texto, nombre }: { texto: string; nombre: string | null | undefined }) {
  const n = (nombre ?? '').replace(/\s+/g, ' ').trim()
  const i = n ? texto.lastIndexOf(n) : -1
  if (i < 0) return <>{texto}</>
  return <>{texto.slice(0, i)}<span className="cxf-nombre-entero">{n}</span>{texto.slice(i + n.length)}</>
}

/** Los dos enlaces, en la línea del proveedor: «Dar de alta a …» · «Es uno que ya tengo». */
export function EnlacesAlta({ nombreLeido, alAbrirAlta, alAbrirLista, abierta }: {
  nombreLeido: string | null
  alAbrirAlta: () => void
  alAbrirLista: () => void
  abierta: boolean
}) {
  if (abierta) return null
  return (
    <span className="cxf-alta-enlaces" data-prueba="alta-desde-factura">
      <button type="button" className="s-boton s-boton-enlace" onClick={alAbrirAlta} aria-label={textoAltaDesdeFactura(nombreLeido)}>
        <NombreEntero texto={textoAltaDesdeFactura(nombreLeido)} nombre={nombreLeido} />
      </button>
      {' · '}
      <button type="button" className="s-boton s-boton-enlace" onClick={alAbrirLista}>Es uno que ya tengo</button>
    </span>
  )
}

/**
 * El formulario de alta dentro del bloque, con todo lo leído. Al crear, lo deja elegido en la factura.
 * S01b2 · Si su lectura es de antes y hay que volver a leer el PDF, mientras lee lo dice («Leyendo la
 * factura…») y el formulario sale después, con lo releído; lo que pasó con la relectura, debajo.
 */
export function AltaDesdeFactura({ accountId, otros, leido, factura, alCancelar, alCrear, leyendo = false, relectura = null }: {
  accountId: string
  otros: readonly ProveedorExistente[]
  leido: { nombre: string | null; nif: string | null; direccion: string | null; correo: string | null; telefono: string | null; web: string | null }
  factura: FacturaOrigen
  alCancelar: () => void
  alCrear: (proveedor: FichaProveedor) => void
  leyendo?: boolean
  relectura?: { texto: string; tono: 'ok' | 'falta' } | null
}) {
  const delPapel: DelPapel = { direccion: leido.direccion, correo: leido.correo, telefono: leido.telefono, web: leido.web, factura }
  return (
    <div className="cxf-alta" role="group" aria-label="Dar de alta al proveedor de esta factura" data-prueba="formulario-alta-factura" aria-busy={leyendo || undefined}>
      {leyendo ? (
        <p className="s-apoyo" role="status" data-prueba="leyendo-factura" style={{ margin: 0 }}>
          Leyendo la factura… Su lectura es de antes de que se leyeran el teléfono y la web: la vuelvo a leer para rellenarlo todo.
        </p>
      ) : (
        <>
          <p className="s-apoyo" style={{ marginTop: 0 }}>Lo que trae {factura.numero ? `la factura ${factura.numero}` : 'la factura'}, para revisarlo. Al crearlo queda elegido en esta factura; lo que ya has revisado no se pierde.</p>
          {relectura && <p className="s-aviso-lista" data-tono={relectura.tono} role="status" data-prueba="relectura">{relectura.texto}</p>}
          <FormularioAltaProveedor accountId={accountId} otros={otros} nombreInicial={leido.nombre} nifInicial={leido.nif} delPapel={delPapel}
            textoCrear="Darlo de alta y elegirlo" alCancelar={alCancelar} alCrear={alCrear} />
        </>
      )}
    </div>
  )
}

// ── El NIF distinto ─────────────────────────────────────────────────────────

export function NifDistinto({ accountId, ficha, documento, factura, quien, alGuardar, alElegirOtro }: {
  accountId: string
  ficha: Pick<FichaProveedor, 'id' | 'name' | 'taxId' | 'dataFromInvoice'>
  documento: string
  factura: FacturaOrigen
  quien: Quien
  alGuardar: (texto: string) => void
  alElegirOtro: () => void
}) {
  const [ocupado, setOcupado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  async function guardar() {
    setOcupado(true); setFallo(null)
    try {
      await guardarDesdeFactura({ accountId, ficha, cambios: { taxId: documento }, campos: ['nif'], factura, quien })
      alGuardar(`NIF de ${ficha.name} cambiado a ${documento}, ${deLaFactura(factura.numero)}.`)
    } catch (e) { setFallo(`No he podido cambiar el NIF: ${mensajeDe(e)}`) } finally { setOcupado(false) }
  }
  return (
    <div className="s-aviso-lista cxf-nif-distinto" data-tono="duda" role="alert" data-prueba="nif-distinto">
      <p style={{ margin: 0 }}>Esta factura trae el NIF {documento} y su ficha tiene {ficha.taxId}: ¿es otra empresa?</p>
      <div className="cxf-botones">
        <Boton onClick={() => void guardar()} disabled={ocupado}>{ocupado ? 'Guardando…' : 'Es la misma, guarda el nuevo'}</Boton>
        <Boton onClick={alElegirOtro} disabled={ocupado}>Elegir otro</Boton>
      </div>
      {fallo && <p className="cxf-error" role="alert">{fallo}</p>}
    </div>
  )
}

// ── Lo que ha cambiado ──────────────────────────────────────────────────────

export function LoQueHaCambiado({ accountId, ficha, cambiados, factura, quien, alHacer }: {
  accountId: string
  ficha: Pick<FichaProveedor, 'id' | 'dataFromInvoice'>
  cambiados: readonly Cambiado[]
  factura: FacturaOrigen
  quien: Quien
  alHacer: (texto: string) => void
}) {
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  async function hacer(c: Cambiado) {
    setOcupado(c.campo); setFallo(null)
    try {
      await guardarDesdeFactura({ accountId, ficha, cambios: c.cambios, campos: c.contacto ? [] : [c.campo], contacto: c.contacto, factura, quien })
      alHacer(c.contacto ? `Añadido a sus contactos: ${c.documento}, ${deLaFactura(factura.numero)}.` : `Actualizado en su ficha: ${c.documento}, ${deLaFactura(factura.numero)}.`)
    } catch (e) { setFallo(`No he podido guardarlo: ${mensajeDe(e)}`) } finally { setOcupado(null) }
  }
  if (!cambiados.length) return null
  return (
    <div className="cxf-cambiados" data-prueba="lo-que-ha-cambiado">
      {cambiados.map((c) => (
        <div key={c.campo} className="s-aviso-lista" data-tono="duda">
          <p style={{ margin: 0 }}><strong>{c.pregunta}</strong></p>
          <p className="s-apoyo" style={{ margin: '2px 0 6px' }}>En su ficha: {c.ficha} · En la factura: {c.documento}</p>
          <Boton onClick={() => void hacer(c)} disabled={ocupado !== null}>{ocupado === c.campo ? 'Guardando…' : c.contacto ? 'Añadirlo a sus contactos' : 'Actualizarla en su ficha'}</Boton>
        </div>
      ))}
      {fallo && <p className="cxf-error" role="alert">{fallo}</p>}
    </div>
  )
}

// ── El IBAN ─────────────────────────────────────────────────────────────────

/** Ficha sin IBAN y factura con uno válido: se propone; lo guarda quien pulsa. */
export function IbanNuevo({ iban, proveedorId, facturaId, alGuardar }: {
  iban: Extract<EstadoIban, { estado: 'nuevo' }>
  proveedorId: string
  facturaId: string
  alGuardar: (texto: string) => void
}) {
  const [ocupado, setOcupado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  async function guardar() {
    setOcupado(true); setFallo(null)
    try { alGuardar(await guardarIbanDeFactura(proveedorId, facturaId)) } catch (e) { setFallo(mensajeDe(e)) } finally { setOcupado(false) }
  }
  return (
    <div className="s-aviso-lista" data-tono="duda" data-prueba="iban-nuevo">
      <p style={{ margin: '0 0 6px' }}>Esta factura trae el IBAN {iban.formateado}: ¿lo guardo en su ficha para pagarle?</p>
      <Boton onClick={() => void guardar()} disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar este IBAN'}</Boton>
      {fallo && <p className="cxf-error" role="alert">{fallo}</p>}
    </div>
  )
}

/** La ficha tiene otro IBAN: en rojo, encima de todo. Cambiarlo pide confirmarlo otra vez. */
export function AvisoIbanDistinto({ iban, ficha, factura, quien, accountId, alHacer }: {
  iban: Extract<EstadoIban, { estado: 'distinto' }>
  ficha: Pick<FichaProveedor, 'id' | 'name' | 'dataFromInvoice'>
  factura: FacturaOrigen
  quien: Quien
  accountId: string
  alHacer: (texto: string) => void
}) {
  const [paso, setPaso] = useState<'aviso' | 'confirmar'>('aviso')
  const [ocupado, setOcupado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  async function cambiar() {
    setOcupado(true); setFallo(null)
    try {
      // La decisión de la C01b: pasa a la ficha con quién y cuándo, y deja de frenar el pago. Y de qué factura sale.
      await decidirIban(factura.id, 'es_el_nuevo', quien.name)
      await guardarDesdeFactura({ accountId, ficha, cambios: {}, campos: ['iban'], factura, quien })
      alHacer(`IBAN de ${ficha.name} cambiado a ${iban.formateado}, ${deLaFactura(factura.numero)}. Queda escrito quién lo cambió y cuándo.`)
    } catch (e) { setFallo(`No he podido cambiarlo: ${mensajeDe(e)}`) } finally { setOcupado(false) }
  }
  async function noEsSuyo() {
    setOcupado(true); setFallo(null)
    try {
      await decidirIban(factura.id, 'no_es_suyo', quien.name)
      alHacer(`Apuntado: el IBAN de esta factura no es de ${ficha.name}. Se le paga al de su ficha.`)
    } catch (e) { setFallo(mensajeDe(e)) } finally { setOcupado(false) }
  }
  return (
    <div className="s-aviso-lista cxf-iban-distinto" data-tono="falta" role="alert" data-prueba="iban-distinto">
      <p style={{ margin: 0 }}><strong>Ojo: el IBAN de esta factura no es el de su ficha. Antes de pagar, confírmalo llamando al proveedor a su teléfono de siempre, no al de la factura.</strong></p>
      <p style={{ margin: '4px 0 8px' }}>En la factura: {iban.formateado} · En su ficha: {iban.ficha}</p>
      {!iban.valido && <p style={{ margin: '0 0 8px' }}>El de la factura no es un IBAN válido ({iban.motivo?.replace(/\.$/, '')}): puede estar mal leído. Compruébalo en su PDF.</p>}
      {paso === 'aviso' ? (
        <div className="cxf-botones">
          <Boton onClick={() => setPaso('confirmar')} disabled={ocupado || !iban.valido}>Cambiar el IBAN de su ficha</Boton>
          <Boton onClick={() => void noEsSuyo()} disabled={ocupado}>No es suyo: se le paga al de su ficha</Boton>
        </div>
      ) : (
        <div className="cxf-confirmar-iban" data-prueba="confirmar-iban">
          <p style={{ margin: '0 0 8px' }}>¿Lo has confirmado llamando a su teléfono de siempre? Si lo cambias, queda escrito quién lo cambió, cuándo y que sale {deLaFactura(factura.numero)}.</p>
          <div className="cxf-botones">
            <Boton variante="principal" onClick={() => void cambiar()} disabled={ocupado}>{ocupado ? 'Cambiando…' : 'Sí, lo he confirmado: cámbialo'}</Boton>
            <Boton onClick={() => setPaso('aviso')} disabled={ocupado}>Cancelar</Boton>
          </div>
        </div>
      )}
      {fallo && <p className="cxf-error" role="alert">{fallo}</p>}
    </div>
  )
}
