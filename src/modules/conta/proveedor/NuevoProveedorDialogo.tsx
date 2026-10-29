// src/modules/conta/proveedor/NuevoProveedorDialogo.tsx
//
// S01d · El alta de proveedor, sacada de la lista de Proveedores (C01b) para
// que se pueda dar de alta desde tres sitios con el MISMO formulario y las
// MISMAS comprobaciones (lib/altaProveedor): la lista de Proveedores de Cocina,
// Contactos y «Subir factura».
//
// Dos piezas:
//   · FormularioAltaProveedor: el formulario solo. «Subir factura» lo pone
//     dentro de su propio diálogo (dos diálogos uno encima de otro cerrarían
//     los dos con Escape).
//   · NuevoProveedorDialogo: el formulario en su diálogo «Nuevo proveedor».
//
// Qué pasa al crear lo decide quien lo abre (alCrear): Proveedores va a la
// ficha; Contactos se queda en la lista y lo dice; «Subir factura» lo elige.
// El tercero lo crea la base (trg_party_desde_proveedor): con el NIF de un
// cliente, el mismo tercero gana el papel de proveedor.
//
// S01b · Desde una factura (Revisar factura, la recibida a mano): `delPapel`
// trae además la dirección, el correo, el teléfono y la web leídos, para
// revisarlos aquí mismo. Al crear se guardan en su ficha con la misma regla
// que al validar (lib/fichaDesdeDocumento) y queda escrito de qué factura salen.

import { useMemo, useState } from 'react'
import { useApp } from '@/context/AppContext'
import { Campo, Dialogo } from '@/modules/conta/proveedor/piezas'
import { crearProveedor } from '@/modules/conta/services/proveedorService'
import { tipoEntidadPorNif } from '@/modules/conta/lib/nif'
import { avisoNifAlta, revisarAlta, valoresInicialesAlta, type ProveedorExistente } from '@/modules/conta/lib/altaProveedor'
import type { FichaProveedor } from '@/modules/conta/types'
import { completarFicha } from '@/modules/conta/lib/fichaDesdeDocumento'
import { guardarDesdeFactura, type FacturaOrigen } from '@/modules/conta/services/fichaDesdeFacturaService'
import { NO_VIENE_EN_LA_FACTURA } from '@/modules/conta/lib/proveedorDesdeFactura'

/** S01b · Lo que trae el papel además del nombre y el NIF, y de qué factura sale. */
export interface DelPapel {
  direccion?: string | null
  correo?: string | null
  telefono?: string | null
  web?: string | null
  factura: FacturaOrigen
}

/** S01b2 · Un campo que la factura no trae va vacío y lo dice (nunca un ejemplo que parezca un dato). */
const NO_VIENE = `${NO_VIENE_EN_LA_FACTURA}.`

export interface PropsAltaProveedor {
  accountId: string
  /** Los proveedores que ya hay, para no dar dos veces el mismo NIF. */
  otros: readonly ProveedorExistente[]
  /** Lo que leyó el papel, para no escribirlo otra vez. */
  nombreInicial?: string | null
  nifInicial?: string | null
  /** El texto del botón de crear. Por omisión, «Crear y completar su ficha». */
  textoCrear?: string
  /** Lo que conviene saber de ese NIF antes de crear (Contactos: «Es el mismo que tu cliente…»). */
  notaNif?: (nif: string) => string | null
  alCancelar: () => void
  /** Ya creado. Lo que viene después (ir a la ficha, elegirlo, decirlo) es de quien lo abre. */
  alCrear: (proveedor: FichaProveedor) => void
  /** S01b · Desde una factura: lo demás que trae el papel, para revisarlo y guardarlo con su origen. */
  delPapel?: DelPapel
  /** S01b · Dentro de otro formulario (la recibida a mano): sin <form> propio, que no se pueden anidar. */
  sinForm?: boolean
}

