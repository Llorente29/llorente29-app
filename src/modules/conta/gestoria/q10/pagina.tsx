// src/modules/conta/gestoria/q10/pagina.tsx
//
// Q10 · «Las facturas de noviembre» con sus datos. Lee de Sumied (datos.ts) lo cobrado por GoCardless y, de lo leído
// de la facturación de Cegid (cegidService.ts, conta_cegid_*), el código de cliente de cada ficha, la retención de su
// última factura y la tabla de equivalencias. «Leer de Cegid» lo vuelve a leer por la conexión (conta-cegid-leer:
// solo lee). Pinta con FacturasDelMes.tsx y CegidQ10.tsx, que no leen nada.
// Respuesta 1 al Q10 (25/11): las facturas las emite Cegid; Sumied no emite ni numera.
// La empresa es la activa de Sumied (o la de ?empresa=) y el mes, el de hoy (o el de ?mes=AAAA-MM).

import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { rutaApartadoEmpresa, rutaClientesCuotas } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { ErrorConReintento, TarjetaCargando } from '@/modules/conta/ui/piezas'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { atarFichaCegid, deshacerCegid, elegirConceptoCegid, leerConexionCegid, leerGuardadoCegid, leerIncidenciasMesCegid, leerMandadoCegid, leerTodoCegid, mandarClienteCegid } from '@/modules/conta/services/cegidService'
import { cuadreCegid, cuotasSinHasta, planMandar, proponerAtado, type CobroParaMandar, type IncidenciaCegid, type SerieVuelta } from '../../../../../supabase/functions/_shared/cegidMandar'
import { exportarTabla } from '@/modules/conta/ui/tabla/exportar'
import { MandarCegidQ10 } from './MandarCegidQ10'
import { BancoCegidQ10 } from './BancoCegidQ10'
import { COBRADO, eurQ10, facturasDelMes, nombreDelMesQ10 } from './facturasDelMes'
import { leerFacturasDelMes } from './datos'
import { FacturasDelMes } from './FacturasDelMes'
import { CegidQ10 } from './CegidQ10'
import { codigosCegid, resumenCodigos, retencionesDeCegid, tablaEquivalencias } from './equivalencias'
import { retieneQ10 } from './serie'

