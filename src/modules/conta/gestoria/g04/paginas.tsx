// src/modules/conta/gestoria/g04/paginas.tsx
//
// G04 · Tarea 4 · Las pantallas nuevas con sus datos: Clientes (con su panel),
// la ficha del cliente y «Tarifa y paquetes». Leen por datos.ts (una llamada
// por pantalla, ya agregada en la base: la 2308) y pintan con las piezas de esta carpeta, que no leen nada (así se
// prueban y se capturan con datos inventados).

import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { rutaClienteGestoria, rutaClientesCuotas, rutaCobroGestoria, rutaTarifasGestoria } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer as useLeerDeLibros } from '@/modules/conta/libros/contexto'
import { ErrorConReintento, TarjetaCargando } from '@/modules/conta/ui/piezas'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { acciones, leerAsignar, leerClientes, leerFicha } from './datos'
import { altaEmpleado, bajaLinea, lineaDesdeGc, noContar, revisada } from '@/modules/conta/services/gestoriaService'
import { modeloClientes, modeloFicha, nombreDelCrmDe, referenciasDelCrm } from './modelo'
import { Ficha } from './Ficha'
import type { PagoHecho } from '../g05/PagosConTarjeta'
import { PortalFicha } from '../portal/PortalFicha'
import { PortalPendiente } from '../portal/PortalPendiente'
import { Clientes } from './Clientes'
import { descargarPrecios, enlaceAlCrm, exportar, imprimirPrecios, imprimirTarifa, mesEnPalabras } from './enlaces'
import { Tarifa } from './Tarifa'
import { Asignar } from './Asignar'
import { clientesParaCasar, porAsignar } from './asignar'
import { formaParaGuardar, formaEnPalabras, modeloTarifa } from './modeloTarifa'
import { euros, type Forma, type Objetivo } from '../../../../../supabase/functions/_shared/tarifa/precio'

/**
 * Como useLeer, pero al recargar después de guardar sigue enseñando lo de
 * antes hasta que llega lo nuevo: si no, la pantalla se desmonta y se pierde
 * el mensaje de lo que se acaba de hacer (regla 8).
 */
function useLeer<T>(leer: (() => Promise<T>) | null, clave: string) {
  const r = useLeerDeLibros(leer, clave)
  const [ultimo, setUltimo] = useState<{ clave: string; datos: T } | null>(null)
  // Ajustar el estado mientras se pinta (el patrón de React para «lo último que llegó»): solo cuando llega algo nuevo.
  if (r.datos && (ultimo?.datos !== r.datos || ultimo.clave !== clave)) setUltimo({ clave, datos: r.datos })
  const datos = r.datos ?? (!r.error && ultimo?.clave === clave ? ultimo.datos : null)
  return { ...r, datos }
}

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
  if (params.get('ver') === 'sin-cliente') {
    return <AsignarG04 accountId={accountId!} datos={d.datos} empresas={lista} elegidas={elegidas} lasDos={lasDos} recargar={d.recargar}
      rutaVolver={lasDos ? `${rutaClientesCuotas()}?empresa=las-dos` : rutaClientesCuotas()} />
  }
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
      portal={(otras) => <PortalPendiente cuenta={accountId!} otras={otras} rutaFicha={(c) => `${rutaClienteGestoria(c, lasDos ? null : activa.id)}${lasDos ? '?' : '&'}pestana=portal`} />}
      hoy={hoy} rutaPonerCuota={(cliente, empresa) => `${rutaClienteGestoria(cliente, empresa)}${empresa ? '&' : '?'}anadir=1`}
      rutaCobro={lasDos ? null : rutaCobroGestoria(activa.id)}
      alCobradoPorOtraVia={async (empresa, cargos, via, fecha) => {
        const frases: string[] = []
        for (const c of cargos) frases.push((await acciones.cobradoPorOtraVia(empresa, c, via, fecha)).frase)
        d.recargar()
        return cargos.length === 1 ? frases[0] : `Guardados ${cargos.length} cargos como cobrados ${via === 'transferencia' ? 'por transferencia' : 'en efectivo'}. Ya no salen en «Te deben». En GoCardless no cambia nada.`
      }} />
  )
}

