// src/modules/conta/compras/ComoTeFacturaPage.tsx
//
// «Cómo te factura» en su pantalla (maqueta N20 FichaProveedor.dc.html,
// respuesta 1 del repaso): «Clientes y proveedores › <proveedor>» encima y el
// título debajo. Llegan aquí «Abrir su ficha» desde Compras, cuando lo que
// falta es cómo factura, y el enlace de su ficha (pestaña Pago).

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { rutaFichaProveedor, rutaTerceros } from '@/config/navegacion'
import { Migas } from '@/modules/conta/proveedor/piezas'
import ComoTeFactura from '@/modules/conta/proveedor/ComoTeFactura'
import { tabla } from '@/modules/conta/services/bd'
import { ErrorConReintento, TarjetaCargando } from '@/modules/conta/ui/piezas'

export default function ComoTeFacturaPage() {
  const { supplierId = '' } = useParams()
  const [nombre, setNombre] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)

  useEffect(() => {
    let vivo = true
    tabla('supplier').select('name').eq('id', supplierId).maybeSingle()
      .then(({ data, error }: { data: { name: string } | null; error: { message: string } | null }) => {
        if (!vivo) return
        if (error) setFallo(`No se pudo leer el proveedor: ${error.message}`)
        else if (!data) setFallo('Ese proveedor no existe o no es de tu cuenta.')
        else { setFallo(null); setNombre(data.name) }
      })
    return () => { vivo = false }
  }, [supplierId, vuelta])

  return (
    <div className="cxc cxc-como-pagina">
      <header className="cx-cabecera">
        <div className="cx-cabecera-titulos">
          <Migas migas={[{ etiqueta: 'Clientes y proveedores', ruta: rutaTerceros() }, { etiqueta: nombre ?? '…', ruta: nombre ? rutaFichaProveedor(supplierId) : undefined }]} />
          <h1 className="cx-titulo">Cómo te factura</h1>
        </div>
      </header>
      {fallo && <ErrorConReintento mensaje={fallo} reintentar={() => setVuelta((v) => v + 1)} />}
      {!fallo && !nombre && <TarjetaCargando />}
      {nombre && <ComoTeFactura proveedor={supplierId} nombre={nombre} />}
    </div>
  )
}
