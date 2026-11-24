// src/modules/conta/nucleo/terceros/FichaTercero.tsx
//
// X27 · La ficha de proveedor y la de cliente, copia de ERP10 (maqueta nucleo_20, aprobada el 22/11; capturas erp10/05,
// 06 y 07). Sustituyen a las fichas de hoy en el núcleo (con el interruptor encendido y en el ordenador); la del móvil,
// la del interruptor apagado y la de Cocina (Folvy) se quedan. Hechas con las piezas comunes del K12:
//   · la ventana «Ficha de proveedor» / «Ficha de cliente», con sus pestañas abajo: Subcuentas, Datos proveedor (o
//     cliente), Movimientos (su mayor) y Saldos (mes a mes, como la captura 07);
//   · la barra: guardar, cancelar, nuevo, ← → (por su subcuenta), y «Movimientos» y «Facturas»;
//   · arriba, la subcuenta (gris: la pone el programa; en el alta, la siguiente libre de la 400 o la 430) y el nombre;
//   · a la izquierda, «Datos proveedor»; a la derecha, «Datos por defecto en facturas» y «Datos de pago» (en el
//     cliente, sin los de gasto, y «Datos de cobro» con su «Subcuenta de cobro»).
// Lo que se escribe a la derecha es lo que propone la factura nueva: los tipos de IVA, la retención, el % deducible, la
// subcuenta de gasto, el local, la marca, la plataforma, la subcuenta de pago y el pago directo (la base copia lo suyo
// al nacer la recibida: 1316). El tipo de operación del proveedor es gris: lo calcula Sumied y se cambia en la factura.
// Intro pasa a la casilla siguiente y, en la última o fuera de una casilla, guarda; Esc la deja (con la pregunta si hay
// cambios). Sin ventanas de «¿estás seguro?».

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { CONTA, rutaConta, rutaDocumentos, rutaFichaTercero, rutaTerceros } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useConPropias } from '@/modules/conta/marco/nuevo/contexto'
import { useAvisoSalir } from '@/modules/conta/diseno/plantillas/avisoSalir'
import { useNombreDePestana, useSeVe } from '@/modules/conta/diseno/plantillas/pestana'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { cifra } from '@/modules/conta/nucleo/ficha/textos'
import { fechaVista } from '@/modules/conta/nucleo/ficha/teclas'
import { Barra, Bloque, Casilla, Ventana, type Mide } from '@/modules/conta/nucleo/piezas/Ventana'
import { CasillaLupa } from '@/modules/conta/nucleo/piezas/Lupa'
import { Lineas, type Columna } from '@/modules/conta/nucleo/piezas/Lineas'
import {
  FORMAS_PAGO, OPERACIONES_CLIENTE, PAISES, TIPOS_NIF, borradorVacio, cambios, conSaldo, nombrePais, porQueNoSeGuarda, saldosPorMes,
  type Borrador, type Movimiento, type TipoTercero,
} from './fichaTercero'
import { baseDeLaFicha, guardarCliente, guardarProveedor, leerCliente, leerProveedor, movimientos, vecinos, type BaseFicha, type FichaLeida } from './servicio'
import './fichaTercero.css'

type Aviso = { texto: string; tono: 'bien' | 'ambar' | 'gris' }
const NUEVO = 'nuevo'

