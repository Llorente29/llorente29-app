// src/modules/conta/proveedor/ComoTeFactura.tsx
//
// «Cómo te factura» (encargo de compras, maqueta N20 FichaProveedor.dc.html):
// con cada entrega, entrega con albarán y factura después, o liquidación
// mensual. Arriba, lo que dicen sus últimos papeles —de qué tipo y si traían
// IVA, que decide si hay IVA que descontar (respuesta 1 del repaso)— contra lo
// que pone la ficha. Guarda por compras_forma_facturar, que además vuelve a
// decidir sus recepciones abiertas, y lo dice (regla 8).
//
// Vive en su pantalla, «Clientes y proveedores › <proveedor> › Cómo te
// factura» (ComoTeFacturaPage), como la maqueta.
//
// S01p·20·2 · Una opción más: «Me lo factura otro», con quién (un contacto de
// Compras). Guarda por compras_lo_factura_otro (1910): su ficha deja de
// preguntar y sus recepciones van con el que lo factura. Elegir otra forma la quita.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaComoTeFactura } from '@/config/navegacion'
import { tabla } from '@/modules/conta/services/bd'
import { cambiarCuandoLlegan, cambiarFormaFacturar, contactosQueFacturan, loFacturaOtro, ultimosPapeles, type LlegadaFacturas } from '@/modules/conta/services/comprasService'
import { FORMAS, FORMA_OTRO, chocaConLaFicha, fraseUltimosPapeles, tituloForma, type FormaFacturar, type PapelLeido } from '@/modules/conta/lib/compras'
import { Guardado } from '@/modules/conta/ui/piezas'

/** La forma elegida: una de las tres de la ficha, o «Me lo factura otro» (S01p·20·2). */
type Modo = FormaFacturar | typeof FORMA_OTRO.valor
interface Costumbre { modo: Modo | null; porLocal: boolean | null; frecuencia: string | null; otro: string | null }

