// src/modules/conta/documentos/RecibidaAMano.tsx
//
// «Nueva recibida a mano» (S01d; Compras y gastos › Facturas recibidas ›
// Nueva recibida a mano, `documentos/nueva`). Ficha completa (tablero 3b,
// regla de Julio): es LA MISMA pantalla que la de una recibida que entra sola,
// con los mismos bloques (FichaRecibidaBloques) y las mismas opciones:
// proveedor, número y fecha; los importes por tipo de IVA (varios tipos, con
// «+ Otro tipo de IVA»); a qué gasto va (cuenta con F4 y local, con «Común»
// como una opción más); el pago; y, a la derecha, el hueco del PDF
// («Arrastra aquí el PDF o la foto · Subir»; la foto la pasa a PDF el
// servidor, D02) con la casilla «Sin PDF».
//
// Al guardar: una factura «para revisar» de la empresa activa, una línea por
// tipo (de las líneas sale el asiento), su PDF si se subió, su vencimiento si
// se dijo; y se abre su ficha para mirarla y apuntarla como cualquier otra. Lo
// que pasa se dice (regla 8), también lo que aún no se puede guardar (la forma
// de pago, «Sin PDF», la retención…: no hay dónde, va en la tanda).
//
// Lo escrito se guarda en esta pestaña del navegador mientras se da de alta un
// proveedor: al volver, sigue ahí.

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { rutaDocumentos, rutaRevisarFactura, rutaTerceros } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { useAnalitica } from '@/modules/conta/marco/nuevo/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { Boton } from '@/modules/conta/diseno'
import { DocumentoFicha, Ficha } from '@/modules/conta/diseno/plantillas'
import { ErrorConReintento, TarjetaCargando } from '@/modules/conta/ui/piezas'
import { EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { LOCAL_COMUN, textoGuardada } from '@/modules/conta/lib/recibidaAMano'
import { localesDeLaCuenta } from '@/modules/conta/services/diarioService'
import { cuentasDeGasto, guardarCambiosRecibida, proveedoresDeLaCuenta, sinPapelRecibida } from '@/modules/conta/services/documentosService'
import { guardarRecibidaAMano, tiposDeIvaRecibida } from '@/modules/conta/services/recibidaAManoService'
import { PapelPdf } from '@/modules/conta/documentos/PapelPdf'
import { borradorDe, cambiosParaLaBase, comprobarAMano, noSeGuardaAMano, totalesDe, type BorradorFicha } from '@/modules/conta/documentos/fichaRecibida'
import { BloqueGasto, BloqueImportesIva, BloquePago, BloqueProveedorFactura, HuecoPapel } from '@/modules/conta/documentos/FichaRecibidaBloques'

const GUARDADO = 'conta.recibidaAMano.ficha'
const sinCambio = () => undefined

function vacio(hoy: string): BorradorFicha {
  return { ...borradorDe({ proveedorId: null, numero: null, fecha: hoy, vence: null, retencion: null, recargo: null, gasto: null, local: null, formaPago: null, pagada: false, tipos: [], lineas: [], base: null, cuota: null }), iva: [{ base: '', tipo: '21', cuota: '' }] }
}

/** Lo escrito antes de ir a dar de alta un proveedor (solo esta pestaña; si el navegador no deja, se empieza en blanco). */
function leerGuardado(hoy: string): BorradorFicha {
  try {
    const t = sessionStorage.getItem(GUARDADO)
    if (!t) return vacio(hoy)
    return { ...vacio(hoy), ...(JSON.parse(t) as Partial<BorradorFicha>), documento: '' }
  } catch { return vacio(hoy) }
}
function guardarBorrador(b: BorradorFicha | null): void {
  try { if (b) sessionStorage.setItem(GUARDADO, JSON.stringify(b)); else sessionStorage.removeItem(GUARDADO) } catch { /* sin almacenamiento: no pasa nada */ }
}

export default function RecibidaAMano() {
  const navegar = useNavigate()
  const movil = useIsMobile()
  const { accountId, userId, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const hoy = hoyEnMadrid()

  const proveedores = useLeer(accountId ? () => proveedoresDeLaCuenta(accountId) : null, `${accountId}:proveedores-a-mano`)
  const tipos = useLeer(accountId ? () => tiposDeIvaRecibida(accountId) : null, `${accountId}:tipos-iva-recibida`)
  const { local: ejeLocal } = useAnalitica()
  const locales = useLeer(accountId && ejeLocal ? () => localesDeLaCuenta(accountId) : null, `${accountId}:${ejeLocal ? 'con' : 'sin'}-local:locales-a-mano`)
  const cuentas = useLeer(accountId && activa ? () => cuentasDeGasto(accountId, activa.id) : null, `${accountId}:${activa?.id}:gastos-a-mano`)

  const [b, setB] = useState<BorradorFicha>(() => leerGuardado(hoy))
  const [fichero, setFichero] = useState<{ file: File; url: string } | null>(null)
  const [intentado, setIntentado] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  useEffect(() => { guardarBorrador(b) }, [b])
  useEffect(() => () => { if (fichero) URL.revokeObjectURL(fichero.url) }, [fichero])

  const listaTipos = useMemo(() => tipos.datos ?? [], [tipos.datos])
  const comprobacion = comprobarAMano(b, listaTipos, hoy, !!ejeLocal, LOCAL_COMUN)
  const err = intentado ? comprobacion.errores : {}
  const totales = totalesDe(b)
  const poner = (c: Partial<BorradorFicha>) => { setB((x) => ({ ...x, ...c })); setFallo(null) }
  const nombreProveedor = (proveedores.datos ?? []).find((p) => p.id === b.proveedorId)?.nombre ?? 'el proveedor'

  function cancelar() {
    guardarBorrador(null)
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navegar(-1)
    else navegar(rutaDocumentos('por-revisar'))
  }

  async function guardar(e?: FormEvent) {
    e?.preventDefault()
    setIntentado(true)
    setFallo(null)
    const datos = comprobacion.datos
    if (!datos) return
    if (!accountId || !activa) { setFallo('No se ha guardado: no sé de qué empresa es. Elige la empresa arriba y vuelve a intentarlo.'); return }
    setGuardando(true)
    try {
      const r = await guardarRecibidaAMano({ accountId, companyId: activa.id, userId, userName, proveedor: nombreProveedor, datos, papel: fichero?.file ?? null })
      // D03 · 0790: lo que la factura nueva no lleva en su alta (la forma de pago, la retención,
      // el recargo, «Sin PDF») va con las funciones de la ficha. Sin la tanda, se dice qué no.
      const ademas = [...r.ademas]
      let no = noSeGuardaAMano(b)
      const campos = [...(b.formaPago ? ['formaPago'] : []), ...(b.retencion ? ['retencion'] : []), ...(b.recargo ? ['recargo'] : [])]
      const fac = { id: r.id, account_id: accountId, company_id: activa.id, estado: 'en_revision', fecha: datos.fecha }
      if (campos.length) {
        const g = await guardarCambiosRecibida(fac, cambiosParaLaBase(b, campos), { quien: userName, nombres: {} })
        if (g.conTanda && !g.fallos.length) { no = no.filter((x) => !/forma de pago|retención|recargo/.test(x)); if (g.texto) ademas.push(g.texto) }
        for (const f of g.fallos) ademas.push(`${f.etiqueta}: no se ha guardado (${f.porque}).`)
      }
      if (b.sinPdf && !fichero) {
        const x = await sinPapelRecibida(r.id, true, b.motivoSinPdf || 'Escrita a mano, sin documento', userName)
        if (x.hecho) { no = no.filter((y) => !/Sin PDF/.test(y)); ademas.push(x.texto) } else if (!x.falta) ademas.push(`«Sin PDF»: no se ha guardado (${x.texto}).`)
      }
      const aviso = [textoGuardada(datos.numero, nombreProveedor), ...ademas,
        ...(no.length ? [`No se ha guardado ${no.join(', ')}: aún no hay dónde en la base.`] : [])].join(' ')
      guardarBorrador(null)
      navegar(`${rutaRevisarFactura(r.id)}?ver=por-revisar`, { state: { aviso } })
    } catch (x) {
      setFallo(x instanceof Error ? x.message : String(x))
      setGuardando(false)
    }
  }

  if (proveedores.error) return <ErrorConReintento mensaje={proveedores.error} reintentar={proveedores.recargar} />
  if (tipos.error) return <ErrorConReintento mensaje={tipos.error} reintentar={tipos.recargar} />
  if (ejeLocal && locales.error) return <ErrorConReintento mensaje={locales.error} reintentar={locales.recargar} />
  if (!proveedores.datos || !tipos.datos || (ejeLocal && !locales.datos)) return <TarjetaCargando />

  const altaProveedor = <Link to={`${rutaTerceros()}?nuevo=proveedor`} className="cx-enlace">+ Dar de alta un proveedor</Link>
  const botones = (
    <div className="s-pie">
      <Boton variante="secundario" onClick={cancelar} ancho={movil}>Cancelar</Boton>
      <Boton variante="principal" type="submit" disabled={guardando} ancho={movil}>{guardando ? 'Guardando…' : 'Guardar y revisarla'}</Boton>
    </div>
  )

  const datos = (
    <form onSubmit={(e) => void guardar(e)} noValidate className="cxf-a-mano-form">
      <BloqueProveedorFactura proveedorId={b.proveedorId} numero={b.numero} fecha={b.fecha} proveedores={proveedores.datos}
        alCambiar={poner} cambioDe={sinCambio} deshacer={sinCambio} soloLectura={false} altaProveedor={altaProveedor}
        motivoProveedor={(() => { const p = proveedores.datos!.find((x) => x.id === b.proveedorId); return p?.nif ? `NIF ${p.nif}, de su ficha` : undefined })()}
        errores={{ proveedor: err.proveedor, numero: err.numero, fecha: err.fecha }} />
      <BloqueImportesIva iva={b.iva} retencion={b.retencion} recargo={b.recargo} tipos={listaTipos} totales={totales} pdf={null} fuente="factura"
        alCambiar={poner} cambioDe={sinCambio} deshacer={sinCambio} soloLectura={false} errores={err.importes} />
      <BloqueGasto gastos={b.gastos} base={totales.base} cuentas={cuentas.datos ?? []} locales={ejeLocal ? locales.datos ?? [] : null} nombreEje={ejeLocal?.nombre ?? 'Local'}
        alCambiar={(g) => poner({ gastos: g })} alDeshacer={sinCambio} tono="normal" soloLectura={false} sinReparto
        elegirLocal={{ comun: LOCAL_COMUN }} errorLocal={err.local}
        motivo={`Sin cuenta, la de su ficha. «Común» si es de todos: el informe por ${(ejeLocal?.nombre ?? 'local').toLowerCase()} lo reparte.`} />
      <BloquePago formaPago={b.formaPago} vence={b.vence} estadoPago={b.estadoPago} alCambiar={poner} cambioDe={sinCambio} deshacer={sinCambio}
        motivoVence="Si no lo dices, el de su ficha." pagada={null} soloLectura={false} />
      <div role="status" aria-live="polite">
        {intentado && !comprobacion.datos && <p className="s-fallo">Falta algo: lo tienes debajo de cada campo en rojo.</p>}
      </div>
      {fallo && <p className="s-fallo" role="alert">{fallo}</p>}
      {botones}
    </form>
  )
  const documento = (
    <DocumentoFicha titulo={fichero?.file.name ?? 'Sin PDF todavía'} oculto={false} alOcultar={() => undefined}>
      {fichero
        ? <>
          <div className="cxf-papel-acciones"><Boton variante="secundario" onClick={() => { setFichero(null); poner({ documento: '' }) }}>Quitar</Boton></div>
          {/^image\//.test(fichero.file.type) ? <img src={fichero.url} alt="La factura elegida" /> : <PapelPdf url={fichero.url} titulo="La factura elegida" />}
        </>
        : <HuecoPapel alElegir={(file) => { setFichero({ file, url: URL.createObjectURL(file) }); poner({ documento: file.name }) }} sinPdf={b.sinPdf} motivoSinPdf={b.motivoSinPdf}
            alCambiarSinPdf={poner} deshacerSinPdf={sinCambio} soloLectura={false} />}
    </DocumentoFicha>
  )

  return (
    <div className="s-pagina" data-prueba="ficha-recibida" data-origen="a-mano-nueva">
      <EncabezadoPagina titulo="Nueva recibida a mano" migasExtra={[{ etiqueta: 'Nueva recibida a mano' }]}
        frase="Escrita a mano: la misma ficha que una que entra sola. Se guarda para revisar; después la miras y la apuntas como cualquier otra." />
      <Ficha datos={datos} documento={documento} usuario={userId} reglaAnchos />
    </div>
  )
}