/** «Asignar a un cliente»: lee las suscripciones activas y los clientes de GoCardless (nombre, email y NIF, para proponer), en su propia llamada, y une con conta_gestoria_enlazar. */
function AsignarG04({ accountId, datos, empresas, elegidas, lasDos, recargar, rutaVolver }: {
  accountId: string; datos: Awaited<ReturnType<typeof leerClientes>>; empresas: { id: string; nombre: string }[]; elegidas: string[]; lasDos: boolean; recargar: () => void; rutaVolver: string
}) {
  const gc = useLeer(() => leerAsignar(accountId), `${accountId}:g04-asignar`)
  if (gc.error) return <ErrorConReintento mensaje={`No se han podido leer los clientes de GoCardless: ${gc.error}`} reintentar={gc.recargar} />
  if (!gc.datos) return <TarjetaCargando />
  return (
    <Asignar lista={porAsignar(datos, gc.datos.suscripciones, gc.datos.gcClientes, empresas, elegidas)} clientes={clientesParaCasar(datos)} lasDos={lasDos} rutaVolver={rutaVolver}
      alUnir={async (empresa, gcCliente, cliente) => { const r = await acciones.enlazar(empresa, gcCliente, cliente); recargar(); return r.frase }} />
  )
}

type Fila = Record<string, unknown>
const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