export default function ComoTeFactura({ proveedor: id, nombre, alGuardar }: { proveedor: string; nombre: string; alGuardar?: () => void }) {
  const [guardada, setGuardada] = useState<Costumbre | null>(null)
  const [elegida, setElegida] = useState<Costumbre | null>(null)
  const [papeles, setPapeles] = useState<PapelLeido[] | null>(null)
  const [contactos, setContactos] = useState<{ id: string; nombre: string }[] | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    let vivo = true
    Promise.all([
      tabla('supplier').select('account_id, invoicing_mode, invoicing_per_location, invoicing_frequency, invoiced_by_supplier_id').eq('id', id).single(),
      ultimosPapeles(id, 5).catch((e: unknown) => { console.error('[cómo te factura] sus últimos albaranes y facturas', e); return [] as PapelLeido[] }),
    ]).then(async ([{ data, error }, ps]) => {
      if (!vivo) return
      if (error) { setFallo(`No se pudo leer cómo factura: ${error.message}`); return }
      const r = data as { account_id: string; invoicing_mode: FormaFacturar | null; invoicing_per_location: boolean | null; invoicing_frequency: string | null; invoiced_by_supplier_id: string | null }
      const c: Costumbre = r.invoiced_by_supplier_id
        ? { modo: FORMA_OTRO.valor, porLocal: null, frecuencia: null, otro: r.invoiced_by_supplier_id }
        : { modo: r.invoicing_mode, porLocal: r.invoicing_per_location, frecuencia: r.invoicing_frequency, otro: null }
      // Los contactos de Compras que pueden facturárselo: para elegir y para decir el nombre del guardado.
      const cs = await contactosQueFacturan(r.account_id, id).catch((e: unknown) => {
        console.error('[cómo te factura] los contactos que pueden facturar', e); return [] as { id: string; nombre: string }[]
      })
      if (!vivo) return
      setGuardada(c); setElegida(c); setPapeles(ps); setContactos(cs)
    })
    return () => { vivo = false }
  }, [id])

  if (!guardada || !elegida) {
    return fallo ? <div className="cx-error" role="alert">{fallo}</div> : null
  }
  const esOtro = (c: Costumbre) => c.modo === FORMA_OTRO.valor
  const nombreDe = (x: string | null) => contactos?.find((c) => c.id === x)?.nombre ?? null
  const cambiado = elegida.modo !== guardada.modo
    || (elegida.modo === 'delivery_note_then_invoice' && (elegida.porLocal !== guardada.porLocal || elegida.frecuencia !== guardada.frecuencia))
    || (esOtro(elegida) && elegida.otro !== guardada.otro)
  const dicen = papeles ? fraseUltimosPapeles(papeles) : null
  // Lo que sugieren sus documentos: la mayoría factura → con cada entrega; si no, albarán y factura después.
  const sugerida: FormaFacturar | null = papeles?.length
    ? (papeles.filter((p) => p.tipo === 'factura' || p.tipo === 'albaran_factura').length > papeles.length / 2 ? 'per_delivery' : 'delivery_note_then_invoice')
    : null
  const modoFicha: FormaFacturar | null = esOtro(guardada) ? null : guardada.modo as FormaFacturar | null
  // Con «me lo factura otro», sus papeles no deciden nada: no hay choque que avisar.
  const choca = !esOtro(guardada) && papeles ? chocaConLaFicha(papeles, modoFicha) : false
  const fraseFicha = esOtro(guardada)
    ? <>Aquí pone que lo factura {nombreDe(guardada.otro) ?? 'otro proveedor'} en su factura de género: no espero ninguna factura suya.</>
    : guardada.modo
      ? <>Aquí pone que {guardada.modo === 'monthly_settlement' ? 'liquida cada mes' : `factura ${tituloForma(guardada.modo)?.toLowerCase()}`}.</>
      : <>Su ficha no dice cómo factura.</>
  const puedeGuardar = cambiado && !ocupado && !!elegida.modo && (!esOtro(elegida) || !!elegida.otro)

  const opcion = (valor: Modo, titulo: string, explicacion: string, extra?: React.ReactNode, prueba?: string) => {
    const activa = elegida.modo === valor
    return (
      <div key={valor} className={activa ? 'cxc-forma cxc-forma-activa' : 'cxc-forma'} data-prueba={prueba}>
        <button type="button" role="radio" aria-checked={activa} className="cxc-forma-boton"
          onClick={() => setElegida({ ...elegida, modo: valor, otro: valor === FORMA_OTRO.valor ? (elegida.otro ?? guardada.otro) : null })}>
          <span className="cxc-forma-titulo"><span className={activa ? 'cxc-radio cxc-radio-si' : 'cxc-radio'} aria-hidden="true" />{titulo}{activa && guardada.modo === valor ? <span className="cx-chip cx-chip-azul" style={{ marginLeft: 8 }}>La de su ficha</span> : null}</span>
          <span className="cxc-forma-explica">{explicacion}</span>
        </button>
        {activa && extra}
      </div>
    )
  }

  return (
    <>
      <section className="cx-tarjeta cxc-como" id="campo-como-te-factura" tabIndex={-1} aria-label={`Cómo te factura ${nombre}`}>
        {(choca || (!guardada.modo && papeles?.length)) ? (
          <div id="cxc-como-dice" className="cx-aviso cxc-dice-choca" role="note">
            {dicen && <strong>{dicen}</strong>}{' '}
            {guardada.modo
              ? <>{fraseFicha} Si no es así, cámbialo y dejaré de preguntártelo.</>
              : <>Su ficha no dice cómo factura{sugerida ? <>: lo normal con esos documentos es «{tituloForma(sugerida)}»</> : null}.</>}
          </div>
        ) : (
          <p id="cxc-como-dice" className="cxc-dice">
            {!esOtro(guardada) && (dicen ? <strong>{dicen}</strong> : 'Todavía no hay albaranes ni facturas suyos leídos.')}{' '}
            {fraseFicha}
          </p>
        )}
        <div className="cxc-formas" role="radiogroup" aria-label="Cómo te factura" aria-describedby="cxc-como-dice">
          {FORMAS.map((f) => opcion(f.valor, f.titulo, f.explicacion, f.valor === 'delivery_note_then_invoice' ? (
            <div className="cxc-forma-mas" role="group" aria-label="Suele mandar la factura">
              <span>Suele mandar la factura</span>
              <button type="button" className={elegida.frecuencia === 'monthly' ? 'cx-boton-sec cxc-forma-op cxc-forma-op-si' : 'cx-boton-sec cxc-forma-op'}
                aria-pressed={elegida.frecuencia === 'monthly'} onClick={() => setElegida({ ...elegida, frecuencia: 'monthly' })}>una vez al mes</button>
              <button type="button" className={elegida.porLocal ? 'cx-boton-sec cxc-forma-op cxc-forma-op-si' : 'cx-boton-sec cxc-forma-op'}
                aria-pressed={!!elegida.porLocal} onClick={() => setElegida({ ...elegida, porLocal: !elegida.porLocal })}>una por cada local</button>
            </div>
          ) : undefined))}
          {opcion(FORMA_OTRO.valor, FORMA_OTRO.titulo, FORMA_OTRO.explicacion, (
            <div className="cxc-forma-mas" role="group" aria-label="Quién te lo factura">
              <label htmlFor="cxc-lo-factura">Quién te lo factura</label>
              <select id="cxc-lo-factura" className="cx-campo" data-prueba="lo-factura-quien" value={elegida.otro ?? ''}
                onChange={(e) => setElegida({ ...elegida, otro: e.target.value || null })}>
                <option value="">Elige un contacto de Compras…</option>
                {(contactos ?? []).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
          ), 'forma-lo-factura-otro')}
        </div>
        <div className="cx-pie">
          <button type="button" className="cx-boton-sec" disabled={!cambiado || ocupado} onClick={() => { setElegida(guardada); setAviso(null) }}>Dejarlo como estaba</button>
          <button type="button" className="cx-boton" disabled={!puedeGuardar} onClick={async () => {
            if (!elegida.modo) return
            setOcupado(true); setFallo(null); setAviso(null)
            try {
              if (esOtro(elegida)) {
                if (!elegida.otro) return
                const r = await loFacturaOtro(id, elegida.otro)
                const nueva: Costumbre = { modo: FORMA_OTRO.valor, porLocal: null, frecuencia: null, otro: elegida.otro }
                setGuardada(nueva); setElegida(nueva)
                setAviso(r.mensaje)
              } else {
                const modo = elegida.modo as FormaFacturar
                const r = await cambiarFormaFacturar(id, modo,
                  modo === 'delivery_note_then_invoice' ? !!elegida.porLocal : null,
                  modo === 'delivery_note_then_invoice' ? elegida.frecuencia : null)
                const nueva: Costumbre = { ...elegida, porLocal: modo === 'delivery_note_then_invoice' ? !!elegida.porLocal : null, otro: null }
                setGuardada(nueva); setElegida(nueva)
                setAviso(`Guardado: ${nombre} factura «${tituloForma(modo)}».${r.recepciones > 0 ? ` He vuelto a mirar ${r.recepciones === 1 ? 'su recepción abierta' : `sus ${r.recepciones} recepciones abiertas`} con esta costumbre.` : ''}`)
              }
              alGuardar?.()
            } catch (e) {
              setFallo(e instanceof Error ? e.message : 'No se pudo guardar cómo factura.')
            } finally { setOcupado(false) }
          }}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
        </div>
        <Guardado texto={aviso} />
        {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      </section>
      {/* Con «me lo factura otro» no se espera ninguna factura suya: no hay «cuándo llegan». */}
      {!esOtro(guardada) && <CuandoLlegan proveedor={id} nombre={nombre} />}
      <p className="cx-ayuda cxc-como-nota">Esto es la costumbre, y manda: si un día trae otro tipo de documento (un albarán en vez de factura, o al revés), no apunto ninguna factura con él y te aviso en Compras.</p>
    </>
  )
}

/**
 * S01c · «Cuándo llegan sus facturas»: al momento, o todas juntas a primeros
 * del mes siguiente (como Amirsa, que hace una factura por entrega pero las
 * manda a primeros de mes). Solo cambia hasta cuándo es normal esperarlas en
 * «Qué está esperando factura». Guarda al pulsar y dice qué ha guardado (regla 8).
 */
function CuandoLlegan({ proveedor, nombre }: { proveedor: string; nombre: string }) {
  const [valor, setValor] = useState<LlegadaFacturas | null | undefined>(undefined)
  const [aviso, setAviso] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => {
    let vivo = true
    tabla('supplier').select('invoice_arrival').eq('id', proveedor).maybeSingle()
      .then(({ data, error }: { data: { invoice_arrival: LlegadaFacturas | null } | null; error: { message: string } | null }) => {
        if (!vivo) return
        if (error) setFallo(`No se pudo leer cuándo llegan sus facturas: ${error.message}`)
        else setValor(data?.invoice_arrival ?? null)
      })
    return () => { vivo = false }
  }, [proveedor])
  if (valor === undefined) return fallo ? <div className="cx-error" role="alert">{fallo}</div> : null
  const elegir = async (v: LlegadaFacturas) => {
    setOcupado(true); setFallo(null); setAviso(null)
    try { setAviso(await cambiarCuandoLlegan(proveedor, v)); setValor(v) }
    catch (e) { setFallo(e instanceof Error ? e.message : 'No se pudo guardar.') }
    finally { setOcupado(false) }
  }
  const actual: LlegadaFacturas = valor ?? 'al_momento'
  return (
    <section className="cx-tarjeta cxc-como" aria-label={`Cuándo llegan las facturas de ${nombre}`} data-prueba="cuando-llegan">
      <p className="cxc-dice"><strong>Cuándo llegan sus facturas</strong></p>
      <div className="cxc-cuando-ops" role="radiogroup" aria-label="Cuándo llegan sus facturas">
        {([['al_momento', 'Al momento'], ['inicio_mes_siguiente', 'Todas juntas a primeros del mes siguiente']] as const).map(([v, texto]) => (
          <button key={v} type="button" role="radio" aria-checked={actual === v} disabled={ocupado}
            className={actual === v ? 'cx-boton-sec cxc-forma-op cxc-forma-op-si' : 'cx-boton-sec cxc-forma-op'}
            onClick={() => { if (actual !== v) void elegir(v) }}>{texto}</button>
        ))}
      </div>
      <p className="cx-ayuda" style={{ marginBottom: 0 }}>Con «todas juntas a primeros de mes», sus albaranes del mes no salen como retrasados hasta el día 10 del mes siguiente.</p>
      <Guardado texto={aviso} />
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
    </section>
  )
}