export function FichaTercero({ tipo, id: idRuta }: { tipo: TipoTercero; id: string }) {
  const { accountId, cargando, userId, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const navegar = useNavigate()
  const location = useLocation()
  const seVe = useSeVe()
  useConPropias()
  const hoy = hoyEnMadrid()
  const id = idRuta === NUEVO ? null : idRuta
  const prov = tipo === 'proveedor'
  const nombreDatos = prov ? 'Datos proveedor' : 'Datos cliente'
  const PESTANAS = ['Subcuentas', nombreDatos, 'Movimientos', 'Saldos']

  const [base, setBase] = useState<BaseFicha | null>(null)
  const [leida, setLeida] = useState<FichaLeida | null | 'no' | undefined>(undefined)
  const [fallo, setFallo] = useState<string | null>(null)
  const [aviso, setAviso] = useState<Aviso | null>((location.state as { aviso?: Aviso } | null)?.aviso ?? null)
  const [vuelta, setVuelta] = useState(0)
  const [pestana, setPestana] = useState(nombreDatos)
  const [b, setB] = useState<Borrador>(borradorVacio())
  const [antes, setAntes] = useState<Borrador>(borradorVacio())
  const [intentado, setIntentado] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    if (cargando || !accountId || !activa) return
    let vivo = true
    baseDeLaFicha(accountId, activa.id).then(async (bs) => {
      const f = id ? await (prov ? leerProveedor(accountId, activa.id, id, bs.retenciones) : leerCliente(accountId, activa.id, id)) : null
      if (!vivo) return
      setBase(bs); setLeida(id ? f ?? 'no' : null)
      const ini = f?.borrador ?? borradorVacio()
      setB(ini); setAntes(ini); setIntentado(false)
    }, (e: unknown) => { if (vivo) setFallo(e instanceof Error ? e.message : String(e)) })
    return () => { vivo = false }
  }, [accountId, activa, cargando, id, prov, vuelta])

  const ficha = leida && leida !== 'no' ? leida : null
  const cambiadas = cambios(antes, b)
  const hayCambios = cambiadas.length > 0
  const noSeGuarda = porQueNoSeGuarda(b)
  const ambar = (k: keyof Borrador) => intentado && noSeGuarda?.casilla === k

  const [lado, setLado] = useState<{ antes: string | null; despues: string | null }>({ antes: null, despues: null })
  useEffect(() => {
    if (!accountId || !activa || leida === undefined) return
    let vivo = true
    vecinos(accountId, activa.id, tipo, id).then((x) => { if (vivo) setLado(x) }, () => undefined)
    return () => { vivo = false }
  }, [accountId, activa, tipo, id, leida])

  const [movs, setMovs] = useState<{ clave: string; lista: Movimiento[] } | null>(null)
  const claveMovs = `${ficha?.subcuenta?.id ?? ''}:${vuelta}`
  useEffect(() => {
    if (!accountId || !activa || !ficha?.subcuenta || (pestana !== 'Movimientos' && pestana !== 'Saldos')) return
    let vivo = true
    const clave = `${ficha.subcuenta.id}:${vuelta}`
    movimientos(accountId, activa.id, ficha.subcuenta.id).then((l) => { if (vivo) setMovs({ clave, lista: l }) }, (e: unknown) => { if (vivo) setFallo(e instanceof Error ? e.message : String(e)) })
    return () => { vivo = false }
  }, [accountId, activa, ficha?.subcuenta, pestana, vuelta])
  const lista = movs?.clave === claveMovs ? movs.lista : null

  const volver = () => navegar(rutaTerceros())
  const { pedirSalir, aviso: dialogoSalir } = useAvisoSalir({
    hay: hayCambios, cambios: hayCambios ? [{ campo: 'ficha', etiqueta: prov ? 'La ficha del proveedor' : 'La ficha del cliente', antes: antes.nombre, ahora: b.nombre || 'sin nombre' }] : [],
    donde: b.nombre ? `${prov ? 'Proveedor' : 'Cliente'} · ${b.nombre}` : prov ? 'Proveedor nuevo' : 'Cliente nuevo',
    onGuardar: async () => (await guardar()) ? true : (fallo ?? 'No se ha guardado.'),
    onDescartar: () => { setB(antes); setIntentado(false) },
  })
  useNombreDePestana(b.nombre || antes.nombre ? `${prov ? 'Proveedor' : 'Cliente'} · ${antes.nombre || b.nombre}` : prov ? 'Proveedor nuevo' : 'Cliente nuevo')
  // La de conta siempre (rutaFichaProveedor lleva a la de Cocina fuera de Sumied): esta ficha es la del núcleo.
  const rutaDe = (x: string) => (prov ? rutaConta(CONTA.rutas.fichaProveedor, { supplierId: x }) : rutaFichaTercero(x))
  const ir = (x: string | null) => { if (x) pedirSalir(() => navegar(rutaDe(x))) }

  async function guardar(): Promise<boolean> {
    if (!accountId || !activa || ocupado) return false
    setIntentado(true)
    if (noSeGuarda) { setFallo(noSeGuarda.texto); enfocar(`#ft-${noSeGuarda.casilla}`); return false }
    if (id && !hayCambios) { setAviso({ texto: 'No había nada distinto: la ficha se queda como estaba.', tono: 'gris' }); return true }
    setOcupado(true); setFallo(null)
    try {
      const r = prov
        ? await guardarProveedor({ accountId, companyId: activa.id, id, antes, ahora: b, retenciones: base?.retenciones ?? [], subcuentas: base?.subcuentas ?? [], quien: userName ?? null, userId: userId ?? null })
        : await guardarCliente({ accountId, companyId: activa.id, id, antes, ahora: b, quien: userName ?? null })
      const quedan = `${r.texto}${cambiadas.length && id ? ` ${cambiadas.length === 1 ? 'Una casilla cambiada' : `${cambiadas.length} casillas cambiadas`}.` : ''}`
      if (!id) { navegar(rutaDe(r.id), { state: { aviso: { texto: quedan, tono: r.tono } } }); return true }
      setAviso({ texto: quedan, tono: r.tono }); setVuelta((v) => v + 1)
      return true
    } catch (e) { setFallo(e instanceof Error ? e.message : String(e)); return false }
    finally { setOcupado(false) }
  }

  // ── El teclado: Intro pasa a la siguiente casilla; en la última, guarda. Esc la deja. ──
  const ventana = useRef<HTMLDivElement>(null)
  const enfocar = (sel: string) => {
    const el = ventana.current?.querySelector<HTMLElement>(sel)
    if (el) el.focus(); else window.setTimeout(() => ventana.current?.querySelector<HTMLElement>(sel)?.focus(), 0)
  }
  const casillas = () => Array.from(ventana.current?.querySelectorAll<HTMLElement>('[data-orden], .ft-lupa input') ?? [])
    .filter((x) => !(x as HTMLInputElement).readOnly && !(x as HTMLInputElement).disabled)
  const siguiente = (desde: HTMLElement) => {
    const l = casillas(); const i = l.indexOf(desde)
    if (i >= 0 && i < l.length - 1) { l[i + 1].focus(); if (l[i + 1] instanceof HTMLInputElement) (l[i + 1] as HTMLInputElement).select() }
    else void guardar()
  }
  const siguienteDe = (sel: string) => { const el = ventana.current?.querySelector<HTMLElement>(sel); if (el) siguiente(el) }
  const intro = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Enter' || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    e.preventDefault(); siguiente(e.currentTarget)
  }
  useEffect(() => { if (base && !id) enfocar('#ft-nombre') }, [base, id])

  const teclas = useRef<(e: globalThis.KeyboardEvent) => void>(() => undefined)
  useEffect(() => {
    teclas.current = (e) => {
      if (!seVe() || e.defaultPrevented) return
      const enCasilla = (e.target as HTMLElement)?.closest?.('input, select, textarea, button, [role="dialog"], tr[tabindex]')
      if (e.key === 'Escape') { e.preventDefault(); pedirSalir(volver); return }
      if (e.key === 'Enter' && !enCasilla && !e.altKey && !e.shiftKey && pestana === nombreDatos) { e.preventDefault(); void guardar() }
    }
  })
  useEffect(() => {
    const f = (e: globalThis.KeyboardEvent) => teclas.current(e)
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [])

  if (fallo && !base) return <div className="kp-ventana"><p className="kp-aviso" data-tono="ambar" role="alert">{fallo}</p></div>
  if (!base || leida === undefined) return <div className="kp-ventana" aria-busy="true" aria-label="Cargando la ficha"><p className="ft-cargando">Abriendo la ficha…</p></div>
  if (leida === 'no') return <div className="kp-ventana"><p className="kp-aviso" data-tono="ambar" role="alert">Esa ficha no existe o no es de esta cuenta. <Link to={rutaTerceros()}>Volver a la lista</Link></p></div>

  const poner = (x: Partial<Borrador>) => { setB((v) => ({ ...v, ...x })); setFallo(null) }
  // X27c · Cada casilla mide lo que su dato (la pieza Casilla, `mide`); las de una lupa con su nombre gris al lado, el
  // código y el nombre con su ancho (en px, de la captura de ERP10). En una pantalla grande no se estira nada.
  const texto = (k: keyof Borrador, rotulo: string, o: { cifra?: boolean; className?: string; mide?: Mide } = {}) => (
    <Casilla rotulo={rotulo} htmlFor={`ft-${k}`} ambar={ambar(k)} className={o.className} mide={o.mide}>
      <input id={`ft-${k}`} data-orden className={o.cifra ? 'kp-num' : undefined} value={String(b[k])} inputMode={o.cifra ? 'decimal' : undefined}
        onChange={(e) => poner({ [k]: e.target.value } as Partial<Borrador>)} onKeyDown={intro} />
    </Casilla>
  )
  const marca = (k: 'recargo' | 'no347' | 'pagoDirecto', rotulo: string, titulo?: string, apagada = false) => (
    <label className="ft-marca" title={titulo}>
      <input type="checkbox" id={`ft-${k}`} data-orden checked={b[k]} disabled={apagada} onChange={(e) => poner({ [k]: e.target.checked } as Partial<Borrador>)} onKeyDown={intro} />
      {rotulo}
    </label>
  )
  const lupa = <T extends { id: string; codigo: string; descripcion: string }>(k: keyof Borrador, rotulo: string, registros: readonly T[],
    o: { vista?: (r: T) => string; codigo: number; nombre?: number; mide?: Mide; className?: string } = { codigo: 120 }) => {
    const elegido = registros.find((r) => r.id === b[k]) ?? null
    return (
      <Casilla rotulo={rotulo} htmlFor={`ft-${k}`} mide={o.nombre ? undefined : o.mide} className={o.nombre ? 'ft-con-nombre' : o.className}>
        <span className="ft-lupa" style={o.nombre ? { width: o.codigo } : undefined}>
          <CasillaLupa id={`ft-${k}`} etiqueta={rotulo} registros={registros} valor={String(b[k]) || null} vista={o.vista}
            poner={(r) => poner({ [k]: r?.id ?? '' } as Partial<Borrador>)}
            alIntro={() => siguienteDe(`#ft-${k}`)}
            teclas={(e) => { if (e.key === 'Enter' && !e.defaultPrevented) { e.preventDefault(); siguiente(e.currentTarget) } }} />
        </span>
        {o.nombre && <input className="ft-gris" style={{ width: o.nombre }} readOnly tabIndex={-1} aria-label={`${rotulo}: su nombre`} value={elegido?.descripcion ?? ''} />}
      </Casilla>
    )
  }

  // ── «Datos proveedor» / «Datos cliente» ─────────────────────────────────────
  const sub = ficha?.subcuenta ?? null
  const izquierdaDatos = (
    <Bloque titulo={nombreDatos} className="ft-izquierda" recuadro>
      <div className="ft-fila">
        {texto('nif', 'N.I.F.', { mide: 'corto' })}
        <Casilla rotulo="Tipo de identificador" htmlFor="ft-tipoNif" className="ft-tipo-nif">
          <select id="ft-tipoNif" data-orden value={b.tipoNif} onChange={(e) => poner({ tipoNif: e.target.value as Borrador['tipoNif'] })} onKeyDown={intro}>
            {TIPOS_NIF.map((t) => <option key={t.valor} value={t.valor}>{t.texto}</option>)}
          </select>
        </Casilla>
        {texto('comercial', 'Nombre comercial', { mide: 'nombre' })}
      </div>
      <div className="ft-fila">{texto('domicilio', 'Domicilio', { className: 'ft-domicilio' })}{texto('postal', 'C. postal', { className: 'ft-postal' })}{texto('poblacion', 'Población', { mide: 'medio' })}</div>
      <div className="ft-fila">
        {texto('provincia', 'Provincia', { mide: 'medio' })}
        <Casilla rotulo="País" htmlFor="ft-pais" ambar={ambar('pais')} className="ft-con-nombre">
          <span className="ft-lupa" style={{ width: 56 }}>
            <CasillaLupa id="ft-pais" etiqueta="País" registros={PAISES} valor={b.pais.toUpperCase() || null}
              resolver={(t) => { const c = t.trim().toUpperCase(); const r = PAISES.find((p) => p.codigo === c || p.descripcion === c) ?? null; return { registro: r, abrir: !r } }}
              poner={(r) => poner({ pais: r?.codigo ?? '' })}
              alIntro={() => siguienteDe('#ft-pais')}
              teclas={(e) => { if (e.key === 'Enter' && !e.defaultPrevented) { e.preventDefault(); siguiente(e.currentTarget) } }} />
          </span>
          <input className="ft-gris" style={{ width: 170 }} readOnly tabIndex={-1} aria-label="País: su nombre" value={nombrePais(b.pais)} />
        </Casilla>
      </div>
      <div className="ft-fila">{texto('telefono', 'Teléfonos', { className: 'ft-telefono' })}{texto('correo', 'Correo electrónico', { className: 'ft-correo' })}{texto('web', 'Página web', { className: 'ft-web' })}</div>
      <div className="ft-fila">{texto('observaciones', 'Observaciones', { mide: 'largo' })}</div>
      <div className="ft-marcas">
        {marca('recargo', 'Recargo de equivalencia')}
        {marca('no347', 'No incluir en 347')}
      </div>
    </Bloque>
  )
  const tipoIva = (k: 'iva1' | 'iva2', rotulo: string) => lupa(k, rotulo, base.tasas, { vista: (r) => r.codigo, codigo: 56, nombre: 170 })
  const derechaDatos = (
    <div className="ft-derecha">
      <Bloque titulo="Datos por defecto en facturas" recuadro>
        <div className="ft-rotulo-solo">Tipos de I.V.A.</div>
        <div className="ft-fila ft-f-ivas">{tipoIva('iva1', 'Tipo de I.V.A. 1')}{tipoIva('iva2', 'Tipo de I.V.A. 2')}</div>
        <div className="ft-fila">
          {prov && ficha?.retencionPct && !base.retenciones.some((r) => r.id === b.retencion) && b.retencion
            ? texto('retencion', 'Retención (%)', { cifra: true, className: 'ft-deducible' })
            : lupa('retencion', 'Retención', base.retenciones, { vista: (r) => r.codigo, codigo: 56, nombre: 170 })}
          {prov && texto('deducible', '% I.V.A. deducible', { cifra: true, className: 'ft-deducible' })}
          {prov
            ? <Casilla rotulo="Tipo de operación" htmlFor="ft-operacion" gris mide="medio"><input id="ft-operacion" readOnly value={ficha?.operacion ?? ''} title="La calcula Sumied con su país, su NIF-IVA y su régimen. Se cambia en la factura." /></Casilla>
            : <Casilla rotulo="Tipo de operación" htmlFor="ft-operacion" mide="medio">
                <select id="ft-operacion" data-orden value={b.operacion || 'domestic'} onChange={(e) => poner({ operacion: e.target.value })} onKeyDown={intro}>
                  {OPERACIONES_CLIENTE.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
                </select>
              </Casilla>}
        </div>
        {prov && (
          <div className="ft-fila">
            {lupa('gasto', 'Subcuenta de gasto', base.subcuentas, { codigo: 120, nombre: 180 })}
            {lupa('suplidos', 'Subcuenta suplidos', base.subcuentas.filter((c) => c.codigo.startsWith('6')), { codigo: 120, nombre: 160 })}
          </div>
        )}
        {prov && (
          <div className="ft-fila">
            {lupa('local', 'Local', base.locales, { vista: (r) => r.descripcion, codigo: 0, className: 'ft-analitica' })}
            {lupa('marca', 'Marca', base.marcas, { vista: (r) => r.descripcion, codigo: 0, className: 'ft-analitica' })}
            {lupa('plataforma', 'Plataforma', base.plataformas, { vista: (r) => r.descripcion, codigo: 0, className: 'ft-analitica' })}
          </div>
        )}
      </Bloque>
      <Bloque titulo={prov ? 'Datos de pago' : 'Datos de cobro'} recuadro>
        <div className="ft-fila">
          {prov ? lupa('pago', 'Subcuenta de pago', base.subcuentas.filter((c) => c.id !== sub?.id), { codigo: 120, nombre: 300 })
            : lupa('pago', 'Subcuenta de cobro', base.cobros, { codigo: 120, nombre: 300 })}
        </div>
        <div className="ft-fila">
          <Casilla rotulo="Forma de pago" htmlFor="ft-forma" className="ft-forma">
            <select id="ft-forma" data-orden value={b.forma} onChange={(e) => poner({ forma: e.target.value as Borrador['forma'] })} onKeyDown={intro}>
              <option value="">—</option>
              {FORMAS_PAGO.map((f) => <option key={f.valor} value={f.valor}>{f.texto}</option>)}
            </select>
          </Casilla>
          {texto('dias', 'Días', { cifra: true, mide: 'cifra' })}
          {texto('iban', 'IBAN', { className: 'ft-iban' })}
        </div>
        {prov && <div className="ft-marcas">{marca('pagoDirecto', 'Pago directo al contabilizar la factura', 'La factura propone el pago con la subcuenta de pago en su fecha, sin esperar al vencimiento.')}</div>}
      </Bloque>
    </div>
  )

  // ── Las otras pestañas ──────────────────────────────────────────────────────
  const colSub: Columna[] = [{ clave: 'rol', titulo: 'Para qué', ancho: '30%' }, { clave: 'codigo', titulo: 'Subcuenta', ancho: '18%' }, { clave: 'nombre', titulo: 'Nombre' }]
  const ejercicio = base.ejercicios.find((e) => hoy >= e.inicio && hoy <= e.fin) ?? base.ejercicios[0] ?? null
  const conS = lista ? conSaldo(lista, tipo) : []
  const saldos = lista && ejercicio ? saldosPorMes(lista, ejercicio) : null
  const colMov: Columna[] = [
    { clave: 'fecha', titulo: 'Fecha', ancho: '11%' }, { clave: 'documento', titulo: 'Documento', ancho: '14%' }, { clave: 'concepto', titulo: 'Concepto' },
    { clave: 'debe', titulo: 'Debe', cifra: true, ancho: '12%' }, { clave: 'haber', titulo: 'Haber', cifra: true, ancho: '12%' }, { clave: 'saldo', titulo: 'Saldo', cifra: true, ancho: '12%' },
  ]
  const colSaldo: Columna[] = [{ clave: 'nombre', titulo: 'Mes' }, { clave: 'debe', titulo: 'Debe', cifra: true, ancho: '18%' }, { clave: 'haber', titulo: 'Haber', cifra: true, ancho: '18%' }, { clave: 'saldo', titulo: 'Saldo', cifra: true, ancho: '18%' }]
  const sinSubcuenta = <p className="ft-nada">{id ? 'Aún no tiene subcuenta en esta empresa: la tendrá al guardar su primera factura.' : 'Se ve al darlo de alta.'}</p>

  let cuerpo: ReactNode
  if (pestana === 'Subcuentas') {
    cuerpo = <Bloque titulo="Subcuentas" crece><Lineas etiqueta="Sus subcuentas" columnas={colSub} filas={ficha?.roles ?? []} elegida={null} vacia="Sin subcuentas en esta empresa."
      celda={(f, c) => (c === 'rol' ? f.rol : c === 'codigo' ? f.subcuenta.codigo : f.subcuenta.descripcion)} /></Bloque>
  } else if (pestana === 'Movimientos') {
    cuerpo = !sub ? sinSubcuenta : (
      <Bloque titulo={`Movimientos de la ${sub.codigo}`} crece>
        <Lineas etiqueta="Sus movimientos" columnas={colMov} filas={conS} elegida={null} vacia={lista ? 'Sin movimientos.' : 'Leyendo…'}
          celda={(m, c) => c === 'fecha' ? fechaVista(m.fecha) : c === 'documento' ? m.documento : c === 'concepto' ? m.concepto
            : c === 'debe' ? (m.debe ? cifra(m.debe) : '') : c === 'haber' ? (m.haber ? cifra(m.haber) : '') : cifra(m.saldo)}
          suma={<span className="ft-suma" data-prueba="saldo-final">Saldo {cifra(conS.at(-1)?.saldo ?? 0)}</span>} />
      </Bloque>
    )
  } else if (pestana === 'Saldos') {
    cuerpo = !sub ? sinSubcuenta : (
      <Bloque titulo={`Saldos de la ${sub.codigo}${ejercicio ? ` · ejercicio ${ejercicio.code}` : ''}`} crece>
        <Lineas etiqueta="Sus saldos por mes" columnas={colSaldo} filas={saldos?.meses ?? []} elegida={null} vacia={lista ? 'Sin ejercicio.' : 'Leyendo…'}
          celda={(m, c) => c === 'nombre' ? m.nombre : c === 'debe' ? cifra(m.debe) : c === 'haber' ? cifra(m.haber) : cifra(m.saldo)}
          suma={<span className="ft-suma">Apertura {cifra(saldos?.apertura ?? 0)}</span>} />
      </Bloque>
    )
  } else {
    cuerpo = <div className="ft-columnas">{izquierdaDatos}{derechaDatos}</div>
  }

  const prefijo = prov ? '400' : '430'
  return (
    <div className="ft" ref={ventana} data-prueba={prov ? 'ficha-proveedor-nucleo' : 'ficha-cliente-nucleo'}>
      <Ventana id="ft" titulo={prov ? 'Ficha de proveedor' : 'Ficha de cliente'} pestanas={PESTANAS} activa={pestana} alPestana={setPestana} alCerrar={() => pedirSalir(volver)}>
        <Barra
          guardar={{ hacer: () => void guardar(), puede: !ocupado, titulo: 'Guardar (Intro)' }}
          cancelar={{ hacer: () => { setB(antes); setIntentado(false); setFallo(null) }, puede: hayCambios, titulo: 'Cancelar lo escrito' }}
          nuevo={{ hacer: () => pedirSalir(() => navegar(rutaDe(NUEVO))), titulo: prov ? 'Proveedor nuevo' : 'Cliente nuevo' }}
          anterior={{ hacer: () => ir(lado.antes), puede: !!lado.antes, titulo: 'El de antes (por su subcuenta)' }}
          siguiente={{ hacer: () => ir(lado.despues), puede: !!lado.despues, titulo: 'El de después (por su subcuenta)' }}
          extra={<>
            <button type="button" className="kp-barra-texto" disabled={!sub} onClick={() => setPestana('Movimientos')}>Movimientos <span className="ft-hoja-mayor" aria-hidden="true" /></button>
            {prov && <button type="button" className="kp-barra-texto ft-barra-facturas" disabled={!id} onClick={() => id && pedirSalir(() => navegar(`${rutaDocumentos()}${rutaDocumentos().includes('?') ? '&' : '?'}prov=${encodeURIComponent(id)}`))}>Facturas <span className="kp-barra-hoja" aria-hidden="true" /></button>}
          </>}
          aviso={<>
            {aviso && <span className="kp-aviso" data-tono={aviso.tono} role="status" title={aviso.texto}>{aviso.texto}</span>}
            {fallo && <span className="kp-aviso" data-tono="ambar" role="alert" title={fallo}>{fallo}</span>}
          </>}
        />
        <div className="ft-cuerpo">
          <div className="ft-cabeza">
            <Casilla rotulo="Subcuenta" htmlFor="ft-subcuenta" gris mide="subcuenta">
              <input id="ft-subcuenta" readOnly value={sub?.codigo ?? ''} placeholder={id ? '' : `La siguiente de la ${prefijo}`} title={sub ? sub.descripcion : `Al darlo de alta, la siguiente libre de la ${prefijo}`} />
            </Casilla>
            <Casilla rotulo="Nombre" htmlFor="ft-nombre" ambar={ambar('nombre')} mide="largo">
              <input id="ft-nombre" data-orden value={b.nombre} onChange={(e) => poner({ nombre: e.target.value })} onKeyDown={intro} />
            </Casilla>
          </div>
          {cuerpo}
        </div>
      </Ventana>
      {dialogoSalir}
    </div>
  )
}
