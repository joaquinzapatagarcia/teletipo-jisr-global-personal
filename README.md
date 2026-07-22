# TELETIPO GLOBAL PERSONAL INDEXES

Cuadro de mando JISR que transforma señales abiertas del mundo en diez índices de apoyo al criterio personal, familiar y profesional.

No utiliza IA automática. GDELT aporta señales informativas y Twelve Data puede aportar, mediante secreto, un pulso de mercado independiente:

```text
GDELT + Twelve Data → reglas transparentes → validación → JSON + archivo → interfaces
```

## Estado operativo

- Ediciones previstas: **08:07 y 20:07**, zona `Europe/Madrid`.
- GitHub Actions puede iniciar una ejecución con algunos minutos de retraso.
- Si no existen datos nuevos verificables, la edición se conserva y el widget lo declara.
- El repositorio público no contiene el perfil personal detallado.
- Las cifras son soporte de criterio, no datos financieros ni recomendaciones.

## Estructura

| Ruta | Función |
|---|---|
| `config/indices.json` | Índices, consultas, palabras y reglas. |
| `config/personal-position.public.json` | Únicamente bases públicas de IPP/IVE. |
| `scripts/update-indices.mjs` | Ejecuta cuatro consultas maestras con reintentos/caché, calcula, archiva y consulta mercado en modo sombra. |
| `scripts/validate-output.mjs` | Comprueba integridad, rangos y ausencia de campos privados. |
| `public/data/latest.json` | Última lectura que consume Carrd. |
| `public/data/history-index.json` | Índice progresivo de ediciones y cobertura 7/30/90. |
| `public/data/archive/` | Fotografías permanentes de ediciones válidas. |
| `public/data/operations/` | Registro de todas las ejecuciones, incluidos fallos. |
| `public/data/market-latest.json` | Pulso de mercado separado de los índices JISR. |
| `public/jisr-widget.js` | Visualización canónica. |
| `public/carrd-loader.html` | Código recomendado para incrustar en Carrd. |
| `tests/` | Pruebas de consultas, puntuación y salida. |
| `docs/` | Arquitectura, metodología, seguridad y cambios. |

`jisr-widget.js` en la raíz es solo un puente para el Carrd instalado antes de esta reorganización.

## Comandos

```bash
npm test
npm run validate
npm run update
```

Para probar sin consultar GDELT:

```bash
JISR_OFFLINE=1 JISR_DRY_RUN=1 npm run update
```

## Privacidad

La salida pública contiene solo valores y resúmenes inocuos. Un perfil privado futuro debe mantenerse fuera de Git o suministrarse mediante un secreto del repositorio. La eliminación del archivo antiguo de la rama actual no lo borra del historial: véase `docs/SECURITY.md`.

## Archivo y mercado

Cada lectura válida se archiva por año, mes y franja. El histórico publica desde el primer día la cobertura disponible de 7, 30 y 90 jornadas. Los intentos fallidos se conservan aparte y nunca se hacen pasar por una edición nueva.

Si existe el secreto `TWELVE_DATA_API_KEY`, el motor escribe cotizaciones en `market-latest.json` bajo `modo_sombra`: informa, pero no modifica IGP, IEG, IECv, ICSL, IMF, ICSP, ICS, ISFL, IPP ni IVE. Si falta la clave, declara `canal_en_preparacion`.

## Carrd

El código canónico está en `public/carrd-loader.html`. El cargador anterior seguirá funcionando mediante el puente raíz, por lo que la integración no exige un cambio inmediato en Carrd.
