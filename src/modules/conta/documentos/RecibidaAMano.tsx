// src/modules/conta/documentos/RecibidaAMano.tsx
//
// S01d · «Nueva recibida a mano» (Julio: «crear una recibida a mano»). Hasta
// hoy toda recibida empezaba por un fichero (subirla, el correo, Compras con
// su lectura). Aquí se escribe: proveedor, número, fecha de expedición, base,
// tipo de IVA, cuota (calculada, se puede cambiar) y total (base + cuota).
// S01e: y el local (Julio, 18/10: «Foodint necesita su analítica por local»),
// con «Común» como una opción más; sin el eje de local no se pregunta.
//
// Al guardar: una factura «para revisar» de la empresa activa, sin papel, con
// una línea (la base a su tipo: de las líneas sale el asiento), y se abre en
// Asientos › Recibidas para mirarla y apuntarla como cualquier otra. Lo que
// pasa se dice (regla 8): «Factura 123 de Hermanos Ruiz guardada. Revísala y
// apúntala.» en la factura, o el fallo aquí, en palabras normales.
//
// Vive en la dirección de Recibidas con ?nueva=a-mano (RecibidasEnAsientos la
// pinta en vez de saltar a la primera para revisar), y por eso la cinta, el
// vacío de Recibidas y Libros › Registro › Recibidas llegan aquí sin una ruta
// nueva. Lo escrito se guarda en esta pestaña del navegador mientras se da de
// alta un proveedor: al volver, sigue ahí.

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { rutaLibroDiario, rutaRecibidaEnAsientos, rutaTerceros } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { useAnalitica } from '@/modules/conta/marco/nuevo/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { Boton, Campo, Fecha, Importe, Selector, Tarjeta, Texto } from '@/modules/conta/diseno'
import { Migas } from '@/modules/conta/proveedor/piezas'
import { ErrorConReintento, TarjetaCargando } from '@/modules/conta/ui/piezas'
import { eurosExactos, hoyEnMadrid, porcentaje } from '@/modules/conta/lib/formato'
import { LOCAL_COMUN, comprobarRecibida, cuotaDe, leerImporteEs, textoGuardada, totalDe, type BorradorRecibida } from '@/modules/conta/lib/recibidaAMano'
import { localesDeLaCuenta } from '@/modules/conta/services/diarioService'
import { proveedoresDeLaCuenta } from '@/modules/conta/services/documentosService'
import { guardarRecibidaAMano, tiposDeIvaRecibida } from '@/modules/conta/services/recibidaAManoService'

const GUARDADO = 'conta.recibidaAMano.borrador'
const VACIO: BorradorRecibida = { proveedorId: '', numero: '', fecha: '', base: '', tipo: '', cuota: '', local: '' }

