// src/modules/conta/compras/QueMirar.tsx
//
// «Qué tienes que mirar» (N18, repaso del 10/10): una fila por DECISIÓN, no
// por papel. Trece papeles a nombre del mismo local son una pregunta; lo que
// le falta a una ficha va junto. Cada fila enseña sus papeles (regla 7:
// agrupar no esconde) y cada papel se puede ver. Primero lo humano (quién,
// cuándo, dónde, cuánto); el código, pequeño y al final.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { rutaFichaProveedor } from '@/config/navegacion'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { validarNifEs } from '@/modules/conta/lib/nif'
import {
  FORMAS, conPunto, diaConNombre, fraseFicha, normaNombre, papelSolo, porQueFicha, propuestasDeNombre, rangoFechas, totalPapeles,
  type FilaAMirar, type FormaFacturar, type RecepcionAMirar, type SinCamino,
} from '@/modules/conta/lib/compras'
import {
  cambiarFormaFacturar, cerrarPregunta, decidirDestinatario, rehacerCamino, sinIva,
} from '@/modules/conta/services/comprasService'
import { guardarFicha, listarProveedores } from '@/modules/conta/services/proveedorService'
import { VerPapel } from '@/modules/conta/compras/VerPapel'

type Hecho = (frase: string) => void

