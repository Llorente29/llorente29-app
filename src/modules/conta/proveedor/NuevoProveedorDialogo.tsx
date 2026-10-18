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

import { useMemo, useState } from 'react'
import { useApp } from '@/context/AppContext'
import { Campo, Dialogo } from '@/modules/conta/proveedor/piezas'
import { crearProveedor } from '@/modules/conta/services/proveedorService'
import { tipoEntidadPorNif } from '@/modules/conta/lib/nif'
import { avisoNifAlta, revisarAlta, valoresInicialesAlta, type ProveedorExistente } from '@/modules/conta/lib/altaProveedor'
import type { FichaProveedor } from '@/modules/conta/types'

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
}

export function FormularioAltaProveedor({ accountId, otros, nombreInicial, nifInicial, textoCrear = 'Crear y completar su ficha', notaNif, alCancelar, alCrear }: PropsAltaProveedor) {
  const { userProfile, authUserId } = useApp()
  const [iniciales] = useState(() => valoresInicialesAlta(nombreInicial, nifInicial))
  const [name, setName] = useState(iniciales.nombre)
  const [nif, setNif] = useState(iniciales.nif)
  const [errores, setErrores] = useState<{ nombre?: string; nif?: string }>({})
  const [ocupado, setOcupado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)

  const nifAlMomento = useMemo(() => avisoNifAlta(nif), [nif])
  const nota = useMemo(() => (notaNif && nif.trim() && !nifAlMomento ? notaNif(nif) : null), [notaNif, nif, nifAlMomento])

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
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
      alCrear(creado)
    } catch (e2) {
      setFallo(e2 instanceof Error ? e2.message : 'No se pudo crear.')
      setOcupado(false)
    }
  }

  return (
    <form className="cx-formulario" onSubmit={enviar} noValidate>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      <Campo campo="nuevo-name" etiqueta="Nombre con el que lo conocéis" error={errores.nombre}>
        {(p) => <input {...p} className="cx-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Hermanos Ruiz" />}
      </Campo>
      <Campo campo="nuevo-nif" etiqueta="NIF (opcional)" error={errores.nif ?? nifAlMomento} aviso={nota} ayuda="Lo comprobamos al momento. El resto se completa en su ficha.">
        {(p) => <input {...p} className="cx-input" value={nif} onChange={(e) => setNif(e.target.value)} autoCapitalize="characters" placeholder="B12345678" />}
      </Campo>
      <div className="cx-pie">
        <button type="button" className="cx-boton-sec" onClick={alCancelar}>Cancelar</button>
        <button type="submit" className="cx-boton" disabled={ocupado}>{ocupado ? 'Creando…' : textoCrear}</button>
      </div>
    </form>
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
