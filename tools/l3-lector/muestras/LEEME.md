# Las fotos NO están aquí, y es a propósito

Las 8 fotos del banco llevan impreso el **nombre de pila de clientes reales**
(Jerome, Álvaro, Ángela, Samy, Virginia, Almudena, Lee, Martina). Son datos
personales, así que no viven en el repositorio.

**Estuvieron aquí por un error mío** (commit `531322d7`, 04/09). Se sacaron del
historial de git —no sólo del último commit— reescribiendo la rama y forzando el
push. `main` nunca las tuvo.

⚠️ **Force-push no garantiza que GitHub las haya borrado ya.** Los objetos
quedan inalcanzables desde cualquier rama, pero GitHub los conserva accesibles
por SHA directo hasta que pasa su recolector. Si eso importa, hay que pedírselo
a soporte de GitHub. Lo digo porque «lo quité del historial» suena a más de lo
que un force-push hace por sí solo.

## Cómo recuperarlas para correr el banco

Están en el bucket **privado** `l3-muestras`. Con una service-role key:

```bash
cd tools/l3-lector/muestras
for f in $(cut -c67- muestras.sha256); do
  curl -sS -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    "https://xzmpnchlguibclvxyynt.supabase.co/storage/v1/object/l3-muestras/$f" -o "$f"
done
sha256sum -c muestras.sha256
```

## ⚠️ Pendiente: SUBIRLAS

**El bucket está creado y vacío.** Esta sesión no pudo subirlas: el proxy de red
bloquea `*.supabase.co` (comprobado: `connect_rejected` del gateway), así que no
hay forma de hablar con Storage desde aquí. Las tiene Julio, que es de donde
salieron. Subida:

```bash
for f in *.png *.jpg; do
  curl -sS -X POST -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: $(file -b --mime-type $f)" --data-binary "@$f" \
    "https://xzmpnchlguibclvxyynt.supabase.co/storage/v1/object/l3-muestras/$f"
done
```

`muestras.sha256` está en el repositorio a propósito: una suma no es un dato
personal, y sirve para comprobar que lo que se descarga es exactamente lo que se
midió en `docs/L3a_lector_medido_20260904.md`.