export function FormularioAltaProveedor({ accountId, otros, nombreInicial, nifInicial, textoCrear = 'Crear y completar su ficha', notaNif, alCancelar, alCrear, delPapel, sinForm = false }: PropsAltaProveedor) {
  const { userProfile, authUserId } = useApp()
  const [iniciales] = useState(() => valoresInicialesAlta(nombreInicial, nifInicial))
  const [name, setName] = useState(iniciales.nombre)
  const [nif, setNif] = useState(iniciales.nif)
  const [errores, setErrores] = useState<{ nombre?: string; nif?: string }>({})
  const [ocupado, setOcupado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [direccion, setDireccion] = useState(delPapel?.direccion ?? '')
  const [correo, setCorreo] = useState(delPapel?.correo ?? '')
  const [telefono, setTelefono] = useState(delPapel?.telefono ?? '')
  const [web, setWeb] = useState(delPapel?.web ?? '')

  const nifAlMomento = useMemo(() => avisoNifAlta(nif), [nif])
  const nota = useMemo(() => (notaNif && nif.trim() && !nifAlMomento ? notaNif(nif) : null), [notaNif, nif, nifAlMomento])

  async function enviar(e?: React.FormEvent) {
    e?.preventDefault()
    const r = revisarAlta({ nombre: name, nif }, otros)
    setErrores(r.errores)
    if (Object.keys(r.errores).length) return
    const norm = r.nif
    setOcupado(true); setFallo(null)
    try {
      const creado = await crearProveedor({
        accountId, name, taxId: norm, taxIdType: norm ? 'nif_es' : null,
        nifComprobado: !!norm, entityKind: norm ? tipoEntidadPorNif(norm) : null,
        createdBy: authUserId ?? null, createdByName: userProfile?.displayName ?? null,
      })
      if (delPapel) {
        // Lo demás del papel, con la misma regla que al validar (ficha recién creada: todo le falta).
        const c = completarFicha({ nif: norm, nombreFiscal: null, calle: null, codigoPostal: null, ciudad: null },
          { nif: null, nombre: nombreInicial ?? null, direccion, correo, telefono, web })
        const campos = [...c.campos, ...(norm && norm === iniciales.nif ? ['nif' as const] : [])]
        try {
          const guardada = await guardarDesdeFactura({ accountId, ficha: creado, cambios: c.proponer, campos, contacto: c.contacto,
            factura: delPapel.factura, quien: { id: authUserId ?? null, name: userProfile?.displayName ?? null } })
          alCrear(guardada ?? creado)
        } catch (e3) {
          // Creado y elegido igual: lo que falte se completa en su ficha, y se dice.
          setFallo(`Dado de alta, pero no he podido completar su ficha: ${e3 instanceof Error ? e3.message : String(e3)}`)
          alCrear(creado)
        }
        return
      }
      alCrear(creado)
    } catch (e2) {
      setFallo(e2 instanceof Error ? e2.message : 'No se pudo crear.')
      setOcupado(false)
    }
  }

  // Dentro de otro formulario: un grupo; Intro en un campo crea el proveedor, no envía el de fuera.
  const Caja = sinForm ? 'div' : 'form'
  const props = sinForm
    ? { role: 'group', 'aria-label': 'Nuevo proveedor', onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); void enviar() } } }
    : { onSubmit: enviar, noValidate: true }
  return (
    <Caja className="cx-formulario" {...props}>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      {/* S01b2 · Ningún campo lleva un ejemplo en gris: parecen datos de verdad. Lo que la factura no trae, vacío y dicho. */}
      <Campo campo="nuevo-name" etiqueta="Nombre con el que lo conocéis" error={errores.nombre} ayuda={delPapel && !iniciales.nombre ? NO_VIENE : undefined}>
        {(p) => <input {...p} className="cx-input" value={name} onChange={(e) => setName(e.target.value)} />}
      </Campo>
      <Campo campo="nuevo-nif" etiqueta="NIF (opcional)" error={errores.nif ?? nifAlMomento} aviso={nota}
        ayuda={delPapel ? (iniciales.nif ? 'Lo comprobamos al momento.' : `${NO_VIENE} Si lo tienes, lo comprobamos al momento.`) : 'Lo comprobamos al momento. El resto se completa en su ficha.'}>
        {(p) => <input {...p} className="cx-input" value={nif} onChange={(e) => setNif(e.target.value)} autoCapitalize="characters" />}
      </Campo>
      {delPapel && (
        <>
          <Campo campo="nuevo-direccion" etiqueta="Dirección fiscal" ayuda={delPapel.direccion ? 'La de la factura. Se guarda en su ficha.' : NO_VIENE}>
            {(p) => <input {...p} className="cx-input" value={direccion} onChange={(e) => setDireccion(e.target.value)} />}
          </Campo>
          <Campo campo="nuevo-correo" etiqueta="Correo" ayuda={delPapel.correo ? undefined : NO_VIENE}>
            {(p) => <input {...p} className="cx-input" type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} />}
          </Campo>
          <Campo campo="nuevo-telefono" etiqueta="Teléfono" ayuda={delPapel.telefono ? undefined : NO_VIENE}>
            {(p) => <input {...p} className="cx-input" type="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} />}
          </Campo>
          <Campo campo="nuevo-web" etiqueta="Web" ayuda={delPapel.web
            ? `Lo que traiga la factura queda en su ficha ${delPapel.factura.numero ? `«de la factura ${delPapel.factura.numero}»` : '«de una factura»'}.`
            : NO_VIENE}>
            {(p) => <input {...p} className="cx-input" value={web} onChange={(e) => setWeb(e.target.value)} />}
          </Campo>
        </>
      )}
      <div className="cx-pie">
        <button type="button" className="cx-boton-sec" onClick={alCancelar}>Cancelar</button>
        <button type={sinForm ? 'button' : 'submit'} className="cx-boton" disabled={ocupado} onClick={sinForm ? () => void enviar() : undefined}>{ocupado ? 'Creando…' : textoCrear}</button>
      </div>
    </Caja>
  )
}

/** El alta en su diálogo «Nuevo proveedor» (Proveedores de Cocina y Contactos). */
export function NuevoProveedorDialogo({ alCerrar, ...props }: Omit<PropsAltaProveedor, 'alCancelar'> & { alCerrar: () => void }) {
  return (
    <Dialogo titulo="Nuevo proveedor" alCerrar={alCerrar}>
      <FormularioAltaProveedor {...props} alCancelar={alCerrar} />
    </Dialogo>
  )
}
