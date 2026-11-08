// src/modules/conta/gestoria/g04/paginas.tsx
//
// G04 · Tarea 4 · Las pantallas nuevas con sus datos: Clientes (con su panel),
// la ficha del cliente y «Tarifa y paquetes». Leen por datos.ts (todo,
// paginado) y pintan con las piezas de esta carpeta, que no leen nada (así se
// prueban y se capturan con datos inventados).

import { useParams, useSearchParams } from 'react-router-dom'
import { rutaClienteGestoria, rutaClientesCuotas, rutaTarifasGestoria } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { ErrorConReintento, TarjetaCargando } from '@/modules/conta/ui/piezas'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { acciones, leerClientes, leerTodo } from './datos'
import { altaEmpleado, bajaLinea, lineaDesdeGc, noContar, revisada } from '@/modules/conta/services/gestoriaService'
import { modeloClientes, modeloFicha, nombreDelCrmDe, referenciasDelCrm } from './modelo'
import { Ficha } from './Ficha'
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
      alExportar={exportar} alAsignar={() => setParams(lasDos ? { empresa: 'las-dos', ver: 'sin-cliente' } : { ver: 'sin-cliente' })}
      hoy={hoy} rutaPonerCuota={(cliente, empresa) => `${rutaClienteGestoria(cliente, empresa)}${empresa ? '&' : '?'}anadir=1`}
      alCobradoPorOtraVia={async (empresa, cargos, via, fecha) => {
        const frases: string[] = []
        for (const c of cargos) frases.push((await acciones.cobradoPorOtraVia(empresa, c, via, fecha)).frase)
        d.recargar()
        return cargos.length === 1 ? frases[0] : `Guardados ${cargos.length} cargos como cobrados ${via === 'transferencia' ? 'por transferencia' : 'en efectivo'}. Ya no salen en «Te deben». En GoCardless no cambia nada.`
      }} />
  )
}

type Fila = Record<string, unknown>
const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

/** Lo de la ficha que no está en la lista: lo pendiente de revisar y las personas de contacto de este cliente. */
async function leerDeLaFicha(accountId: string, cliente: string) {
  const deCuenta = { columna: 'account_id', id: accountId }
  const [difs, personas] = await Promise.all([
    leerTodo('conta_gestoria_diferencia', 'id, company_id, tipo, porque', deCuenta, ['id'],
      (q) => (q as { eq: (c: string, v: unknown) => { eq: (c: string, v: unknown) => unknown } }).eq('party_id', cliente).eq('vigente', true)),
    leerTodo('conta_gestoria_ficha', 'party_id, id_externo, ficha', deCuenta, ['id_externo'],
      (q) => (q as { eq: (c: string, v: unknown) => { eq: (c: string, v: unknown) => { neq: (c: string, v: unknown) => unknown } } }).eq('party_id', cliente).eq('tipo_ficha', 'contacto').neq('de_empresa', '')),
  ])
  return { difs, personas }
}

