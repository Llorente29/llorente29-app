// src/modules/conta/gestoria/g05/pagina.tsx
//
// G05 · Tarea 4 · «Revisar el cobro» con sus datos: lee en una llamada
// (datos.ts · conta_pantalla_cobro) y pinta con Cobro.tsx, que no lee nada
// (así se prueba y se captura con datos inventados). La empresa es la activa de
// Sumied (o la de ?empresa=) y el mes, el de hoy (o el de ?mes=AAAA-MM).

import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { rutaClienteGestoria, rutaClientesCuotas } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer as useLeerDeLibros } from '@/modules/conta/libros/contexto'
import { ErrorConReintento, TarjetaCargando } from '@/modules/conta/ui/piezas'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { aprobarIguales, decidir, enviarCobro, leerCobro, leerFrente, prepararCobro, reanudar } from './datos'
import { CABECERA_EXCEL, filasExcel, frenteAGocardless } from './frenteAGocardless'
import { FrenteAGocardless } from './FrenteAGocardless'
import { excelTabla } from '@/modules/conta/libros/exportar'
import { nombreDelMes } from '../../../../../supabase/functions/_shared/cobro/recibo'
import { modeloCobro, type DatosCobro } from './modeloCobro'
import { Cobro } from './Cobro'

/** Como useLeer, pero al recargar sigue enseñando lo de antes hasta que llega lo nuevo (no se pierde la frase de lo hecho). */
function useLeer<T>(leer: (() => Promise<T>) | null, clave: string) {
  const r = useLeerDeLibros(leer, clave)
  const [ultimo, setUltimo] = useState<{ clave: string; datos: T } | null>(null)
  if (r.datos && (ultimo?.datos !== r.datos || ultimo.clave !== clave)) setUltimo({ clave, datos: r.datos })
  const datos = r.datos ?? (!r.error && ultimo?.clave === clave ? ultimo.datos : null)
  return { ...r, datos }
}

export function CobroG05Page() {
  const { accountId, cargando } = useCuentaConta()
  const { empresas, activa } = useEmpresas()
  const [params] = useSearchParams()
  const empresa = empresas.find((e) => e.id === params.get('empresa')) ?? activa
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get('mes') ?? '') ? params.get('mes')! : hoyEnMadrid().slice(0, 7)
  const d = useLeer<DatosCobro>(!cargando && accountId && empresa ? () => leerCobro(accountId, empresa.id, mes) : null, `${accountId}:${empresa?.id}:${mes}:g05-cobro`)
  // Q08 · Frente a GoCardless: cuatro lecturas en paralelo (solo lee). Se vuelve a leer con el cobro.
  const fr = useLeer(!cargando && accountId && empresa ? () => leerFrente(accountId, empresa.id, mes) : null, `${accountId}:${empresa?.id}:${mes}:g05-frente:${d.datos?.mes?.preparado_at ?? ''}`)
  if (d.error) return <ErrorConReintento mensaje={`No se ha podido leer el cobro: ${d.error}`} reintentar={d.recargar} />
  if (!d.datos || !empresa) return <TarjetaCargando />
  const modelo = modeloCobro(d.datos, { id: empresa.id, nombre: empresa.nombre }, mes)
  const frente = fr.datos ? frenteAGocardless(mes, fr.datos.recibos, fr.datos.suscripciones, fr.datos.clientes, fr.datos.enlaces) : null
  const descargar = () => {
    if (!frente) return 'Aún se está leyendo lo de GoCardless.'
    const nombre = `Cobro de ${nombreDelMes(mes)} frente a GoCardless · ${empresa.nombre}`
    const ok = excelTabla(`${nombre}.xlsx`, 'Frente a GoCardless', CABECERA_EXCEL, filasExcel(frente))
    return ok ? `Bajado: ${nombre}.xlsx, ${frente.filas.length} clientes (${frente.diferencias.length} con diferencias).` : 'No había nada que bajar.'
  }
  const bloqueFrente = fr.error
    ? <p className="g5-frase" data-tono="mal" role="alert">No se ha podido leer lo de GoCardless: {fr.error}</p>
    : frente && (frente.filas.length > 0 || d.datos.conexion)
      ? <FrenteAGocardless frente={frente} rutaFicha={(c) => rutaClienteGestoria(c, empresa.id)} alDescargar={descargar} preparado={!!d.datos.mes?.preparado_at} />
      : null
  const yRecargar = (fn: () => Promise<string>) => async () => { const f = await fn(); d.recargar(); return f }
  return (
    <Cobro modelo={modelo} empresa={empresa.nombre} rutaVolver={rutaClientesCuotas()}
      rutaFicha={(cliente) => rutaClienteGestoria(cliente, empresa.id)}
      rutaPonerCuota={(cliente) => `${rutaClienteGestoria(cliente, empresa.id)}&anadir=1`}
      alPreparar={yRecargar(() => prepararCobro(empresa.id, mes))}
      alDecidir={(id, decision) => yRecargar(() => decidir(id, decision))()}
      alAprobarIguales={yRecargar(() => aprobarIguales(empresa.id, mes))}
      alReanudar={(id) => yRecargar(() => reanudar(id))()}
      alEnviar={yRecargar(() => enviarCobro(empresa.id, mes))} frente={bloqueFrente} />
  )
}
