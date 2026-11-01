# λ deck

Mod para Claude Code que añade paneles tipo IDE junto a la conversación, con el estilo del diseño «LLM TUI» (acento `#d7875f`, teal `#4fb3b3`, bordes redondeados y cabeceras `─ título ───`).

## Instalar

En una sesión de Claude Code (terminal):

```
/plugin install lambda-deck --marketplace LuisDev-hub/lambda-deck
```

Responde `y` para añadir el marketplace y elige el alcance (usuario). Desde un shell: `claude plugin install lambda-deck --marketplace LuisDev-hub/lambda-deck`.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `/info` | Panel con modelo, carpeta, rama, coste, contexto, límites, turnos y actividad de herramientas. También abre solo al iniciar la sesión si la terminal mide 110 columnas o más. |
| `/model` | Selector de modelo (atajos 1-8). Con argumentos (`/model opus`) funciona como siempre. La lista está en `MODELS`, al inicio de `hooks/register.tsx`. |
| `/effort` | Selector de esfuerzo (low, medium, high, xhigh, max; atajos 1-5). Con argumentos funciona como siempre. |
| `/chats` | Conversaciones previas de este proyecto. Enter retoma la elegida con `/resume`. |
| `/file [ruta]` | Explorador de archivos y carpetas; elegir uno pega su ruta en el prompt. |
| `/ayuda` | Lista de comandos y atajos; Enter sobre un comando lo ejecuta. |

En los paneles: Tab/Enter navegan, Esc cierra y `ctrl+x tab` cambia entre paneles abiertos.

## Requisitos y límites

- Claude Code con soporte de mods (hooks de función).
- `python3` para listar las conversaciones guardadas de `/chats`.
- El panel de modelos y esfuerzo intercepta `/model` y `/effort` solo cuando se escriben sin argumentos.
- El nivel de esfuerzo marcado en `/effort` es el último elegido desde el panel; el motor no expone el actual.

## Desarrollo

```
claude --plugin-dir /ruta/a/lambda-deck
```

Licencia MIT.
