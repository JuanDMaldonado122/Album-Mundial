# Album Mundial 2026

App web para llevar un album familiar del Mundial 2026, marcar laminas, ver repetidas, buscar canjes con amigos y compartir listas.

## Como ejecutar localmente

Desde la carpeta del proyecto:

```powershell
python -m http.server 5180
```

Luego abre:

```text
http://localhost:5180/index.html
```

Si el puerto esta ocupado, usa otro:

```powershell
python -m http.server 5183
```

## Flujo de trabajo recomendado

Trabajen siempre sobre la rama de refactor:

```powershell
git checkout refactor-estructura
git pull origin refactor-estructura
```

Despues de probar cambios:

```powershell
git status
git add .
git commit -m "Mensaje corto del cambio"
git push origin refactor-estructura
```

Por ahora no mezclen a `master` hasta que el equipo valide la app completa.

## Estructura principal

- `index.html`: pantallas principales de la app.
- `register.html`: pantalla de registro.
- `css/`: estilos.
- `js/app.js`: coordinador general de la app.
- `js/data/`: datos base del album.
- `js/services/`: Firebase, autenticacion, album, amigos y actividad.
- `js/features/`: funciones especiales como PDF, scanner, canjes, paquetes e imagen compartible.
- `js/ui/`: renderizado de vistas y paneles.
- `assets/images/`: iconos y logos.
- `database.rules.json`: reglas de Firebase Realtime Database.

## Funciones actuales

- Login y registro con Firebase Authentication.
- Album sincronizado por usuario en Firebase Realtime Database.
- Conteo de laminas unicas, repetidas y porcentaje.
- Vista por equipos y resumen de tengo/repetidas/faltantes.
- Intercambio manual.
- Amigos por correo y sugerencias de canje.
- Ranking del grupo.
- Panel Pro con actividad y progreso.
- Agregar paquete pegando varios codigos.
- Compartir repetidas por WhatsApp.
- Exportar PDFs.
- Generar imagen de progreso.
- Scanner OCR con confirmacion antes de guardar.

## Antes de subir cambios importantes

Ejecuta la lista de pruebas de `QA.md`. Si algo falla, arreglenlo en `refactor-estructura` antes de abrir PR o mezclar a `master`.
