// src/modules/conta/compras/ComprasPage.tsx
//
// Compras (encargo «Contabilidad: las compras», maqueta N18). Lo que llega con
// el género ya entra solo desde el local: aquí solo se ve lo que necesita que
// alguien decida, lo que espera factura y las liquidaciones del mes.
//
// Regla 7: es una pantalla que se abre a propósito; ninguna fila se esconde.
// Lo único que deja de salir es una pregunta que alguien cerró («Dejarlo así»),
// y eso lo decidió una persona y queda escrito con su nota.
// Regla 8: cada botón dice lo que ha hecho, con contenido.

import { useEffect, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { rutaLiquidacion, rutaLiquidacionNueva } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { Cabecera, ErrorConReintento, Guardado, Tarjeta, TarjetaCargando } from '@/modules/conta/ui/piezas'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import {
  agruparAMirar, albaranesDesde, cuandoLlega, diasEntre, DIAS_SIN_FACTURAR, estadoLiquidacion, fraseLiquidacion, fraseSaldo, importeEsperando,
  mesAnterior, mesLargo, mesSiguiente, nombreMes, primeroDeMes, type EsperandoFactura, type FilaLiquidacion, type Mirar,
} from '@/modules/conta/lib/compras'
import { cargarEsperando, cargarLiquidaciones, cargarMirar, contarContabilizadas } from '@/modules/conta/services/comprasService'
import SubirFactura from '@/modules/conta/compras/SubirFactura'
import { FilasAMirar } from '@/modules/conta/compras/QueMirar'
import { refrescarCuentasMenu } from '@/modules/conta/marco/useCuentasMenu'

interface Datos {
  mirar: Mirar
  esperando: EsperandoFactura[]
  liquidaciones: { mes: string; filas: FilaLiquidacion[] }[]
  contabilizadas: number | null
}

export default function ComprasPage() {
  const { accountId } = useCuentaConta()
  const { activa } = useEmpresas()
  const hoy = hoyEnMadrid()
  const mes = primeroDeMes(hoy)
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const [aviso, setAviso] = useState<string | null>(null)
  const [subir, setSubir] = useState<{ ficheros?: File[] } | null>(null)

  useEffect(() => {
    if (!accountId) return
    let vivo = true
    Promise.all([
      cargarMirar(accountId),
      cargarEsperando(accountId),
      cargarLiquidaciones(accountId, mesAnterior(mes)),
      cargarLiquidaciones(accountId, mes),
      activa ? contarContabilizadas(activa.id, mes, mesSiguiente(mes)) : Promise.resolve(null),
    ]).then(([m, e, la, lb, n]) => {
      if (!vivo) return
      setError(null)
      setDatos({ mirar: m, esperando: e, liquidaciones: [{ mes: mesAnterior(mes), filas: la }, { mes, filas: lb }], contabilizadas: n })
    }).catch((e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : String(e)) })
    return () => { vivo = false }
  }, [accountId, activa, mes, vuelta])

  const hecho = (frase: string) => { setAviso(frase); setVuelta((v) => v + 1); refrescarCuentasMenu() }

  const cabecera = (
    <Cabecera antetitulo="Contabilidad" titulo="Compras" derecha={<>
      <span className="cxc-pie-mes">{mesLargo(hoy).replace(/^./, (c) => c.toUpperCase())}</span>
      <button type="button" className="cx-boton" onClick={() => setSubir({})} disabled={!accountId}>Subir una factura</button>
    </>} />
  )

  if (error) return <div className="cxc">{cabecera}<ErrorConReintento mensaje={error} reintentar={() => setVuelta((v) => v + 1)} /></div>
  if (!datos || !accountId) return <div className="cxc">{cabecera}<TarjetaCargando /><TarjetaCargando /></div>

  const filas = agruparAMirar(datos.mirar)
  const n = filas.length
  return (
    <div className="cxc">
      {cabecera}
      <p className="cxc-entra">Lo que llega con el género ya entra solo desde el local. Aquí sólo ves lo que necesita que alguien decida.</p>
      <Guardado texto={aviso} />

      <Tarjeta titulo="Qué tienes que mirar" accion={<span className={n === 0 ? 'cxc-cuenta cxc-cuenta-cero' : 'cxc-cuenta'} aria-label={`${n} por decidir`}>{n}</span>}>
        {n === 0
          ? <p style={{ margin: 0, color: 'var(--cx-apoyo)' }}>No hay nada que decidir: todo lo recibido sabe a dónde va.</p>
          : <FilasAMirar filas={filas} accountId={accountId} hecho={hecho} subir={() => setSubir({})} />}
      </Tarjeta>

      <Esperando filas={datos.esperando} hoy={hoy} soltar={(fs) => setSubir({ ficheros: fs })} />

      <Tarjeta titulo="Liquidaciones del mes">
        <p className="cx-ayuda" style={{ marginTop: 0 }}>Proveedores que no facturan cada entrega: liquidan una vez al mes, local por local.</p>
        {datos.liquidaciones.every((x) => x.filas.length === 0)
          ? <p style={{ margin: 0, color: 'var(--cx-apoyo)' }}>Ningún proveedor tiene puesto que liquida cada mes. Se pone en su ficha, en «Cómo te factura».</p>
          : datos.liquidaciones.flatMap((x) => x.filas.map((f) => <FilaLiq key={`${x.mes}-${f.proveedor}-${f.local}`} f={f} mes={x.mes} hoy={hoy} />))}
      </Tarjeta>

      {datos.contabilizadas !== null && (
        <p className="cxc-pie-mes">
          {datos.contabilizadas === 0
            ? `Todavía no hay facturas de ${nombreMes(mes)} contabilizadas.`
            : `${datos.contabilizadas} ${datos.contabilizadas === 1 ? 'factura' : 'facturas'} de ${nombreMes(mes)} ya ${datos.contabilizadas === 1 ? 'está contabilizada' : 'están contabilizadas'}.`}{' '}
          <Link to="/supply/facturas">Verlas</Link>
        </p>
      )}

      {subir && (
        <SubirFactura accountId={accountId} empresaId={activa?.id ?? null} ficheros={subir.ficheros}
          alCerrar={() => setSubir(null)} alTerminar={(frase) => { setSubir(null); hecho(frase) }} />
      )}
    </div>
  )
}

