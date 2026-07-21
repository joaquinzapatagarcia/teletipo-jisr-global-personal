# Arquitectura

## Flujo

1. El workflow inicia una edición a las 08:07 o 20:07, hora de Madrid.
2. El agente lee la configuración y la posición pública mínima.
3. Realiza una consulta por índice, secuencialmente y con pausa entre peticiones.
4. Deduplica artículos y separa señal, dirección y confianza.
5. Conserva la edición anterior si no hay datos verificables.
6. Valida los diez índices, los rangos y la privacidad.
7. Publica `public/data/latest.json` para el widget.

## Contratos públicos

- Widget: `/public/jisr-widget.js`
- Datos: `/public/data/latest.json`
- Esquema: `/public/data/schema.json`
- Compatibilidad Carrd antigua: `/jisr-widget.js`

El código fuente canónico existe una sola vez. El archivo raíz no contiene lógica de visualización: únicamente carga la versión pública actual.