/**
 * En la ficha (pestaña Pago), una línea: cómo factura según su ficha y el
 * enlace a su pantalla. Antes la sección entera vivía aquí; la maqueta la pone
 * en su pantalla, y desde la ficha se llega con esto.
 */
export function ResumenComoTeFactura({ proveedor }: { proveedor: string }) {
  const [modo, setModo] = useState<FormaFacturar | null | undefined>(undefined)
  const [otro, setOtro] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    tabla('supplier').select('account_id, invoicing_mode, invoiced_by_supplier_id').eq('id', proveedor).maybeSingle()
      .then(async ({ data }: { data: { account_id: string; invoicing_mode: FormaFacturar | null; invoiced_by_supplier_id: string | null } | null }) => {
        // S01p·20·2: si se lo factura otro, su nombre (filtrado por la cuenta, regla 9).
        if (data?.invoiced_by_supplier_id) {
          const { data: o } = await tabla('supplier').select('name').eq('account_id', data.account_id).eq('id', data.invoiced_by_supplier_id).maybeSingle()
          if (vivo) setOtro((o as { name: string } | null)?.name ?? 'otro proveedor')
        }
        if (vivo) setModo(data?.invoicing_mode ?? null)
      })
    return () => { vivo = false }
  }, [proveedor])
  if (modo === undefined) return null
  return (
    <div className="cx-fieldset cxc-como-resumen">
      <span className="cx-tarjeta-titulo" style={{ fontSize: 16 }}>Cómo te factura</span>
      <p style={{ margin: 0 }}>
        {otro ? <>«{FORMA_OTRO.titulo}»: lo factura {otro}.</> : modo ? <>«{tituloForma(modo)}».</> : 'Su ficha no dice cómo factura.'}{' '}
        <Link to={rutaComoTeFactura(proveedor)}>{otro || modo ? 'Cambiarlo' : 'Decirlo'}</Link>
      </p>
    </div>
  )
}
