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
import { Link, useSearchParams } from 'react-router-dom'
import { rutaLibroDiario, rutaLiquidacion, rutaLiquidacionNueva } from '@/config/navegacion'
import { MARCA } from '@/modules/conta/cuenta/marca'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { ErrorConReintento, Guardado, Tarjeta, TarjetaCargando } from '@/modules/conta/ui/piezas'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import {
  agruparAMirar, esperaEnPalabras, estadoLiquidacion, fraseLiquidacion, fraseSaldo,
  mesAnterior, mesSiguiente, nombreMes, primeroDeMes, type FilaLiquidacion, type Mirar,
} from '@/modules/conta/lib/compras'
import { eurosExactos, fechaLarga } from '@/modules/conta/lib/formato'
import { cargarEsperandoDetalle, cargarLiquidaciones, cargarMirar, contarContabilizadas, type AlbaranEsperando } from '@/modules/conta/services/comprasService'
import { LlegadoPorCorreo } from '@/modules/conta/compras/CorreoFacturas'
import { HuecoAlbaran } from '@/modules/conta/compras/HuecoAlbaran'
import SubirFactura from '@/modules/conta/compras/SubirFactura'
import { EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import { FilasAMirar } from '@/modules/conta/compras/QueMirar'
import { refrescarCuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { useHosteleria } from '@/modules/conta/marco/nuevo/contexto'

interface Datos {
  mirar: Mirar
  esperando: AlbaranEsperando[]
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
  // C06: «Subir factura» desde la ficha del proveedor llega aquí con ?subir=<proveedor>
  // (sin Cocina no hay /supply/facturas). Se abre el diálogo de subir.
  const [params, setParams] = useSearchParams()
  // S01: «Subir factura» de la cinta llega igual (?subir), también estando ya aquí.
  const [subir, setSubir] = useState<{ ficheros?: File[] } | null>(null)
  const pideSubir = params.get('subir') !== null
  if (pideSubir && subir === null) setSubir({})
  useEffect(() => { if (pideSubir) setParams((p) => { p.delete('subir'); return p }, { replace: true }) }, [pideSubir, setParams])
  const hosteleria = useHosteleria()

  useEffect(() => {
    if (!accountId) return
    let vivo = true
    Promise.all([
      cargarMirar(accountId),
      cargarEsperandoDetalle(accountId),
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

  // S02 · Patrón único: estas son las RECEPCIONES del local que esperan una
  // decisión o su factura, y cuelgan de Facturas recibidas (es de donde salen
  // esas facturas). Su título lo dice, con sus migas. «Subir factura» hay UNO
  // en Compras (regla 1 del patrón), en Facturas recibidas: aquí solo queda el
  // de cada recepción («Subir su factura»), que la casa con su albarán.
  const cabecera = (
    <EncabezadoPagina titulo="Recepciones del local" migasExtra={[{ etiqueta: 'Recepciones del local' }]}
      frase={`${hosteleria ? 'Lo que llega con el género entra solo desde el local. ' : ''}Aquí solo ves lo que necesita que alguien decida.`} />
  )

  if (error) return <div className="cxc">{cabecera}<ErrorConReintento mensaje={error} reintentar={() => setVuelta((v) => v + 1)} /></div>
  if (!datos || !accountId) return <div className="cxc">{cabecera}<TarjetaCargando /><TarjetaCargando /></div>

  const filas = agruparAMirar(datos.mirar)
  const n = filas.length
  return (
    <div className="cxc">
      {cabecera}
      <Guardado texto={aviso} />

      <Tarjeta titulo="Qué tienes que mirar" accion={<span className={n === 0 ? 'cxc-cuenta cxc-cuenta-cero' : 'cxc-cuenta'} aria-label={`${n} por decidir`}>{n}</span>}>
        {n === 0
          ? <p style={{ margin: 0, color: 'var(--cx-apoyo)' }}>No hay nada que decidir: todo lo recibido sabe a dónde va.</p>
          : <FilasAMirar filas={filas} accountId={accountId} hecho={hecho} subir={() => setSubir({})} />}
      </Tarjeta>

      <Esperando filas={datos.esperando} soltar={(fs) => setSubir({ ficheros: fs })} hecho={hecho} />

      {activa && <LlegadoPorCorreo companyId={activa.id} />}

      {hosteleria && <Tarjeta titulo="Liquidaciones del mes">
        <p className="cx-ayuda" style={{ marginTop: 0 }}>Proveedores que no facturan cada entrega: liquidan una vez al mes, local por local.</p>
        {datos.liquidaciones.every((x) => x.filas.length === 0)
          ? <p style={{ margin: 0, color: 'var(--cx-apoyo)' }}>Ningún proveedor tiene puesto que liquida cada mes. Se pone en su ficha, en «Cómo te factura».</p>
          : datos.liquidaciones.flatMap((x) => x.filas.map((f) => <FilaLiq key={`${x.mes}-${f.proveedor}-${f.local}`} f={f} mes={x.mes} hoy={hoy} />))}
      </Tarjeta>}

      {datos.contabilizadas !== null && (
        <p className="cxc-pie-mes">
          {datos.contabilizadas === 0
            ? `Todavía no hay facturas de ${nombreMes(mes)} contabilizadas.`
            : `${datos.contabilizadas} ${datos.contabilizadas === 1 ? 'factura' : 'facturas'} de ${nombreMes(mes)} ya ${datos.contabilizadas === 1 ? 'está contabilizada' : 'están contabilizadas'}.`}{' '}
          <Link to={MARCA.soloContabilidad ? rutaLibroDiario('compras') : '/supply/facturas'}>Verlas</Link>
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
// S01c: albarán a albarán, con los días que lleva y hasta cuándo es normal
// esperar según cómo factura su proveedor y cuándo manda las facturas. El
// plazo pone la etiqueta «retrasado» y el orden; no quita ninguna fila (regla 7).

function Esperando({ filas, soltar, hecho }: { filas: AlbaranEsperando[]; soltar: (fs: File[]) => void; hecho: (frase: string) => void }) {
  const [encima, setEncima] = useState(false)
  const alSoltar = (e: DragEvent) => {
    e.preventDefault(); setEncima(false)
    const fs = Array.from(e.dataTransfer.files ?? [])
    if (fs.length > 0) soltar(fs)
  }
  const retrasados = filas.filter((f) => f.retrasado).length
  return (
    <Tarjeta titulo="Qué está esperando factura" accion={filas.length > 0 ? <span className="cxc-cuenta" aria-label={`${filas.length} albaranes`}>{filas.length}</span> : undefined}>
      <p className="cx-ayuda" style={{ marginTop: 0 }}>
        Género recibido con albarán. Cuando llega su factura (por correo o subida), la caso con su albarán y te digo si cuadra.
        {retrasados > 0 ? ` ${retrasados === 1 ? 'Uno lleva' : `${retrasados} llevan`} más de lo normal: arriba.` : ''}
      </p>
      {filas.length === 0
        ? <p style={{ margin: 0, color: 'var(--cx-apoyo)' }}>Nada espera factura.</p>
        : (
          <ul className="cxc-esperando-lista" aria-label="Qué está esperando factura" data-prueba="esperando">
            {filas.map((a) => {
              const e = esperaEnPalabras(a)
              return (
                <li key={a.goods_receipt_id} data-retrasado={a.retrasado ? 'si' : undefined}>
                  <span className="cxc-liq-titulo">{a.supplier_name} · albarán {a.doc_number ?? a.code ?? ''} del {fechaLarga(a.receipt_date)}</span>
                  <span className="cx-cifra">{a.total_papel != null ? eurosExactos(a.total_papel) : a.base != null ? `${eurosExactos(a.base)} de base` : 'sin importe'}</span>
                  <span className={a.retrasado ? 'cxc-cuando cxc-tarde' : 'cxc-cuando'}>{e.estado}</span>
                  <span className="cxc-cosa-apoyo">{e.porque}</span>
                  {a.lineas_sin_leer != null && <HuecoAlbaran recepcion={a.goods_receipt_id} falta={a.lineas_sin_leer} alHacer={(frase) => hecho(frase)} />}
                </li>
              )
            })}
          </ul>
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