/** Lo escrito antes de ir a dar de alta un proveedor (solo esta pestaña; si el navegador no deja, se empieza en blanco). */
function leerGuardado(): { b: BorradorRecibida; cuotaTocada: boolean } | null {
  try {
    const t = sessionStorage.getItem(GUARDADO)
    if (!t) return null
    const x = JSON.parse(t) as { b?: Partial<BorradorRecibida>; cuotaTocada?: boolean }
    return { b: { ...VACIO, ...(x.b ?? {}) }, cuotaTocada: x.cuotaTocada === true }
  } catch { return null }
}
function guardarBorrador(v: { b: BorradorRecibida; cuotaTocada: boolean } | null): void {
  try { if (v) sessionStorage.setItem(GUARDADO, JSON.stringify(v)); else sessionStorage.removeItem(GUARDADO) } catch { /* sin almacenamiento: no pasa nada */ }
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
  const locales = useLeer(accountId && ejeLocal ? () => localesDeLaCuenta(accountId) : null, `${accountId}:locales-a-mano`)

  const [inicial] = useState(() => leerGuardado())
  const [b, setB] = useState<BorradorRecibida>(() => inicial?.b ?? { ...VACIO, fecha: hoy })
  const [cuotaTocada, setCuotaTocada] = useState(inicial?.cuotaTocada ?? false)
  const [intentado, setIntentado] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  useEffect(() => { guardarBorrador({ b, cuotaTocada }) }, [b, cuotaTocada])

  // El tipo de serie: el 21 % si se ofrece; si no, el primero.
  const listaTipos = useMemo(() => tipos.datos ?? [], [tipos.datos])
  const tipoElegido = b.tipo !== '' ? b.tipo : listaTipos.length ? String(listaTipos.includes(21) ? 21 : listaTipos[0]) : ''

  const base = leerImporteEs(b.base)
  const tipo = tipoElegido === '' ? null : Number(tipoElegido)
  const calculada = base !== null && tipo !== null ? cuotaDe(base, tipo) : null
  const cuotaEscrita = cuotaTocada ? b.cuota : ''
  const cuotaVista = cuotaTocada ? b.cuota : calculada !== null ? eurosExactos(calculada).replace(/\s€$/, '') : ''
  const cuota = cuotaTocada ? leerImporteEs(b.cuota) : calculada
  const total = base !== null && cuota !== null ? totalDe(base, cuota) : null
  const comprobacion = comprobarRecibida({ ...b, tipo: tipoElegido, cuota: cuotaEscrita }, listaTipos, hoy, !!ejeLocal)
  const err = intentado ? comprobacion.errores : {}

  const nombreProveedor = (proveedores.datos ?? []).find((p) => p.id === b.proveedorId)?.nombre ?? 'el proveedor'
  const cambiar = (c: Partial<BorradorRecibida>) => { setB((x) => ({ ...x, ...c })); setFallo(null) }

  function cancelar() {
    guardarBorrador(null)
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navegar(-1)
    else navegar(rutaLibroDiario())
  }

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setIntentado(true)
    setFallo(null)
    const datos = comprobacion.datos
    if (!datos) return
    if (!accountId || !activa) { setFallo('No se ha guardado: no sé de qué empresa es. Elige la empresa arriba y vuelve a intentarlo.'); return }
    setGuardando(true)
    try {
      const r = await guardarRecibidaAMano({ accountId, companyId: activa.id, userId, userName, proveedor: nombreProveedor, datos })
      guardarBorrador(null)
      navegar(`${rutaRecibidaEnAsientos(r.id)}?ver=para-mirar`, { state: { aviso: textoGuardada(datos.numero, nombreProveedor) } })
    } catch (x) {
      setFallo(x instanceof Error ? x.message : String(x))
      setGuardando(false)
    }
  }

  if (proveedores.error) return <ErrorConReintento mensaje={proveedores.error} reintentar={proveedores.recargar} />
  if (tipos.error) return <ErrorConReintento mensaje={tipos.error} reintentar={tipos.recargar} />
  if (ejeLocal && locales.error) return <ErrorConReintento mensaje={locales.error} reintentar={locales.recargar} />
  if (!proveedores.datos || !tipos.datos || (ejeLocal && !locales.datos)) return <TarjetaCargando />

  const opcionesProveedor = [
    { valor: '', texto: proveedores.datos.length ? 'Elige el proveedor…' : 'No tienes proveedores dados de alta' },
    ...proveedores.datos.map((p) => ({ valor: p.id, texto: `${p.nombre}${p.nif ? ` · ${p.nif}` : ''}` })),
  ]
  const nombreEje = ejeLocal?.nombre ?? 'Local'
  const opcionesLocal = [
    { valor: '', texto: `Elige el ${nombreEje.toLowerCase()}…` },
    ...(locales.datos ?? []).map((l) => ({ valor: l.id, texto: l.nombre })),
    { valor: LOCAL_COMUN, texto: 'Común (se reparte)' },
  ]
  const opcionesTipo = listaTipos.map((t) => ({ valor: String(t), texto: t === 0 ? 'Sin IVA (0 %)' : porcentaje(t) }))
  const altaProveedor = `${rutaTerceros()}?nuevo=proveedor`

  return (
    <div className="s-pantalla">
      <header className="cxl-cabeza">
        <div>
          <Migas migas={[{ etiqueta: 'Contabilidad', ruta: rutaLibroDiario() }, { etiqueta: 'Asientos', ruta: rutaLibroDiario() }, { etiqueta: 'Recibida a mano' }]} />
          <h1 className="cxl-titulo">Nueva recibida a mano</h1>
        </div>
      </header>
      <p className="s-apoyo">Para una factura que no tienes en fichero. Se guarda para revisar, sin papel; después la miras y la apuntas como cualquier otra.</p>

      <form onSubmit={(e) => void guardar(e)} noValidate>
        <Tarjeta titulo="La factura">
          <div className="s-fila-campos">
            <Campo etiqueta="Proveedor" error={err.proveedor}
              ayuda={<Link to={altaProveedor} className="cx-enlace">+ Dar de alta un proveedor</Link>}>
              {(p) => <Selector {...p} valor={b.proveedorId} alCambiar={(v) => cambiar({ proveedorId: v })} opciones={opcionesProveedor} />}
            </Campo>
            <Campo etiqueta="Número de factura" error={err.numero}>
              {(p) => <Texto {...p} valor={b.numero} alCambiar={(v) => cambiar({ numero: v })} maxLength={60} autoComplete="off" placeholder="Ej.: A-2026/0123" />}
            </Campo>
            <Campo etiqueta="Fecha de expedición" error={err.fecha}>
              {(p) => <Fecha {...p} valor={b.fecha} alCambiar={(v) => cambiar({ fecha: v })} />}
            </Campo>
          </div>
          {/* Con error del proveedor, el enlace de alta sigue a mano: el error tapa la ayuda del campo. */}
          {err.proveedor && <p className="s-apoyo"><Link to={altaProveedor} className="cx-enlace">+ Dar de alta un proveedor</Link></p>}

          {ejeLocal && (
            <div className="s-fila-campos">
              <Campo etiqueta={nombreEje} error={err.local} ayuda="«Común» si es de todos: el informe por local lo reparte.">
                {(p) => <Selector {...p} valor={b.local} alCambiar={(v) => cambiar({ local: v })} opciones={opcionesLocal} />}
              </Campo>
            </div>
          )}

          <div className="s-fila-campos">
            <Campo etiqueta="Base imponible (€)" error={err.base}>
              {(p) => <Importe {...p} valor={b.base} alCambiar={(v) => cambiar({ base: v })} placeholder="1.234,56" />}
            </Campo>
            <Campo etiqueta="Tipo de IVA" error={err.tipo}>
              {(p) => <Selector {...p} valor={tipoElegido} alCambiar={(v) => cambiar({ tipo: v })} opciones={opcionesTipo} />}
            </Campo>
            <Campo etiqueta="Cuota de IVA (€)" error={err.cuota} aviso={comprobacion.aviso}
              ayuda={cuotaTocada
                ? <button type="button" className="cx-enlace" onClick={() => { setCuotaTocada(false); cambiar({ cuota: '' }) }}>Volver a la calculada{calculada !== null ? ` (${eurosExactos(calculada)})` : ''}</button>
                : 'Calculada: base × tipo. Si la factura dice otra, cámbiala.'}>
              {(p) => <Importe {...p} valor={cuotaVista} alCambiar={(v) => { if (v === cuotaVista) return; setCuotaTocada(true); cambiar({ cuota: v }) }} />}
            </Campo>
            <Campo etiqueta="Total (€)" ayuda="Base + cuota.">
              {(p) => <Texto {...p} valor={total !== null ? eurosExactos(total).replace(/\s€$/, '') : ''} alCambiar={() => undefined} readOnly tabIndex={-1} placeholder="—" />}
            </Campo>
          </div>

          <div role="status" aria-live="polite">
            {intentado && !comprobacion.datos && <p className="s-fallo">Falta algo: lo tienes debajo de cada campo en rojo.</p>}
          </div>
          {fallo && <p className="s-fallo" role="alert">{fallo}</p>}

          <div className="s-pie">
            <Boton variante="secundario" onClick={cancelar} ancho={movil}>Cancelar</Boton>
            <Boton variante="principal" type="submit" disabled={guardando} ancho={movil}>{guardando ? 'Guardando…' : 'Guardar y revisarla'}</Boton>
          </div>
        </Tarjeta>
      </form>
    </div>
  )
}
