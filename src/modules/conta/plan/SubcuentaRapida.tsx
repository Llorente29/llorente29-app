// src/modules/conta/plan/SubcuentaRapida.tsx
//
// X20 (21/11) · Crear una subcuenta como en ERP10: dos casillas en una línea (Código y Nombre) y «Añadir».
// Intro en el código pasa al nombre (si se escribió la raíz, deja escrita la siguiente libre, para aceptarla
// o cambiarla); Intro en el nombre guarda. Debajo, una sola frase: «Será la 43000006, bajo la 4300 · …»,
// «Ya existe: ábrela» o por qué no se puede (lib/subcuentaRapida). Al crearla, dice lo que ha hecho (regla 8)
// y, si es de un cliente, un proveedor o un banco, ofrece su ficha al lado: rellenarla o dejarla para luego.

import { useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { rutaMayor, rutaTablasGenerales, rutaTerceros } from '@/config/navegacion'
import { fichaDeSubcuenta, fraseCodigo, leerCodigo, type CuentaDelPlan, type SeriePlan } from '@/modules/conta/lib/subcuentaRapida'
import { anadirConCodigo } from '@/modules/conta/services/planService'

export type Creada = { id: string; code: string; name: string; hoja: string; hojaNombre: string }

const FICHAS = {
  cliente: { titulo: 'La ficha del cliente', texto: 'NIF, domicilio, cómo cobra y su cuenta de ingresos.', boton: 'Rellenar la ficha', ruta: () => rutaTerceros('clientes') },
  proveedor: { titulo: 'La ficha del proveedor o acreedor', texto: 'NIF, domicilio, IVA por defecto, su cuenta de gasto y cómo se le paga.', boton: 'Rellenar la ficha', ruta: () => rutaTerceros('proveedores') },
  banco: { titulo: 'La ficha del banco', texto: 'IBAN, la entidad y de dónde se leen sus movimientos.', boton: 'Rellenar la ficha', ruta: () => rutaTablasGenerales('bancos-y-cajas') },
} as const

export function SubcuentaRapida({ companyId, digitos, serie, cuentas, quien, alCrear, inicial = '', inicialNombre = '', enventana = false, foco = false }: {
  companyId: string; digitos: number; serie: readonly SeriePlan[]; cuentas: readonly CuentaDelPlan[]; quien: string | null
  alCrear: (c: Creada) => void
  /** Lo que ya estaba escrito (en un buscador: lo que no se ha encontrado). */
  inicial?: string
  /** El nombre ya escrito (en un buscador, si se buscó por nombre). */
  inicialNombre?: string
  /** Dentro de otra ventana (un buscador): sin la ficha al lado, para no salir de donde se está. */
  enventana?: boolean
  foco?: boolean
}) {
  const [codigo, setCodigo] = useState(inicial)
  const [nombre, setNombre] = useState(inicialNombre)
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [hecha, setHecha] = useState<Creada | null>(null)
  const [ficha, setFicha] = useState(true)
  const nombreRef = useRef<HTMLInputElement>(null)
  const lectura = leerCodigo(codigo, { digitos, serie, cuentas })
  const frase = fraseCodigo(lectura)
  const tono = lectura.tipo === 'nueva' ? 'bien' : lectura.tipo === 'vacio' ? null : 'mal'

  /** Si se escribió la raíz (o con punto), la deja escrita entera: la que se va a crear. */
  const escribirEntero = () => { if (lectura.tipo === 'nueva' && lectura.codigo !== codigo) setCodigo(lectura.codigo) }
  async function guardar() {
    if (guardando) return
    if (lectura.tipo !== 'nueva') { setFallo(frase ?? 'Escribe el código.'); return }
    if (!nombre.trim()) { setFallo('Ponle un nombre.'); nombreRef.current?.focus(); return }
    setGuardando(true); setFallo(null)
    try {
      const r = await anadirConCodigo(companyId, lectura.codigo, nombre.trim(), quien)
      const c: Creada = { id: r.id, code: r.code, name: nombre.trim(), hoja: r.hoja, hojaNombre: r.hoja_nombre }
      setHecha(c); setFicha(true); setCodigo(''); setNombre('')
      alCrear(c)
    } catch (e) {
      setFallo(e instanceof Error ? e.message : 'No se ha podido crear.')
    } finally { setGuardando(false) }
  }
  const teclas = (e: KeyboardEvent<HTMLInputElement>, en: 'codigo' | 'nombre') => {
    e.stopPropagation()
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (en === 'codigo') { escribirEntero(); nombreRef.current?.focus() } else void guardar()
  }
  const tipoFicha = hecha && !enventana ? fichaDeSubcuenta(hecha.code) : null
  return (
    <div className={`cx-subcuenta${tipoFicha && ficha ? ' cx-subcuenta-con-ficha' : ''}`}>
      <form className="cx-subcuenta-linea" aria-label="Añadir subcuenta" noValidate onSubmit={(e) => { e.preventDefault(); void guardar() }}>
        <label className="cx-subcuenta-casilla cx-subcuenta-codigo">
          <span>Código</span>
          <input className="cx-input cx-cifra" inputMode="decimal" autoComplete="off" value={codigo} autoFocus={foco} disabled={guardando}
            placeholder={`43000030, 430.30 o 430`} aria-describedby="cx-subcuenta-frase"
            onChange={(e) => { setCodigo(e.target.value); setFallo(null) }} onBlur={escribirEntero} onKeyDown={(e) => teclas(e, 'codigo')} />
        </label>
        <label className="cx-subcuenta-casilla cx-subcuenta-nombre">
          <span>Nombre</span>
          <input ref={nombreRef} className="cx-input" autoComplete="off" value={nombre} disabled={guardando}
            onChange={(e) => { setNombre(e.target.value); setFallo(null) }} onKeyDown={(e) => teclas(e, 'nombre')} />
        </label>
        <button type="submit" className="cx-boton" disabled={guardando}>{guardando ? 'Añadiendo…' : 'Añadir'}</button>
      </form>
      <p id="cx-subcuenta-frase" className="cx-subcuenta-frase" data-tono={fallo ? 'mal' : tono ?? undefined} role="status">
        {fallo ?? frase}
        {!fallo && lectura.tipo === 'existe' && <> <Link className="cx-enlace" to={rutaMayor(lectura.codigo)}>Ábrela</Link></>}
        {!fallo && !frase && hecha && <>Creada la <span className="cx-cifra">{hecha.code}</span> · {hecha.name}, bajo la {hecha.hoja} · {hecha.hojaNombre}.</>}
      </p>
      {tipoFicha && ficha && (
        <aside className="cx-subcuenta-ficha" aria-label={FICHAS[tipoFicha].titulo}>
          <strong>{FICHAS[tipoFicha].titulo}</strong>
          <p>{hecha!.code} · {hecha!.name}: {FICHAS[tipoFicha].texto}</p>
          <div className="cx-subcuenta-ficha-botones">
            <Link className="cx-boton-sec" to={FICHAS[tipoFicha].ruta()}>{FICHAS[tipoFicha].boton}</Link>
            <button type="button" className="cx-enlace" onClick={() => setFicha(false)}>Luego</button>
          </div>
        </aside>
      )}
    </div>
  )
}