function useAccion(hecho: Hecho) {
  const [ocupado, setOcupado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const hacer = async (f: () => Promise<string>) => {
    setOcupado(true); setFallo(null)
    try { hecho(await f()) } catch (e) { setFallo(e instanceof Error ? e.message : 'No se pudo hacer.') } finally { setOcupado(false) }
  }
  return { ocupado, fallo, hacer }
}

const papeles = (n: number, uno = 'papel', varios = 'papeles') => (n === 1 ? `1 ${uno}` : `${n} ${varios}`)
const vuelta = (n: number) => (n === 0 ? '' : n === 1 ? ' He vuelto a mirar 1 recepción.' : ` He vuelto a mirar ${n} recepciones.`)
const quienes = (ps: readonly RecepcionAMirar[]) => [...new Set(ps.map((p) => p.proveedor_nombre).filter(Boolean))] as string[]

/** «Los trae Aurora Brands · del 1 al 9 de octubre · Norte Centro · 1.234,56 €» */
function resumen(ps: readonly RecepcionAMirar[], conQuien = true): string {
  const t: string[] = []
  const qs = quienes(ps)
  if (conQuien && qs.length) t.push(qs.length === 1 ? (ps.length === 1 ? qs[0] : `Los trae ${qs[0]}`) : `De ${qs.length} proveedores`)
  t.push(ps.length === 1 ? diaConNombre(ps[0].fecha) : rangoFechas(ps.map((p) => p.fecha)))
  const locales = [...new Set(ps.map((p) => p.local_nombre).filter(Boolean))]
  if (locales.length === 1) t.push(locales[0]!); else if (locales.length > 1) t.push(`${locales.length} locales`)
  const { total, sinImporte } = totalPapeles(ps)
  t.push(`${eurosExactos(total)}${sinImporte ? ` (y ${sinImporte} sin importe)` : ''}`)
  return t.join(' · ')
}

/** La fila: lo que hay que decidir, por qué, sus botones y, debajo, sus papeles. */
function Fila({ frase, apoyo, porque, acciones, ps, fallo }: {
  frase: ReactNode; apoyo?: ReactNode; porque?: ReactNode; acciones: ReactNode; ps: readonly RecepcionAMirar[]; fallo: string | null
}) {
  return (
    <div className="cxc-cosa">
      <div className="cxc-cosa-texto">
        <span className="cxc-cosa-frase">{frase}</span>
        {apoyo && <span className="cxc-cosa-apoyo">{apoyo}</span>}
        {porque && <span className="cxc-cosa-porque">{porque}</span>}
        {ps.length === 1 && <span className="cxc-cosa-codigo">{ps[0].codigo}</span>}
        {ps.length > 1 && (
          <details className="cxc-papeles">
            <summary>Ver los {ps.length} papeles</summary>
            <ul>
              {ps.map((p) => (
                <li key={p.recepcion}>
                  <span>{[p.proveedor_nombre, diaConNombre(p.fecha), p.local_nombre, p.base == null ? 'sin importe' : eurosExactos(p.base)].filter(Boolean).join(' · ')}
                    {' '}<span className="cxc-cosa-codigo">{p.codigo}</span></span>
                  <VerPapel recepcion={p.recepcion} titulo={`${p.proveedor_nombre ?? 'Papel'} · ${diaConNombre(p.fecha)}`} />
                </li>
              ))}
            </ul>
          </details>
        )}
        {fallo && <span className="cx-error" role="alert">{fallo}</span>}
      </div>
      <div className="cxc-cosa-acciones">
        {acciones}
        {ps.length === 1 && <VerPapel recepcion={ps[0].recepcion} titulo={`${ps[0].proveedor_nombre ?? 'Papel'} · ${diaConNombre(ps[0].fecha)}`} />}
      </div>
    </div>
  )
}

const cerrarTodas = async (ps: readonly RecepcionAMirar[], nota: string | null) => { for (const p of ps) await cerrarPregunta(p.recepcion, nota) }

// ── A nombre de quién ──────────────────────────────────────────────────────

function FilaNombre({ f, accountId, hecho }: { f: Extract<FilaAMirar, { tipo: 'nombre' }>; accountId: string; hecho: Hecho }) {
  const { ocupado, fallo, hacer } = useAccion(hecho)
  const [buscar, setBuscar] = useState(false)
  const propuestas = useMemo(() => propuestasDeNombre(f.nombre, f.candidatos, [...new Set(f.papeles.map((p) => p.proveedor).filter(Boolean))] as string[]), [f])
  const decidir = (a: { empresa?: string; proveedor?: string; otro?: boolean }, quien: string) => hacer(async () => {
    const x = await decidirDestinatario(accountId, f.nombre, a)
    return a.otro
      ? `Apuntado: «${f.nombre}» no es tuyo. Lo recordaré.${vuelta(x.recepciones)}`
      : `Apuntado: «${f.nombre}» es ${conPunto(quien)} Lo recordaré para los próximos papeles.${vuelta(x.recepciones)}`
  })
  const n = f.papeles.length
  return (
    <>
      <Fila ps={f.papeles} fallo={fallo}
        frase={<>{n === 1 ? 'Un papel va' : `${n} papeles van`} a nombre de «{f.nombre}». ¿De quién {n === 1 ? 'es' : 'son'}?</>}
        apoyo={resumen(f.papeles)}
        acciones={<>
          {propuestas.map((p, i) => (
            <span key={p.id} className="cxc-propuesta">
              <button type="button" className={i === 0 ? 'cx-boton' : 'cx-boton-sec'} disabled={ocupado}
                onClick={() => void decidir(p.tipo === 'empresa' ? { empresa: p.id } : { proveedor: p.id }, p.nombre)}>Es {p.nombre}</button>
              <span className="cxc-propuesta-porque">{p.porque}</span>
            </span>
          ))}
          <button type="button" className="cx-boton-sec" disabled={ocupado} onClick={() => setBuscar(true)}>Es de otro…</button>
          <button type="button" className="cx-boton-sec" disabled={ocupado} onClick={() => void decidir({ otro: true }, '')}>No es nuestro</button>
        </>} />
      {buscar && (
        <BuscarDueno accountId={accountId} nombre={f.nombre} alCerrar={() => setBuscar(false)}
          alElegir={(a, quien) => { setBuscar(false); void decidir(a, quien) }} />
      )}
    </>
  )
}

/** «Es de otro…»: buscar entre tus empresas y tus proveedores. */
function BuscarDueno({ accountId, nombre, alCerrar, alElegir }: {
  accountId: string; nombre: string; alCerrar: () => void; alElegir: (a: { empresa?: string; proveedor?: string }, quien: string) => void
}) {
  const { empresas } = useEmpresas()
  const [proveedores, setProveedores] = useState<{ id: string; name: string }[]>([])
  const [texto, setTexto] = useState('')
  useEffect(() => { void listarProveedores(accountId).then((ps) => setProveedores(ps.map((p) => ({ id: p.id, name: p.name })))) }, [accountId])
  const q = normaNombre(texto)
  const opciones = [
    ...empresas.map((e) => ({ tipo: 'empresa' as const, id: e.id, nombre: e.razonSocial ?? e.nombre, apoyo: 'tu empresa' })),
    ...proveedores.map((p) => ({ tipo: 'proveedor' as const, id: p.id, nombre: p.name, apoyo: 'proveedor' })),
  ].filter((o) => !q || normaNombre(o.nombre).includes(q)).slice(0, 12)
  return (
    <Dialogo titulo={`¿De quién es «${nombre}»?`} alCerrar={alCerrar}>
      <label className="cx-campo">
        <span className="cx-etiqueta">Busca tu empresa o un proveedor</span>
        <input className="cx-input" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escribe parte del nombre" />
      </label>
      <div className="cxc-buscar" role="listbox" aria-label="Resultados">
        {opciones.map((o) => (
          <button key={`${o.tipo}-${o.id}`} type="button" role="option" aria-selected={false} className="cxc-buscar-op"
            onClick={() => alElegir(o.tipo === 'empresa' ? { empresa: o.id } : { proveedor: o.id }, o.nombre)}>
            <span>{o.nombre}</span><span className="cx-ayuda">{o.apoyo}</span>
          </button>
        ))}
        {opciones.length === 0 && <p className="cx-ayuda" style={{ margin: 0 }}>Nada con ese nombre. Si es un proveedor nuevo, dalo de alta en Clientes y proveedores.</p>}
      </div>
      <div className="cx-pie"><button type="button" className="cx-boton-sec" onClick={alCerrar}>Cancelar</button></div>
    </Dialogo>
  )
}

// ── A nombre de otro: el IVA no se descuenta ───────────────────────────────

function FilaSinIva({ f, empresaId, hecho }: { f: Extract<FilaAMirar, { tipo: 'sin_iva' }>; empresaId: string | null; hecho: Hecho }) {
  const { ocupado, fallo, hacer } = useAccion(hecho)
  const [apuntar, setApuntar] = useState(false)
  const n = f.papeles.length
  const facturas = f.papeles.every((p) => p.papel === 'factura' || p.papel === 'albaran_factura')
  const qs = quienes(f.papeles)
  const { total } = totalPapeles(f.papeles)
  const cosa = facturas ? (n === 1 ? 'Una factura' : `${n} facturas`) : (n === 1 ? 'Un papel' : `${n} papeles`)
  return (
    <>
      <Fila ps={f.papeles} fallo={fallo}
        frase={<>{cosa}{qs.length === 1 ? ` de ${qs[0]}` : ''} {n === 1 ? 'viene' : 'vienen'} a nombre de «{f.nombre}», no de tu empresa. Así no puedes descontar su IVA.</>}
        apoyo={resumen(f.papeles, qs.length !== 1)}
        acciones={<>
          <button type="button" className="cx-boton-sec" disabled={ocupado} onClick={() => void hacer(async () => {
            await cerrarTodas(f.papeles, 'Pedida a nombre de la empresa.')
            return `Apuntado: has pedido ${n === 1 ? 'que la rehagan' : `que rehagan las ${n}`} a nombre de tu empresa. Cuando llegue, súbela con «Subir una factura».`
          })}>Pedir que la rehagan</button>
          {facturas && empresaId && (
            <button type="button" className="cx-boton-sec" disabled={ocupado} onClick={() => setApuntar(true)}>Apuntarla sin descontar el IVA</button>
          )}
        </>} />
      {apuntar && empresaId && (
        <Dialogo titulo="Apuntarla sin descontar el IVA" alCerrar={() => setApuntar(false)}>
          <h3 className="cx-tarjeta-titulo" style={{ fontSize: 16, margin: 0 }}>Lo que voy a apuntar</h3>
          <p style={{ margin: 0 }}>
            {n === 1 ? 'Registro la factura' : `Registro las ${n} facturas`}{qs.length === 1 ? ` de ${qs[0]}` : ''} ({eurosExactos(total)} de base) como gasto con su IVA dentro:
            el IVA no va a la 472 ni al libro de facturas recibidas como deducible, porque {n === 1 ? 'no va' : 'no van'} a nombre de tu empresa.
          </p>
          <div className="cx-pie">
            <button type="button" className="cx-boton-sec" onClick={() => setApuntar(false)}>Cancelar</button>
            <button type="button" className="cx-boton" disabled={ocupado} onClick={() => { setApuntar(false); void hacer(async () => {
              let ultima = ''
              for (const p of f.papeles) ultima = (await sinIva(p.recepcion, empresaId)).frase
              return n === 1 ? ultima : `Apuntadas ${n} facturas sin descontar el IVA. Su IVA va como más gasto; no va a la 472 ni al libro de facturas recibidas como deducible.`
            }) }}>Apuntar</button>
          </div>
        </Dialogo>
      )}
    </>
  )
}

// ── La ficha dice una cosa y el papel otra ─────────────────────────────────

const tituloDe = (m: FormaFacturar | null) => FORMAS.find((x) => x.valor === m)?.titulo ?? ''

function FilaPapelFicha({ f, hecho }: { f: Extract<FilaAMirar, { tipo: 'papel_ficha' }>; hecho: Hecho }) {
  const { ocupado, fallo, hacer } = useAccion(hecho)
  const n = f.papeles.length
  const esAlbaran = f.papel === 'albaran'
  const veces = n === 1 ? '' : ` ${n} veces`
  return (
    <Fila ps={f.papeles} fallo={fallo}
      frase={f.ficha === 'monthly_settlement'
        ? <>{f.proveedor_nombre} ha entregado{veces} con {papelSolo(f.papel)} a nombre de tu empresa, y en su ficha pone que liquida cada mes.</>
        : <>{f.proveedor_nombre} ha entregado{veces} con {papelSolo(f.papel)}, y en su ficha pone que factura {tituloDe(f.ficha).toLowerCase()}.</>}
      apoyo={resumen(f.papeles, false)}
      acciones={<>
        <button type="button" className="cx-boton-sec" disabled={ocupado} onClick={() => void hacer(async () => {
          await cerrarTodas(f.papeles, esAlbaran ? 'Esta vez fue albarán: se espera su factura.' : 'Esta vez trajo factura.')
          return esAlbaran ? `Apuntado: ${n === 1 ? 'la recepción' : `las ${n} recepciones`} de ${f.proveedor_nombre} ${n === 1 ? 'espera' : 'esperan'} su factura. Su ficha sigue igual.` : `Apuntado: esta vez ${f.proveedor_nombre} trajo factura. Su ficha sigue igual.`
        })}>{esAlbaran ? 'Es un albarán: esperar su factura' : 'Solo esta vez'}</button>
        {f.sugerida && <button type="button" className="cx-boton" disabled={ocupado} onClick={() => void hacer(async () => {
          const x = await cambiarFormaFacturar(f.proveedor, f.sugerida!, null, null)
          return `Guardado en la ficha de ${f.proveedor_nombre}: «${tituloDe(f.sugerida)}».${vuelta(x.recepciones)}`
        })}>Cambiar su ficha a «{tituloDe(f.sugerida)}»</button>}
      </>} />
  )
}

/** El socio, o quien sea, sin decir si liquida cada mes. */
function FilaLiquida({ f, hecho }: { f: Extract<FilaAMirar, { tipo: 'liquida' }>; hecho: Hecho }) {
  const { ocupado, fallo, hacer } = useAccion(hecho)
  const n = f.papeles.length
  return (
    <Fila ps={f.papeles} fallo={fallo}
      frase={<>{n === 1 ? 'Un papel va' : `${n} papeles van`} a nombre de {f.proveedor_nombre}, y su ficha no dice si liquida cada mes.</>}
      apoyo={resumen(f.papeles)}
      acciones={<>
        <button type="button" className="cx-boton" disabled={ocupado} onClick={() => void hacer(async () => {
          const x = await cambiarFormaFacturar(f.proveedor, 'monthly_settlement', null, null)
          return `Guardado en la ficha de ${f.proveedor_nombre}: «Liquidación mensual».${vuelta(x.recepciones)}`
        })}>Sí, liquida cada mes</button>
        <Link className="cx-boton-sec" to={`${rutaFichaProveedor(f.proveedor, 'pago')}#campo-como-te-factura`}>Abrir su ficha</Link>
      </>} />
  )
}

// ── Lo que le falta a una ficha, todo junto ────────────────────────────────

function FilaFicha({ f, hecho }: { f: Extract<FilaAMirar, { tipo: 'ficha' }>; hecho: Hecho }) {
  const { ocupado, fallo, hacer } = useAccion(hecho)
  const falta = (k: string) => f.falta.find((x) => x.falta === k)
  const nifF = falta('nif')
  const nif = nifF && nifF.falta === 'nif' && nifF.ofrece ? validarNifEs(nifF.ofrece) : null
  const forma = !!falta('forma_facturar')
  const destino = forma ? `${rutaFichaProveedor(f.proveedor, 'pago')}#campo-como-te-factura`
    : falta('tipo_gasto') ? `${rutaFichaProveedor(f.proveedor, 'contabilidad')}#campo-expenseCategoryId`
    : `${rutaFichaProveedor(f.proveedor, 'datos-fiscales')}#campo-taxId`
  const orden = [...FORMAS].sort((a, b) => (a.valor === f.sugerida ? -1 : b.valor === f.sugerida ? 1 : 0))
  return (
    <Fila ps={f.papeles} fallo={fallo}
      frase={fraseFicha(f.proveedor_nombre, f.falta)}
      apoyo={f.papeles.length ? resumen(f.papeles, false) : undefined}
      porque={<>{porQueFicha(f.falta)}{nif && !nif.ok ? ` El NIF de su papel no es válido (${nif.motivo}): pídeselo.` : ''}</>}
      acciones={<>
        {nif?.ok && (
          <button type="button" className="cx-boton" disabled={ocupado} onClick={() => void hacer(async () => {
            const ahora = new Date().toISOString()
            // Como «Aceptar» en las propuestas de la ficha (Propuestas.tsx): comprobado por la letra de control.
            await guardarFicha(f.proveedor, { taxId: nif.normalizado, taxIdType: 'nif_es', taxIdVerifiedAt: ahora, taxIdCheckStatus: 'valid', taxIdCheckedAt: ahora })
            return `Guardado: el NIF de ${f.proveedor_nombre} es ${nif.normalizado}.`
          })}>Usar ese NIF</button>
        )}
        {forma && orden.map((o) => (
          <button key={o.valor} type="button" className={o.valor === f.sugerida && !nif?.ok ? 'cx-boton' : 'cx-boton-sec'} disabled={ocupado}
            onClick={() => void hacer(async () => {
              const x = await cambiarFormaFacturar(f.proveedor, o.valor, null, null)
              return `Guardado en la ficha de ${f.proveedor_nombre}: «${o.titulo}».${vuelta(x.recepciones)}`
            })}>{o.titulo}</button>
        ))}
        <Link className="cx-boton-sec" to={destino}>Abrir su ficha</Link>
      </>} />
  )
}

// ── Lo demás ───────────────────────────────────────────────────────────────

function FilaOtra({ f, hecho, subir }: { f: Extract<FilaAMirar, { tipo: 'otra' }>; hecho: Hecho; subir: () => void }) {
  const { ocupado, fallo, hacer } = useAccion(hecho)
  const n = f.papeles.length
  const prov = f.proveedor_nombre ?? 'un proveedor'
  const p0 = f.papeles[0]
  let frase: string
  let porque: string | undefined
  let principal: ReactNode = null
  if (f.pregunta === 'sin_papel') {
    frase = `${n === 1 ? 'Una entrega' : `${n} entregas`} de ${prov} ${n === 1 ? 'llegó' : 'llegaron'} sin papel leído, y su ficha dice que factura con cada entrega.`
    porque = 'Sin su factura no hay nada que apuntar: súbela cuando la tengas.'
    principal = <button type="button" className="cx-boton" disabled={ocupado} onClick={subir}>Subir su factura</button>
  } else if (f.pregunta === 'factura_sin_importes') {
    frase = `${n === 1 ? 'La factura' : `${n} facturas`} de ${prov} no se ${n === 1 ? 'ha' : 'han'} podido apuntar: al papel le faltan importes o el IVA de alguna línea.`
    porque = (p0.detalle as { motivo?: string } | null)?.motivo ?? undefined
    principal = <button type="button" className="cx-boton" disabled={ocupado} onClick={subir}>Subir la factura completa</button>
  } else if (f.pregunta === 'factura_repetida') {
    frase = `${n === 1 ? 'La factura' : `${n} facturas`} de ${prov} ya ${n === 1 ? 'estaba registrada' : 'estaban registradas'}: se ${n === 1 ? 'ha' : 'han'} enlazado a la que había, sin crear otra.`
    porque = 'Mira que de verdad es la misma; si lo es, déjalo así.'
  } else {
    frase = `Folvy no pudo decidir qué hacer con ${n === 1 ? 'una recepción' : `${n} recepciones`} de ${prov}.`
    porque = p0.error ? `El error: ${p0.error}` : undefined
    principal = <button type="button" className="cx-boton" disabled={ocupado} onClick={() => void hacer(async () => {
      let ok = 0
      for (const p of f.papeles) { await rehacerCamino(p.recepcion); ok++ }
      return `Vuelto a intentar con ${papeles(ok, 'recepción', 'recepciones')}.`
    })}>Volver a intentarlo</button>
  }
  return (
    <Fila ps={f.papeles} fallo={fallo} frase={frase} apoyo={resumen(f.papeles, false)} porque={porque}
      acciones={<>
        {principal}
        <button type="button" className="cx-boton-sec" disabled={ocupado} onClick={() => void hacer(async () => {
          await cerrarTodas(f.papeles, null)
          return `Apuntado: ${n === 1 ? 'se queda' : `las ${n} se quedan`} así.`
        })}>Dejarlo así</button>
      </>} />
  )
}

/** Las recepciones confirmadas sin camino: qué falta saber y por qué. */
function FilaSinCamino({ rs, hecho }: { rs: readonly SinCamino[]; hecho: Hecho }) {
  const { ocupado, fallo, hacer } = useAccion(hecho)
  const n = rs.length
  const provs = [...new Set(rs.map((r) => r.proveedor_nombre).filter(Boolean))]
  return (
    <div className="cxc-cosa">
      <div className="cxc-cosa-texto">
        <span className="cxc-cosa-frase">{n === 1 ? 'Una recepción se confirmó' : `${n} recepciones se confirmaron`} antes de que Folvy mirara cada papel: no sé si {n === 1 ? 'espera' : 'esperan'} factura, si ya la {n === 1 ? 'trajo' : 'trajeron'} o si {n === 1 ? 'es' : 'son'} del socio.</span>
        <span className="cxc-cosa-apoyo">{[provs.length === 1 ? provs[0] : `${provs.length} proveedores`, rangoFechas(rs.map((r) => r.fecha))].join(' · ')}</span>
        <span className="cxc-cosa-porque">Leo su papel y su ficha, y cada una va a su sitio; lo que no se pueda decidir solo, vuelve aquí como pregunta.</span>
        <details className="cxc-papeles">
          <summary>Ver {n === 1 ? 'la recepción' : `las ${n} recepciones`}</summary>
          <ul>{rs.map((r) => (
            <li key={r.recepcion}>
              <span>{[r.proveedor_nombre, diaConNombre(r.fecha), r.local_nombre].filter(Boolean).join(' · ')} <span className="cxc-cosa-codigo">{r.codigo}</span></span>
              <VerPapel recepcion={r.recepcion} titulo={`${r.proveedor_nombre ?? 'Papel'} · ${diaConNombre(r.fecha)}`} />
            </li>
          ))}</ul>
        </details>
        {fallo && <span className="cx-error" role="alert">{fallo}</span>}
      </div>
      <div className="cxc-cosa-acciones">
        <button type="button" className="cx-boton" disabled={ocupado} onClick={() => void hacer(async () => {
          const cuenta = new Map<string, number>()
          for (const r of rs) {
            const c = (await rehacerCamino(r.recepcion))?.camino ?? 'sin_decidir'
            cuenta.set(c, (cuenta.get(c) ?? 0) + 1)
          }
          const nombre: Record<string, [string, string]> = {
            factura: ['con su factura registrada', 'con su factura registrada'], pendiente_factura: ['espera factura', 'esperan factura'],
            liquidacion: ['va a la liquidación del socio', 'van a la liquidación del socio'], a_nombre_de_otro: ['va a nombre de otro', 'van a nombre de otro'],
            sin_decidir: ['tiene una pregunta', 'tienen una pregunta'],
          }
          const partes = [...cuenta.entries()].map(([c, k]) => `${k} ${(nombre[c] ?? [c, c])[k === 1 ? 0 : 1]}`)
          return `Mirados ${papeles(n)}: ${partes.join(', ')}.`
        })}>Mirar {n === 1 ? 'su papel' : `sus ${n} papeles`} ahora</button>
      </div>
    </div>
  )
}

export function FilasAMirar({ filas, accountId, hecho, subir }: { filas: FilaAMirar[]; accountId: string; hecho: Hecho; subir: () => void }) {
  const { activa } = useEmpresas()
  return (
    <div className="cxc-mirar">
      {filas.map((f) => {
        switch (f.tipo) {
          case 'nombre': return <FilaNombre key={f.clave} f={f} accountId={accountId} hecho={hecho} />
          case 'liquida': return <FilaLiquida key={f.clave} f={f} hecho={hecho} />
          case 'sin_iva': return <FilaSinIva key={f.clave} f={f} empresaId={activa?.id ?? null} hecho={hecho} />
          case 'papel_ficha': return <FilaPapelFicha key={f.clave} f={f} hecho={hecho} />
          case 'ficha': return <FilaFicha key={f.clave} f={f} hecho={hecho} />
          case 'otra': return <FilaOtra key={f.clave} f={f} hecho={hecho} subir={subir} />
          case 'sin_camino': return <FilaSinCamino key={f.clave} rs={f.recepciones} hecho={hecho} />
        }
      })}
    </div>
  )
}
