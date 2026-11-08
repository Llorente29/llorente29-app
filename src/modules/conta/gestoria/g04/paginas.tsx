// src/modules/conta/gestoria/g04/paginas.tsx
//
// G04 · Tarea 4 · Las pantallas nuevas con sus datos: Clientes (con su panel),
// la ficha del cliente y «Tarifa y paquetes». Leen por datos.ts (todo,
// paginado) y pintan con las piezas de esta carpeta, que no leen nada (así se
// prueban y se capturan con datos inventados).

import { useSearchParams } from 'react-router-dom'
import { rutaClienteGestoria, rutaTarifasGestoria } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { ErrorConReintento, TarjetaCargando } from '@/modules/conta/ui/piezas'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { leerClientes } from './datos'
import { modeloClientes, nombreDelCrmDe } from './modelo'
import { Clientes } from './Clientes'
import { enlaceAlCrm, exportar, mesEnPalabras } from './enlaces'

export function ClientesG04Page() {
  const { accountId, cargando } = useCuentaConta()
  const { empresas, activa, elegir } = useEmpresas()
  const [params, setParams] = useSearchParams()
  const d = useLeer(!cargando && accountId ? () => leerClientes(accountId) : null, `${accountId}:g04-clientes`)
  if (d.error) return <ErrorConReintento mensaje={`No se han podido leer los clientes: ${d.error}`} reintentar={d.recargar} />
  if (!d.datos || !activa) return <TarjetaCargando />
  const lasDos = params.get('empresa') === 'las-dos' && empresas.length > 1
  const lista = empresas.map((e) => ({ id: e.id, nombre: e.nombre }))
  const elegidas = lasDos ? lista.map((e) => e.id) : [activa.id]
  const hoy = hoyEnMadrid()
  const modelo = modeloClientes(d.datos, lista, elegidas, hoy)
  const crm = d.datos.crm[0] ?? null
  const portal = crm && typeof crm.portal === 'string' ? crm.portal : null
  const nombreCrm = nombreDelCrmDe(crm ? String(crm.crm) : null)
  const deFila = new Map(d.datos.clientes.map((r) => [`${String(r.cliente_id)}|${r.empresa_id ?? ''}`, r]))
  return (
    <Clientes modelo={modelo} empresas={lista} elegida={lasDos ? null : activa.id} mes={mesEnPalabras(hoy)} crm={nombreCrm}
      alElegir={(id) => {
        if (id === null) { setParams({ empresa: 'las-dos' }); return }
        if (id !== activa.id) elegir(id)
        setParams({})
      }}
      rutaFicha={(cliente, empresa) => rutaClienteGestoria(cliente, empresa)} rutaTarifa={rutaTarifasGestoria()}
      rutaCrm={(f) => {
        const r = deFila.get(`${f.clienteId}|${f.empresaId ?? ''}`)
        return enlaceAlCrm(crm ? String(crm.crm) : null, portal, r ? String(r.tipo_ficha ?? '') : null, r && r.ficha_en_el_crm ? String(r.ficha_en_el_crm) : null)
      }}
      alExportar={exportar} alAsignar={() => setParams(lasDos ? { empresa: 'las-dos', ver: 'sin-cliente' } : { ver: 'sin-cliente' })} />
  )
}