export function FacturasQ10Page() {
  const { accountId, cargando } = useCuentaConta()
  const { empresas, activa } = useEmpresas()
  const [params] = useSearchParams()
  const empresa = empresas.find((e) => e.id === params.get('empresa')) ?? activa
  const hoy = hoyEnMadrid()
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get('mes') ?? '') ? params.get('mes')! : hoy.slice(0, 7)
  const anio = Number(mes.slice(0, 4))
  const [vuelta, setVuelta] = useState(0)
  const [vueltaMandado, setVueltaMandado] = useState(0)
  // Respuesta 4 · Lo atado y lo elegido en esta visita, y su frase: se suman a lo leído sin volver a cargar la página.
  const [atadosAhora, setAtadosAhora] = useState<Map<string, number>>(new Map())
  const [elegidosAhora, setElegidosAhora] = useState<Map<string, string>>(new Map())
  const [atado, setAtado] = useState<{ estado: 'trabajando' | 'bien' | 'mal'; frase: string } | null>(null)
  const [elegido, setElegido] = useState<{ gcId: string; estado: 'trabajando' | 'bien' | 'mal'; frase: string } | null>(null)
  const [lectura, setLectura] = useState<{ clave: string; estado: 'leyendo' | 'leido' | 'fallo'; frase: string } | null>(null)
  const clave = `${empresa?.id}:${mes}`
  const listo = !cargando && accountId && empresa
  const d = useLeer(listo ? () => leerFacturasDelMes(accountId, empresa.id, mes) : null, `${accountId}:${empresa?.id}:${mes}:q10`)
  // La conexión y lo leído de Cegid: si fallan (la base sin la 1840, sin permiso…), la página sigue y lo dice.
  const con = useLeer(listo ? () => leerConexionCegid(accountId, empresa.id) : null, `${accountId}:${empresa?.id}:q10-cegid-con`)
  const cg = useLeer(listo ? () => leerGuardadoCegid(empresa.id, anio) : null, `${empresa?.id}:${anio}:q10-cegid:${vuelta}`)
  const md = useLeer(listo ? () => leerMandadoCegid(empresa.id, mes) : null, `${empresa?.id}:${mes}:q10-mandado:${vueltaMandado}`)
  const retiene = retieneQ10(d.datos?.empresa.tax_id)

  // La ficha de cada cobro (el atado de «Clientes y cuotas» y, si no, el enlace atado): la misma para todo lo de abajo.
  const base = useMemo(() => {
    if (!d.datos || !empresa) return null
    return facturasDelMes({ mes, empresa: { id: empresa.id, nombre: empresa.nombre, retiene: false }, cobros: d.datos.cobros, suscripciones: d.datos.suscripciones,
      mandatos: d.datos.mandatos, enlaces: d.datos.enlaces, fichas: d.datos.fichas, retenciones: new Map(), cobroCliente: d.datos.cobroCliente })
  }, [d.datos, empresa, mes])

  const cegid = useMemo(() => {
    if (!d.datos || !base || !cg.datos || !cg.datos.clientes.length) return null
    // El código de Cegid de las fichas con algún cobro cobrado este mes (las que se facturan).
    const conCobro = new Map([...base.facturas.map((f) => f.ficha), ...base.pendientes.map((p) => p.ficha).filter((f): f is NonNullable<typeof f> => !!f)].map((f) => [f.partyId, f]))
    const fichas = [...conCobro.values()].map((f) => ({ partyId: f.partyId, nif: f.nif, cuenta430: d.datos!.cuentas.get(f.partyId) ?? null, codigo: atadosAhora.get(f.partyId) ?? d.datos!.codigoCliente.get(f.partyId) ?? null }))
    const codigos = codigosCegid(fichas, cg.datos.clientes)
    // Respuesta 4 · Cada ficha sin código, con lo que se le propone de Cegid: por su correo de GoCardless o por su nombre.
    const atables = cg.datos.clientes.map((c) => ({ codigo: c.codigo, nombre: c.nombre, nif: c.nif, email: c.email ?? null }))
    const sinCodigo = [...codigos].filter(([, c]) => c.codigo === null).map(([partyId, c]) => ({ partyId, nombre: conCobro.get(partyId)?.nombre ?? '', nif: conCobro.get(partyId)?.nif ?? null,
      cuenta430: d.datos!.cuentas.get(partyId) ?? null, porque: c.porque,
      propuestas: proponerAtado(conCobro.get(partyId)?.nombre ?? null, d.datos!.correos.get(partyId) ?? [], atables) })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    return { codigos, resumen: resumenCodigos(codigos).frase, sinCodigo, retenciones: retencionesDeCegid(codigos, cg.datos.facturas) }
  }, [d.datos, base, cg.datos, atadosAhora])

  const modelo = useMemo(() => {
    if (!d.datos || !empresa) return null
    return facturasDelMes({ mes, empresa: { id: empresa.id, nombre: empresa.nombre, retiene }, cobros: d.datos.cobros, suscripciones: d.datos.suscripciones,
      mandatos: d.datos.mandatos, enlaces: d.datos.enlaces, fichas: d.datos.fichas, retenciones: cegid?.retenciones ?? new Map<string, number>(), cobroCliente: d.datos.cobroCliente })
  }, [d.datos, empresa, mes, retiene, cegid])

  const tabla = useMemo(() => {
    if (!d.datos || !base || !cg.datos || !cegid) return null
    const sus = new Map(d.datos.suscripciones.map((s) => [s.gcId, s]))
    const fichaDe = new Map([...base.facturas.map((f) => [f.cobro.gcId, f.ficha.partyId] as const), ...base.pendientes.filter((p) => p.ficha).map((p) => [p.cobro.gcId, p.ficha!.partyId] as const)])
    const cobros = d.datos.cobros.filter((c) => c.fecha.slice(0, 7) === mes && (COBRADO as readonly string[]).includes(c.estado)).map((c) => ({
      partyId: fichaDe.get(c.gcId) ?? null, importe: c.importe, concepto: (c.suscripcionId ? sus.get(c.suscripcionId)?.nombre : null) ?? null }))
    return tablaEquivalencias(cobros, cegid.codigos, cg.datos.clientes, cg.datos.conceptos, cg.datos.facturas)
  }, [d.datos, base, cg.datos, cegid, mes])

  // Paso 2 · Mandar a Cegid: cada cobro del mes con su ficha y su código de Cegid; el plan decide qué sale.
  const cobrosMes = useMemo(() => {
    if (!d.datos || !base || !cg.datos || !cegid) return null
    const sus = new Map(d.datos.suscripciones.map((s) => [s.gcId, s]))
    const fichaDe = new Map([...base.facturas.map((f) => [f.cobro.gcId, f.ficha] as const), ...base.pendientes.filter((p) => p.ficha).map((p) => [p.cobro.gcId, p.ficha!] as const),
      ...base.sinFactura.filter((x) => x.ficha).map((x) => [x.cobro.gcId, x.ficha!] as const)])
    const cobros: CobroParaMandar[] = d.datos.cobros.filter((c) => c.fecha.slice(0, 7) === mes).map((c) => {
      const f = fichaDe.get(c.gcId) ?? null
      return { gcId: c.gcId, estado: c.estado, fecha: c.fecha, importe: c.importe, concepto: (c.suscripcionId ? sus.get(c.suscripcionId)?.nombre : null) ?? null,
        suscripcionId: c.suscripcionId, descripcion: c.descripcion,
        elegido: (c.suscripcionId ? elegidosAhora.get(`suscripcion:${c.suscripcionId}`) ?? d.datos!.elegidos.get(`suscripcion:${c.suscripcionId}`)
          : elegidosAhora.get(`cobro:${c.gcId}`) ?? d.datos!.elegidos.get(`cobro:${c.gcId}`)) ?? null,
        partyId: f?.partyId ?? null, nombre: f?.nombre ?? null, codigoCegid: f ? cegid.codigos.get(f.partyId)?.codigo ?? null : null }
    })
    return cobros
  }, [d.datos, base, cg.datos, cegid, mes, elegidosAhora])
  const plan = useMemo(() => {
    if (!cobrosMes) return null
    const vivos = new Set((md.datos ?? []).filter((x) => ['mandando', 'mandada', 'facturada'].includes(x.estado)).map((x) => x.gcCobroId))
    // Respuesta 6 · A un cliente con cuotas fijas en Cegid sin «Facturar hasta» (no revisado), nada.
    return planMandar(mes, cobrosMes, vivos, cuotasSinHasta(cg.datos?.clientes ?? [], cg.datos?.revisados ?? []))
  }, [cobrosMes, md.datos, mes, cg.datos])
  // Respuesta 7 · Las facturas de Cegid leídas, con el nombre de su cliente: para proponer qué factura paga un cobro del banco.
  const facturasCruce = useMemo(() => {
    const nombres = new Map((cg.datos?.clientes ?? []).map((c) => [c.codigo, c.nombre]))
    return (cg.datos?.facturas ?? []).map((f) => ({ ejercicio: f.ejercicio, serie: f.serie, codigo: f.codigo, cliente: f.cliente, total: f.total, nombre: f.cliente != null ? nombres.get(f.cliente) ?? null : null }))
  }, [cg.datos])
  // Respuesta 4 · El cuadre con lo que hay en Cegid: se lee con «Leer de Cegid lo que hay para facturar».
  const [enCegid, setEnCegid] = useState<{ clave: string; incidencias: IncidenciaCegid[] } | null>(null)
  const cuadre = useMemo(() => {
    if (!cobrosMes || !enCegid || enCegid.clave !== `${empresa?.id}:${mes}`) return null
    const nombres = new Map((cg.datos?.clientes ?? []).map((c) => [c.codigo, c.nombre ?? String(c.codigo)]))
    // Respuesta 7 · Lo mandado desde el banco o con tarjeta lo cuadra «Lo cobrado por el banco»: aquí no es «sobra».
    const delBanco = new Set((md.datos ?? []).filter((x) => x.origen && x.incidencia != null).map((x) => `${x.cliente}/${x.incidencia}`))
    return cuadreCegid(mes, cobrosMes, enCegid.incidencias.filter((x) => !delBanco.has(`${x.cliente}/${x.incidencia}`)), (md.datos ?? []).filter((x) => !x.origen).map((x) => ({ gcCobroId: x.gcCobroId, cliente: x.cliente, incidencia: x.incidencia, estado: x.estado })), nombres)
  }, [cobrosMes, enCegid, cg.datos, md.datos, mes, empresa?.id])

  if (d.error) return <ErrorConReintento mensaje={`No se han podido leer los cobros del mes: ${d.error}`} reintentar={d.recargar} />
  if (!d.datos || !empresa || !modelo) return <TarjetaCargando />

  const leer = async () => {
    setLectura({ clave, estado: 'leyendo', frase: 'Entrando en la facturación de Cegid…' })
    try {
      const frase = await leerTodoCegid(empresa.id, anio, (f) => setLectura({ clave, estado: 'leyendo', frase: f }))
      setLectura({ clave, estado: 'leido', frase })
    } catch (e) {
      setLectura({ clave, estado: 'fallo', frase: `No se ha podido leer de Cegid: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setVuelta((v) => v + 1)
    }
  }

  const conectada = !!(con.datos?.conClaves && con.datos.codigo.trim())
  const bloqueCegid = (
    <CegidQ10 conectada={conectada} rutaConectar={rutaApartadoEmpresa('ejercicio')}
      lectura={lectura?.clave === clave ? { estado: lectura.estado, frase: lectura.frase } : con.error ? { estado: 'fallo', frase: `No se ha podido leer la conexión con Cegid: ${con.error}` } : cg.error ? { estado: 'fallo', frase: `No se ha podido leer lo leído de Cegid: ${cg.error}` } : null}
      leidoAt={cg.datos?.leidoAt ?? null} alLeer={() => void leer()} codigos={cegid?.resumen ?? null} sinCodigo={cegid?.sinCodigo ?? null} tabla={tabla}
      atado={atado} alAtar={(party, codigo, como) => {
        setAtado({ estado: 'trabajando', frase: `Atando al ${codigo}…` })
        atarFichaCegid(empresa.id, party, codigo, como)
          .then((f) => { setAtadosAhora((m) => new Map(m).set(party, codigo)); setAtado({ estado: 'bien', frase: f }) })
          .catch((e: unknown) => setAtado({ estado: 'mal', frase: e instanceof Error ? e.message : String(e) }))
      }} />
  )

  const puede = !conectada ? { si: false as const, porque: 'Primero conecta la facturación de Cegid y lee de Cegid (paso 1).' }
    : retiene ? { si: false as const, porque: 'Esta empresa es de una persona física: no se manda nada hasta leer su Cegid y el sí de Julio.' }
    : { si: true as const }
  const tras = () => { setVuelta((v) => v + 1); setVueltaMandado((v) => v + 1) }
  const mandarUno = async (codigo: number) => {
    const x = plan?.vueltas['1'].listos.find((l) => l.codigo === codigo)
    if (!x) throw new Error('Ese cliente ya no está listo.')
    try { return await mandarClienteCegid(empresa.id, mes, codigo, x.lineas.map((l) => l.gcId), '1') } finally { tras() }
  }
  const bloqueMandar = (
    <MandarCegidQ10 elegido={elegido} alElegir={(x) => {
        setElegido({ gcId: x.gcId, estado: 'trabajando', frase: `Confirmando el ${x.concepto}…` })
        elegirConceptoCegid(empresa.id, x.que, x.gcId, x.concepto)
          .then((f) => { setElegidosAhora((m) => new Map(m).set(`${x.que}:${x.gcId}`, x.concepto)); setElegido({ gcId: x.gcId, estado: 'bien', frase: f }) })
          .catch((e: unknown) => setElegido({ gcId: x.gcId, estado: 'mal', frase: e instanceof Error ? e.message : String(e) }))
      }}
      plan={plan} puede={puede} mandadas={(md.datos ?? []).map((x) => ({ estado: x.estado, serie: x.serie, serieFactura: x.serieFactura }))} cuadre={cuadre}
      alMandarUno={(codigo) => mandarUno(codigo)}
      alMandarVuelta={async (serie: SerieVuelta, avance) => {
        const listos = plan?.vueltas[serie].listos ?? []
        let hechos = 0, lineas = 0
        try {
          for (const x of listos) {
            avance(`Mandando a Cegid… (${hechos} de ${listos.length} clientes)`)
            try { await mandarClienteCegid(empresa.id, mes, x.codigo, x.lineas.map((l) => l.gcId), serie) } catch (e) {
              throw new Error(`Mandados ${hechos} de ${listos.length} clientes (${lineas} líneas). Se ha parado en el ${x.codigo} (${x.nombre}): ${e instanceof Error ? e.message : String(e)}`, { cause: e })
            }
            hechos += 1; lineas += x.lineas.length
          }
        } finally { tras() }
        return `Mandados a Cegid ${hechos} ${hechos === 1 ? 'cliente' : 'clientes'}, ${lineas} ${lineas === 1 ? 'línea' : 'líneas'} de la serie ${serie}. Ahora, lee de Cegid lo que hay para facturar y mira que cuadra.`
      }}
      alDeshacer={async () => { try { return await deshacerCegid(empresa.id, mes) } finally { tras() } }}
      alLeerCegid={async (avance) => {
        avance('Leyendo de Cegid las incidencias del mes…')
        try {
          const r = await leerIncidenciasMesCegid(empresa.id, mes)
          setEnCegid({ clave: `${empresa.id}:${mes}`, incidencias: r.incidencias })
          return r.frase
        } finally { setVueltaMandado((v) => v + 1) }
      }}
      alBajarExcel={() => cuadre ? exportarTabla('xlsx', {
        nombre: `Cegid contra GoCardless ${mes}`, titulo: `Cegid y GoCardless ${mes}`, subtitulo: cuadre.frase,
        columnas: [{ titulo: 'Cobro de GoCardless' }, { titulo: 'Fecha' }, { titulo: 'Cliente' }, { titulo: 'Importe', cifra: true }, { titulo: 'Código de Cegid' },
          { titulo: 'Nombre en Cegid' }, { titulo: 'Concepto' }, { titulo: 'Texto' }, { titulo: 'Importe en Cegid', cifra: true }, { titulo: 'Serie' }, { titulo: 'Cuadra' }, { titulo: 'Por qué' }],
        filas: cuadre.filas.map((f) => [f.gcId ?? '', f.fecha ?? '', f.cliente ?? '', f.importeCent == null ? '' : f.importeCent / 100, f.codigo ?? '', f.nombreCegid ?? '',
          f.concepto ?? '', f.texto ?? '', f.importeCegidCent == null ? '' : f.importeCegidCent / 100, f.serie ?? '', f.cuadra ? 'Cuadra' : 'No cuadra', f.porque]),
        pie: `Serie 1: ${eurQ10(cuadre.porSerie['1'].cent)} en ${cuadre.porSerie['1'].clientes} clientes · Serie 3: ${eurQ10(cuadre.porSerie['3'].cent)} en ${cuadre.porSerie['3'].clientes} clientes`,
      }) : null}
      />
  )

  return (
    <FacturasDelMes empresa={empresa.nombre} mes={nombreDelMesQ10(mes)} modelo={modelo} cegid={<>{bloqueCegid}{bloqueMandar}
      <BancoCegidQ10 empresaId={empresa.id} mes={mes} cobrosGc={cobrosMes} mandadas={md.datos ?? []} facturasCegid={facturasCruce} alMandar={() => setVueltaMandado((v) => v + 1)} /></>}
      rutaVolver={rutaClientesCuotas()} rutaSinCliente={`${rutaClientesCuotas()}?ver=sin-cliente`} />
  )
}