export function FichaClienteG04Page() {
  const { accountId, cargando } = useCuentaConta()
  const { empresas } = useEmpresas()
  const { cliente = '' } = useParams()
  const [params] = useSearchParams()
  const empresa = params.get('empresa')
  // G05 · nº 61 · Lo apuntado desde la ficha: aquí, para que el bloque verde siga mientras la ficha se relee.
  const [pagoHecho, setPagoHecho] = useState<PagoHecho | null>(null)
  const d = useLeer(!cargando && accountId && cliente ? async () => {
    // Las dos a la vez: lo de la lista y lo que solo hace falta al abrir este cliente.
    const [datos, extra] = await Promise.all([leerClientes(accountId), leerFicha(accountId, cliente)])
    return { datos, extra }
  } : null, `${accountId}:g04-ficha:${cliente}`)
  if (d.error) return <ErrorConReintento mensaje={`No se ha podido leer la ficha: ${d.error}`} reintentar={d.recargar} />
  if (!d.datos) return <TarjetaCargando />
  const { datos, extra } = d.datos
  const hoy = hoyEnMadrid()
  const lista = empresas.map((e) => ({ id: e.id, nombre: e.nombre }))
  const pendientes = extra.pendientes.filter((x) => !empresa || !x.company_id || x.company_id === empresa).map((x) => ({ id: String(x.id), tipo: String(x.tipo), porque: String(x.porque ?? '') }))
  const modelo = modeloFicha(datos, extra, lista, cliente, empresa, hoy, pendientes)
  if (!modelo) return <ErrorConReintento mensaje="Ese cliente no está en esta cuenta." reintentar={d.recargar} />
  const crm = datos.crm[0] ?? null
  const nombreCrm = nombreDelCrmDe(crm ? String(crm.crm) : null)
  const fila = datos.clientes.find((r) => String(r.cliente_id) === cliente && (r.empresa_id ?? null) === (modelo.fila.empresaId ?? null))
  const ficha = extra.ficha
  const direccion = [texto(ficha.calle), texto(ficha.cp), texto(ficha.poblacion), texto(ficha.provincia)].filter(Boolean).join(', ') || null
  const leido = extra.leidoAt
  const e = modelo.fila.empresaId
  const deEmpresa = datos.servicios.filter((x) => x.company_id === e && x.activo !== false)
  const tras = async (p: Promise<{ frase: string } | string>) => { const r = await p; d.recargar(); return typeof r === 'string' ? r : r.frase }
  return (
    <Ficha pagoTarjeta={{ hecho: pagoHecho, alHecho: (h) => { setPagoHecho(h); d.recargar() } }} modelo={modelo} crm={nombreCrm} hoy={hoy} rutaVolver={rutaClientesCuotas()} rutaTarifa={rutaTarifasGestoria()} anadirAbierto={params.get('anadir') === '1'}
      pestanaInicial={params.get('pestana') === 'portal' ? 'Portal' : undefined}
      portal={<PortalFicha cuenta={accountId!} cliente={cliente} nombreCliente={modelo.fila.nombre}
        serviciosPorTrabajador={deEmpresa.filter((x) => x.forma === 'por_empleado').map((x) => ({ id: String(x.id), nombre: String(x.nombre) }))} />}
      rutaCrm={enlaceAlCrm(crm ? String(crm.crm) : null, crm ? texto(crm.portal) : null, fila ? texto(fila.tipo_ficha) : null, fila ? texto(fila.ficha_en_el_crm) : null)}
      datosCrm={{ situacion: modelo.fila.situacionTexto, formaPago: texto(ficha.formaPago), servicios: Array.isArray(ficha.servicios) ? (ficha.servicios as string[]).join(', ') : texto(ficha.servicios),
        leido: typeof leido === 'string' ? new Date(leido).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null,
        referencias: referenciasDelCrm(ficha), direccion }}
      personas={extra.personas.map((x) => { const f = (x.ficha ?? {}) as Fila
        return { nombre: String(f.nombre ?? `Contacto ${String(x.id_externo)}`), correos: Array.isArray(f.correos) ? f.correos.map(String) : [], telefonos: Array.isArray(f.telefonos) ? f.telefonos.map(String) : [] } })}
      catalogo={{
        servicios: deEmpresa.map((x) => ({ id: String(x.id), nombre: String(x.nombre), clave: String(x.clave ?? ''), porTrabajador: x.forma === 'por_empleado',
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
        lineaDesdeGc: (suscripcion, servicio, trabajador) => tras(lineaDesdeGc(e!, suscripcion, servicio, trabajador)),
        noContar: (suscripcion) => tras(noContar(e!, suscripcion, 'Desde la ficha: es una baja que GoCardless sigue cobrando.')),
        revisada: (diferencia) => tras(revisada(diferencia, 'Revisado desde la ficha.')),
        anadir: async (o, desde, ensayo) => { const r = await acciones.anadir(e!, cliente, o, desde, null, ensayo); if (!ensayo) d.recargar(); return r.frase },
        cambiarNivel: async (linea, nivel, desde, ensayo) => { const r = await acciones.cambiarNivel(linea, nivel, desde, ensayo); if (!ensayo) d.recargar(); return r.frase },
      }} />
  )
}

const objetivoParaGuardar = (o: Objetivo) => (o.tipo === 'paquete' ? { paquete: o.paqueteId } : o.tipo === 'nivel' ? { servicio: o.servicioId, nivel: o.nivelId } : { servicio: o.servicioId })

export function TarifaG04Page() {
  const { accountId, cargando, logoCuenta } = useCuentaConta()
  const { empresas, activa } = useEmpresas()
  const [params] = useSearchParams()
  const d = useLeer(!cargando && accountId ? () => leerClientes(accountId) : null, `${accountId}:g04-tarifa`)
  if (d.error) return <ErrorConReintento mensaje={`No se ha podido leer la tarifa: ${d.error}`} reintentar={d.recargar} />
  if (!d.datos || !activa) return <TarjetaCargando />
  const datos = d.datos
  const e = activa.id
  const hoy = hoyEnMadrid()
  const modelo = modeloTarifa(datos, e, hoy)
  const lista = empresas.map((x) => ({ id: x.id, nombre: x.nombre }))
  const precio = async (o: Objetivo, f: Forma, desde: string) => {
    const g = formaParaGuardar(f)
    return (await acciones.guardarPrecio(e, objetivoParaGuardar(o), null, g.forma, g.periodo, g.importe, g.tramos, `${desde}-01`, false)).frase
  }
  const tras = async (f: () => Promise<string>) => { const r = await f(); d.recargar(); return r }
  const filasDePrecios = () => modeloClientes(datos, lista, [e], hoy).filas.map((f) => ({
    cliente: f.nombre, nif: f.nif ?? '', servicios: f.servicios || '—', esteMes: f.esteMes.principalCent === null ? '—' : euros(f.esteMes.principalCent),
  }))
  return (
    <Tarifa modelo={modelo} empresa={activa.nombre} hoy={hoy} rutaClientes={rutaClientesCuotas()} rutaFicha={(c) => rutaClienteGestoria(c, e)}
      elegidaInicial={params.get('ver') ?? undefined} cambioAbierto={params.get('cambiar') === '1'}
      servicios={datos.servicios.filter((s) => s.company_id === e && s.activo !== false).map((s) => ({ id: String(s.id), nombre: String(s.nombre), porTrabajador: s.forma === 'por_empleado',
        niveles: datos.niveles.filter((n) => n.servicio_id === s.id && n.activo !== false).map((n) => ({ id: String(n.id), nombre: String(n.nombre) })) }))}
      alDescargar={(que) => {
        if (que === 'excel') return descargarPrecios(filasDePrecios(), activa.nombre)
        if (que === 'pdf') return imprimirPrecios(filasDePrecios(), activa.nombre, mesEnPalabras(hoy))
        return imprimirTarifa(activa.nombre, logoCuenta, modelo.entradas.map((x) => {
          const det = modelo.detalle(x.id)!
          const lineas = det.niveles.length ? det.niveles.map((n) => `${n.nombre}: ${n.precio ? `${n.precio} € al mes` : 'a consultar'}${n.incluye.length ? ` · ${n.incluye.join(', ')}` : ''}`)
            : det.paquete ? [...det.paquete.lineas.map((l) => `${l.texto} · ${l.detalle}`), det.paquete.precio ? `Precio: ${det.paquete.precio} € al mes` : 'Precio a consultar']
              : [det.general ? formaEnPalabras(det.general.forma) : 'Precio a consultar']
          return { nombre: x.nombre, descripcion: det.descripcion, lineas }
        }), mesEnPalabras(hoy))
      }}
      acciones={{
        crearServicio: (nombre, f, conPrecio, desde) => tras(async () => {
          const g = formaParaGuardar(f)
          return (await acciones.crearServicio(e, nombre, g.forma, g.periodo, conPrecio ? g.importe : null, conPrecio ? g.tramos : null, conPrecio ? `${desde}-01` : null, false)).frase
        }),
        guardarPrecio: (o, f, desde) => tras(() => precio(o, f, desde)),
        guardarQueIncluye: (servicio, texto) => tras(async () => (await acciones.queIncluye(e, servicio, texto, false)).frase),
        guardarNivel: (servicio, nombre, orden, incluye, f, desde) => tras(async () => {
          const r = await acciones.guardarNivel(e, servicio, null, nombre, orden, incluye, false, false)
          if (!f || !r.id) return r.frase
          return `${r.frase} ${await precio({ tipo: 'nivel', servicioId: servicio, nivelId: r.id }, f, desde)}`
        }),
        guardarPaquete: (paquete, nombre, descripcion, excesoCent, lineas, f, desde) => tras(async () => {
          const r = await acciones.guardarPaquete(e, paquete, nombre, descripcion, excesoCent === null ? null : excesoCent / 100, lineas, false)
          if (!f || !r.id) return r.frase
          return `${r.frase} ${await precio({ tipo: 'paquete', paqueteId: r.id }, f, desde)}`
        }),
        aplicarCambio: async (op, ensayo) => {
          const guardado = await acciones.ensayarCambio(e, { ...op, empresaId: e }, ensayo)
          if (!guardado.id) throw new Error('No se ha podido guardar el ensayo: no se ha aplicado nada.')
          const r = await acciones.aplicarCambio(guardado.id)
          d.recargar()
          return { frase: r.frase, id: guardado.id }
        },
        deshacerCambio: (id) => tras(async () => (await acciones.deshacerCambio(id)).frase),
      }} />
  )
}