export function FichaClienteG04Page() {
  const { accountId, cargando } = useCuentaConta()
  const { empresas } = useEmpresas()
  const { cliente = '' } = useParams()
  const [params] = useSearchParams()
  const empresa = params.get('empresa')
  const d = useLeer(!cargando && accountId && cliente ? async () => {
    const [datos, extra] = await Promise.all([leerClientes(accountId), leerDeLaFicha(accountId, cliente)])
    return { datos, extra }
  } : null, `${accountId}:g04-ficha:${cliente}`)
  if (d.error) return <ErrorConReintento mensaje={`No se ha podido leer la ficha: ${d.error}`} reintentar={d.recargar} />
  if (!d.datos) return <TarjetaCargando />
  const { datos, extra } = d.datos
  const hoy = hoyEnMadrid()
  const lista = empresas.map((e) => ({ id: e.id, nombre: e.nombre }))
  const pendientes = extra.difs.filter((x) => !empresa || !x.company_id || x.company_id === empresa).map((x) => ({ id: String(x.id), tipo: String(x.tipo), porque: String(x.porque ?? '') }))
  const modelo = modeloFicha(datos, lista, cliente, empresa, hoy, pendientes)
  if (!modelo) return <ErrorConReintento mensaje="Ese cliente no está en esta cuenta." reintentar={d.recargar} />
  const crm = datos.crm[0] ?? null
  const nombreCrm = nombreDelCrmDe(crm ? String(crm.crm) : null)
  const fila = datos.clientes.find((r) => String(r.cliente_id) === cliente && (r.empresa_id ?? null) === (modelo.fila.empresaId ?? null))
  const ficha = (datos.fichas.find((x) => String(x.party_id) === cliente)?.ficha ?? {}) as Fila
  const direccion = [texto(ficha.calle), texto(ficha.cp), texto(ficha.poblacion), texto(ficha.provincia)].filter(Boolean).join(', ') || null
  const leido = datos.fichas.find((x) => String(x.party_id) === cliente)?.leido_at
  const e = modelo.fila.empresaId
  const deEmpresa = datos.servicios.filter((x) => x.company_id === e && x.activo !== false)
  const tras = async (p: Promise<{ frase: string } | string>) => { const r = await p; d.recargar(); return typeof r === 'string' ? r : r.frase }
  return (
    <Ficha modelo={modelo} crm={nombreCrm} hoy={hoy} rutaVolver={rutaClientesCuotas()} rutaTarifa={rutaTarifasGestoria()} anadirAbierto={params.get('anadir') === '1'}
      rutaCrm={enlaceAlCrm(crm ? String(crm.crm) : null, crm ? texto(crm.portal) : null, fila ? texto(fila.tipo_ficha) : null, fila ? texto(fila.ficha_en_el_crm) : null)}
      datosCrm={{ situacion: modelo.fila.situacionTexto, formaPago: texto(ficha.formaPago), servicios: Array.isArray(ficha.servicios) ? (ficha.servicios as string[]).join(', ') : texto(ficha.servicios),
        leido: typeof leido === 'string' ? new Date(leido).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null,
        referencias: referenciasDelCrm(ficha), direccion }}
      personas={extra.personas.map((x) => { const f = (x.ficha ?? {}) as Fila
        return { nombre: String(f.nombre ?? `Contacto ${String(x.id_externo)}`), correos: Array.isArray(f.correos) ? f.correos.map(String) : [], telefonos: Array.isArray(f.telefonos) ? f.telefonos.map(String) : [] } })}
      catalogo={{
        servicios: deEmpresa.map((x) => ({ id: String(x.id), nombre: String(x.nombre), porTrabajador: x.forma === 'por_empleado',
          niveles: datos.niveles.filter((n) => n.servicio_id === x.id && n.activo !== false).map((n) => ({ id: String(n.id), nombre: String(n.nombre) })) })),
        paquetes: datos.paquetes.filter((x) => x.company_id === e && x.activo !== false).map((x) => ({ id: String(x.id), nombre: String(x.nombre) })),
      }}
      acciones={{
        cobradoPorOtraVia: async (cargos, via, fecha) => {
          for (const c of cargos) await acciones.cobradoPorOtraVia(e!, c, via, fecha)
          d.recargar()
          return cargos.length === 1 ? 'Guardado: ese cargo ya no sale en «Te deben». En GoCardless no cambia nada.' : `Guardados ${cargos.length} cargos como cobrados ${via === 'transferencia' ? 'por transferencia' : 'en efectivo'}. Ya no salen en «Te deben». En GoCardless no cambia nada.`
        },
        altaTrabajador: (servicio, nombre, desde) => tras(altaEmpleado(e!, cliente, servicio, nombre, desde)),
        bajaTrabajador: (linea, mes) => tras(bajaLinea(linea, mes)),
        lineaDesdeGc: (suscripcion, servicio) => tras(lineaDesdeGc(e!, suscripcion, servicio, null)),
        noContar: (suscripcion) => tras(noContar(e!, suscripcion, 'Desde la ficha: es una baja que GoCardless sigue cobrando.')),
        revisada: (diferencia) => tras(revisada(diferencia, 'Revisado desde la ficha.')),
        anadir: async (o, desde, ensayo) => { const r = await acciones.anadir(e!, cliente, o, desde, null, ensayo); if (!ensayo) d.recargar(); return r.frase },
        cambiarNivel: async (linea, nivel, desde, ensayo) => { const r = await acciones.cambiarNivel(linea, nivel, desde, ensayo); if (!ensayo) d.recargar(); return r.frase },
      }} />
  )
}