// ── Qué está esperando factura ─────────────────────────────────────────────

function Esperando({ filas, hoy, soltar }: { filas: EsperandoFactura[]; hoy: string; soltar: (fs: File[]) => void }) {
  const [encima, setEncima] = useState(false)
  const alSoltar = (e: DragEvent) => {
    e.preventDefault(); setEncima(false)
    const fs = Array.from(e.dataTransfer.files ?? [])
    if (fs.length > 0) soltar(fs)
  }
  return (
    <Tarjeta titulo="Qué está esperando factura">
      <p className="cx-ayuda" style={{ marginTop: 0 }}>Género recibido con albarán. Se apunta cuando llega la factura.</p>
      {filas.length === 0
        ? <p style={{ margin: 0, color: 'var(--cx-apoyo)' }}>Nada espera factura.</p>
        : (
          <div className="cxc-tabla cxc-esperando" role="table" aria-label="Qué está esperando factura">
            <span className="cxc-tabla-cabeza" role="columnheader">Proveedor</span>
            <span className="cxc-tabla-cabeza" role="columnheader">Local</span>
            <span className="cxc-tabla-cabeza" role="columnheader">Albaranes</span>
            <span className="cxc-tabla-cabeza cx-cifra" role="columnheader">Importe</span>
            <span className="cxc-tabla-cabeza" role="columnheader">Cuándo llega</span>
            {filas.map((e) => {
              const tarde = diasEntre(e.oldest, hoy) > DIAS_SIN_FACTURAR
              return [
                <span key={`${e.supplier_id}-${e.location_id}-p`} role="cell" style={{ fontWeight: 600 }}>{e.supplier_name}</span>,
                <span key={`${e.supplier_id}-${e.location_id}-l`} role="cell" className="cxc-solo-ancho">{e.location_name ?? 'Sin local'}</span>,
                <span key={`${e.supplier_id}-${e.location_id}-a`} role="cell" className="cxc-solo-ancho">{albaranesDesde(e)}</span>,
                <span key={`${e.supplier_id}-${e.location_id}-i`} role="cell" className="cx-cifra">{importeEsperando(e)}</span>,
                <span key={`${e.supplier_id}-${e.location_id}-c`} role="cell" className={tarde ? 'cxc-cuando cxc-tarde' : 'cxc-cuando'}>
                  {cuandoLlega(e, hoy)}
                </span>,
              ]
            })}
          </div>
        )}
      <div className={encima ? 'cxc-soltar cxc-soltar-encima' : 'cxc-soltar'}
        onDragOver={(e) => { e.preventDefault(); setEncima(true) }} onDragLeave={() => setEncima(false)} onDrop={alSoltar}>
        <span>Arrastra aquí la factura cuando llegue. Yo busco a qué albaranes corresponde y te digo si cuadra.</span>
        <label className="cx-boton-sec" style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
          Elegir el fichero
          <input type="file" accept="image/*,application/pdf" multiple className="cx-oculto"
            onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) soltar(fs) }} />
        </label>
      </div>
    </Tarjeta>
  )
}

// ── Liquidaciones del mes ──────────────────────────────────────────────────

function FilaLiq({ f, mes, hoy }: { f: FilaLiquidacion; mes: string; hoy: string }) {
  const estado = estadoLiquidacion(f, mes, hoy)
  const saldo = estado === 'confirmada' || estado === 'por_confirmar' ? fraseSaldo(f.saldo) : null
  return (
    <div className="cxc-liq">
      <div className="cxc-liq-texto">
        <span className="cxc-liq-titulo">{f.proveedor_nombre}{f.local_nombre ? ` · ${f.local_nombre}` : ''} · {nombreMes(mes)}</span>
        <span className="cxc-cosa-apoyo">{fraseLiquidacion(f, mes, hoy)}</span>
      </div>
      {saldo && <span className="cxc-liq-saldo">{saldo}</span>}
      {f.liquidacion
        ? <Link className={estado === 'por_confirmar' ? 'cx-boton' : 'cx-boton-sec'} to={rutaLiquidacion(f.liquidacion)}>Abrir</Link>
        : estado === 'no_ha_llegado' && <Link className="cx-boton" to={rutaLiquidacionNueva(f.proveedor, f.local, mes)}>Subir sus documentos</Link>}
    </div>
  )
}
