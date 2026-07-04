# Teletipo JISR Global Personal - Automatizacion

## Que es cada pieza

| Pieza | Archivo | Funcion |
|---|---|---|
| Datos publicados | `jisr-indices-global-personal.json` | Es el archivo que lee el HTML de Carrd. |
| Criterios del agente | `jisr-agent-config.json` | Define indices, senales, fuentes y acciones JISR. |
| Perfil personal | `jisr-personal-profile.json` | Foto de vida, ubicacion, presion personal y ventaja estrategica. |
| Agente | `scripts/update-jisr-indices.mjs` | Lee fuentes abiertas, aplica reglas y reescribe el JSON. |
| Reloj | `.github/workflows/update-jisr-global.yml` | Ejecuta el agente cada dia a las 8:00 en Europe/Madrid. |
| Visualizacion | `teletipo-jisr-global-personal.html` | Muestra el JSON en Carrd. |

## Flujo

```text
Fuentes abiertas
  + perfil personal JISR
  -> scripts/update-jisr-indices.mjs
  -> jisr-indices-global-personal.json
  -> GitHub Pages
  -> Carrd
```

## Primera version

Esta version no necesita claves privadas ni API de pago. Usa fuentes abiertas consultadas desde el propio GitHub Action y una puntuacion basada en reglas.

La automatizacion tiene tambien `workflow_dispatch`, asi que se puede ejecutar manualmente desde la pestaña Actions de GitHub cuando quieras probarla sin esperar a las 8:00.

## Como activarlo

1. Sube estos archivos al repositorio de GitHub Pages del teletipo JISR Global Personal.
2. Comprueba que GitHub Pages publica `jisr-indices-global-personal.json`.
3. En GitHub, entra en `Settings -> Actions -> General`.
4. Verifica que los workflows pueden escribir en el repositorio.
5. Entra en `Actions -> Actualizar Teletipo JISR Global Personal`.
6. Pulsa `Run workflow` para probar la primera ejecucion manual.
7. Si el JSON cambia y se publica, Carrd lo mostrara al cargar o refrescar.

## Ajustes futuros

- Añadir una segunda ejecucion a las 20:00.
- Añadir fuentes de pago.
- Añadir una capa de IA mediante una clave privada guardada como secreto de GitHub.
- Separar informe de mañana y cierre de jornada.
- Guardar historico diario en otro JSON.
