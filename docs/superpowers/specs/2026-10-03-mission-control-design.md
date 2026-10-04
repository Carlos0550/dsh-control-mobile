# Mission Control — Diseño

- **Fecha:** 2026-10-03
- **Estado:** aprobado en brainstorming, pendiente de plan de implementación
- **Versión de DSH objetivo:** 0.2.0-rc.2 (checkout en `/home/carlos/Escritorio/deepseek-harness`)
- **Paquete:** `dsh-mission-control`
- **Idioma:** este spec va en español porque es el documento de trabajo del operador. El README público del paquete se escribirá en inglés, como el resto del ecosistema DSH.

---

## 1. Problema y objetivo

El harness queda corriendo en el equipo de casa, pero su interfaz solo es alcanzable desde esa máquina: `dsh web` escucha en `127.0.0.1` y rechaza `--host 0.0.0.0` de forma deliberada. Eso deja sin cubrir el caso de uso real: **supervisar y continuar el trabajo de los agentes desde el teléfono o desde otro equipo, sin estar delante del PC**.

Objetivo: una aplicación web propia —no una pestaña más del harness— que permita ver de un vistazo qué agentes corren, qué espera por el operador y cómo va cada uno, y desde la que se pueda escribir, delegar y desbloquear, con la misma naturalidad que en la interfaz local.

## 2. Alcance

### 2.1 Dentro

- **Tablero** de todas las sesiones del harness, con sus subagentes indentados, ordenado por urgencia y actividad.
- **Métricas vivas** por agente: tok/s, modelo, contexto restante, estado, última actividad.
- **Bandeja de atención**: aprobaciones pendientes, preguntas sin responder, errores.
- **Conversación**: leer el hilo y escribir en él, en una sesión existente o en una nueva.
- **Desbloquear**: aprobar, denegar, responder preguntas e interrumpir un agente.
- **Acceso remoto** mediante red privada, más el diagnóstico de ese acceso y un código QR para meter la sesión en el teléfono.

### 2.2 Fuera, y por qué

| Fuera | Motivo |
|---|---|
| Adjuntar archivos desde el móvil | El prompt solo admite adjuntos consumiendo recibos del servicio `fileUploads`; es una integración aparte. |
| Render rico de tool calls, diffs y adjuntos en la transcripción | La lectura profunda se queda en la GUI del harness. El cockpit da texto y filas de herramienta. |
| Edición de la cola de prompts | No lo pidió el operador y añade superficie de mutación. |
| Crear, renombrar o archivar workspaces | Igual: gestión, no supervisión. Se eligen de una lista existente. |
| Jobs en background, compactación, cambio de modelo | Fuera por YAGNI; se añaden si se echan en falta. |
| Notificaciones push | `dsh-notification` ya cubre el aviso de fin de turno en la GUI. Un aviso propio del cockpit queda como trabajo futuro. |
| Túnel rápido público sin dominio | La única barrera sería un bearer de 30 días delante de una capacidad de ejecución remota. Ver §10. |
| Multiusuario | Un solo operador. |

## 3. Decisiones tomadas, y qué se descartó

**D1 — Plugin externo, no un fork del repo.** `dsh web` rechaza `--host 0.0.0.0` a propósito (`packages/bundle/web-app/src/startup.ts`), el checkout está limpio en `master` sincronizado con origin, y la API de plugins ya cubre todo lo necesario. `dsh-notification`, instalado en `~/.dsh/profiles/web`, es el precedente que prueba el camino. *Descartado:* tocar `packages/bundle/web-app` y los paquetes de cliente.

**D2 — Superficie propia, fuera del shell del harness.** El shell solo renderiza el asiento `root`, y ese asiento lo ocupa `ui-layout` con su AppFrame de tres columnas (`packages/client/ui-layout/src/client/AppFrame.tsx`). Los asientos que un plugin de cliente puede tomar son `main`, `sidebar`, `rightbar` y `shell.overlay`. No existe un segundo shell sancionado, así que cualquier vista dentro del shell sería, por construcción, una pestaña del harness. *Descartado:* panel global en el asiento `main`; shell propio reutilizando el runtime del cliente (el asiento `root` es de ocupante único y el grafo de plugins es global por host).

**D3 — El backend vive dentro del proceso del harness.** No existe forma soportada de que un proceso externo se conecte a un harness ya corriendo: el SDK arranca su propio runtime. La alternativa —que el visualizador posea el harness vía SDK— obligaría a reimplementar el chat entero y dejaría fuera las sesiones que ya existen. *Descartado:* backend separado con SDK.

**D4 — Una sola identidad.** Todas las rutas propias se admiten con `ctx.connection.admit(request)`, reutilizando la cookie de sesión del harness. No se inventa autenticación nueva. Como consecuencia, los assets estáticos de la página son públicos igual que los del harness, y eso es aceptable: no hay nada secreto en el bundle.

**D5 — El control se ejerce como answerer del host.** `approval/request` y `user-questions/request` son waterfalls del host con answerers enchufables (`packages/interaction/user-approval/src/index.ts`), y sin answerer fallan en cerrado. El cockpit se registra como uno más, de modo que una petición pendiente llega al teléfono aunque no haya ningún navegador del harness abierto.

**D6 — El componente de acceso no implementa TLS ni autenticación.** Esa responsabilidad se delega en WireGuard (Tailscale) o en Cloudflare. Escribir seguridad propia delante de una capacidad de ejecución remota es exactamente lo que no se hace.

**D7 — Tablero y árbol son la misma pantalla.** Un subagente es una fila con un nivel más de indentación, no un objeto de segunda clase.

**D8 — Transcripción en burbujas**, con las filas de herramienta intercaladas. El contenedor queda aislado en un componente: pasar a estilo documento es cambiar un archivo, no refactorizar. Se acepta el coste de que las respuestas largas con código queden en columna angosta.

**D9 — Snapshot más deltas.** Carga inicial completa, deltas por SSE, y snapshot nuevo en cada reconexión. No se intenta llevar un log incremental perfecto en la página.

**D10 — Métricas en dos niveles.** Hechos baratos para todas las sesiones; métricas completas solo para las que corren o se movieron hace poco.

## 4. Arquitectura

```
┌─ proceso dsh ────────────────────────────────────────────────┐
│  harness (sesiones, agentes, subagentes, aprobaciones)       │
│      ▲                                                        │
│      │ ctx.sessionController · session/event · approval/*     │
│      ▼                                                        │
│  ┌─ dsh-mission-control · cara host ─────────────────────┐    │
│  │  gateway  rutas propias en ctx.webServer + admit()    │    │
│  │  fleet    snapshot agregado y métricas                │    │
│  │  live     session/event → deltas → SSE                │    │
│  │  actions  prompt · create · interrupt                 │    │
│  │  attention answerers de approval/question             │    │
│  │  access   diagnóstico de la exposición + QR de acceso │    │
│  └───────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
                          cookie de sesión existente
                                       │
                              ┌────────▼────────┐
                              │  página móvil   │  PWA propia, sin runtime DSH
                              └─────────────────┘
```

**La regla de frontera.** Todo el acoplamiento a servicios internos de DSH vive en `src/adapters/dsh.ts`. `fleet`, `live`, `actions` y `attention` hablan contra interfaces propias. Cuando el harness cambie algo, se rompe un archivo, no diez.

### 4.1 Estructura del paquete

```
dsh-mission-control/
├── package.json          # exports ".", campo dsh.bundle.patch
├── dsh.plugin.json       # entry: { name: 'dsh-mission-control', inject: [] }
├── cordis.patch.yml      # insert: [{ id: dsh-mission-control, name: dsh-mission-control }]
├── cordis.yml            # composición de desarrollo (config del plugin)
├── src/
│   ├── index.ts          # apply(): monta los componentes y declara el config
│   ├── adapters/dsh.ts   # ÚNICO módulo que toca servicios del harness
│   ├── gateway.ts        # rutas, admit(), SSE, estáticos de la página
│   ├── fleet.ts          # snapshot, métricas, dos niveles
│   ├── live.ts           # session/event → deltas → fan-out
│   ├── actions.ts        # prompt, create, interrupt
│   ├── attention.ts      # answerers y registro de peticiones pendientes
│   ├── access.ts         # diagnóstico de exposición y URL con token para el QR
│   └── types.ts          # AgentCard, AttentionItem, TranscriptEntry, FleetSnapshot, Delta
├── web/                  # app Vite de la página (móvil-primero)
│   ├── index.html
│   ├── manifest.webmanifest
│   └── src/
│       ├── views/{Board,Conversation,Attention,New}.tsx
│       └── components/{AgentRow,Bubble,ToolRow,Composer,AttentionCard,MetricStrip,Transcript}.tsx
├── tests/
├── build.mjs
└── README.md
```

## 5. Modelo de datos

```ts
type AgentState = 'idle' | 'running' | 'waiting-approval' | 'waiting-answer' | 'error'

interface AgentCard {
  sessionId: string
  parentSessionId?: string
  depth: number                       // 0 = sesión raíz
  kind: 'root' | 'subagent'
  title: string
  workspace: string
  model?: string
  state: AgentState
  metrics: {
    tokensPerSecond?: number
    context?: { used: number; window: number; percent: number }
    lastActivityAt: number
    turnStartedAt?: number
  }
  lastLine?: string                   // resumen de una línea del último evento con contenido
  promptable: boolean                 // false para hijos one-shot o no continuables
}

interface AttentionItem {
  id: string                          // correlación con la petición pendiente del host
  kind: 'approval' | 'question' | 'error'
  sessionId: string
  since: number
  summary: string
  detail?: {
    toolName?: string
    reason?: string
    questions?: { id: string; header?: string; question: string; options?: { label: string }[] }[]
  }
}

interface TranscriptEntry {
  seq: number
  kind: 'user' | 'assistant' | 'tool' | 'system' | 'error'
  text?: string                       // markdown sin renderizar
  tool?: { name: string; status: 'ok' | 'error' | 'running'; summary: string }
  at: number
  streaming?: boolean
}

interface FleetSnapshot {
  asOf: number
  agents: AgentCard[]
  attention: AttentionItem[]
  workspaces: string[]
  access: { mode: 'tailnet' | 'public' | 'loopback'; hostname?: string; declared: boolean }
}

type Delta =
  | { t: 'agent.upsert'; agent: AgentCard }
  | { t: 'agent.remove'; sessionId: string }
  | { t: 'attention.open'; item: AttentionItem }
  | { t: 'attention.close'; id: string }
  | { t: 'transcript.append'; sessionId: string; entry: TranscriptEntry }
  | { t: 'access'; access: FleetSnapshot['access'] }
  | { t: 'heartbeat'; at: number }
```

## 6. API del host

Todas las rutas cuelgan de `/mission` y pasan por `ctx.connection.admit(request)` antes de cualquier efecto. Sin cookie válida responden 401; con `Host`/`Origin` no confiable, 403.

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET /mission/` y `GET /mission/assets/*` | — | La página y sus estáticos |
| `GET /mission/api/fleet` | — | `FleetSnapshot` |
| `GET /mission/api/stream` | — | SSE de `Delta` |
| `GET /mission/api/sessions/:id/stream` | — | SSE: primero el snapshot del historial, después entradas nuevas y chunks del asistente en curso |
| `POST /mission/api/sessions` | `{ workspace, prompt }` | `{ sessionId }` |
| `POST /mission/api/sessions/:id/prompt` | `{ text }` | `{ accepted: true }` |
| `POST /mission/api/sessions/:id/interrupt` | — | `{ ok: true }` |
| `GET /mission/api/attention` | — | `AttentionItem[]` |
| `POST /mission/api/attention/:id/decision` | `{ outcome: 'allow' \| 'deny', answers? }` | `{ ok: true }` |
| `GET /mission/api/access` | — | `{ loginUrl, hostname, declared, tailscale }` — **solo responde a peticiones desde loopback** |
| `POST /mission/api/security/revoke` | — | `{ ok: true, restartRequired: true }` |

`GET /mission/api/access` devuelve la URL con el token de proceso para poder pintarla como QR. Se sirve únicamente si la dirección remota del socket es loopback y el `Host` también lo es, de modo que el token no sale de la máquina por esta vía.

## 7. Flujos

1. **Carga.** La página pide `fleet`, pinta el tablero y abre el SSE. A partir de ahí solo deltas.
2. **Vivo.** Cada append de una sesión dispara `session/event` en el host; el adaptador lo traduce a `agent.upsert` o `transcript.append` y `live` lo reparte.
3. **Abrir un agente.** La página abre `sessions/:id/stream`, que envuelve el `follow` del harness: el primer frame trae el historial y a partir de ahí llegan las entradas nuevas y los chunks del asistente en curso. Una sola fuente para historial y vivo, sin llevar dos contabilidades.
4. **Escribir.** En una sesión existente, `prompt`; en una nueva, `sessions` con workspace y primer prompt. En ambos casos el turno arranca y los deltas vuelven por el SSE.
5. **Desbloquear.** El host emite `approval/request`; el answerer del cockpit lo captura, publica `attention.open` con su id y **queda esperando**. La decisión llega por `attention/:id/decision` y vuelve al agente por el waterfall. Si nadie decide, no se decide: se aplica el fallo en cerrado del harness.
6. **Reconexión.** El SSE se reconecta con backoff y, al volver, la página pide `fleet` de nuevo y descarta lo que tenía. El `id` de cada `AttentionItem` es lo que permite no perder una petición pendiente ni duplicarla.

## 8. Procedencia de cada métrica

| Dato | Origen |
|---|---|
| tok/s | El stream temporal que el evento `assistant/message` guarda al cerrar el intento. Durante el streaming, tasa viva sobre una ventana deslizante de 5 segundos de deltas. |
| Modelo | La proyección de selección de modelo de la sesión, con `request/header` como respaldo. |
| Contexto restante | El medidor de tokens del host contra la ventana del modelo; la misma cuenta que hace el indicador de la GUI. |
| Estado | Los resúmenes de sesión traen `running` y disponibilidad de agente; `waiting-*` sale del registro de peticiones pendientes del cockpit. |
| Árbol | El registro de subagentes, que ya es un singleton con consulta cross-sesión. |

## 9. Interfaz

Cuatro vistas, móvil-primero, más los estados que siempre se olvidan.

- **Tablero.** Contadores por estado arriba, banner de atención si hay algo pendiente, y filas indentadas con punto de estado, nombre, tok/s y contexto. El orden es: primero lo que espera por ti, después lo que corre por actividad reciente, después el resto; los hijos siempre bajo su padre. Cabecera con "actualizado ahora".
- **Conversación.** Migas si es subagente (`‹ Refactor pagos / Migración BD`), tira de métricas (modelo, tok/s, barra de contexto), burbujas con filas de herramienta intercaladas, tarjeta de aprobación en línea donde ocurrió, y composer con botón de parar mientras corre.
- **Atención.** Lista de lo que espera, cada elemento resoluble sin salir de la vista.
- **Nuevo.** Lista de workspaces y primer prompt; reutiliza el composer.
- **Acceso** (solo desde el PC). Estado de la exposición y QR con la URL de login para meter la sesión en el teléfono.

**Estados:** vacío (sin sesiones, botón Nuevo), desconectado (banda superior, última foto en gris, reintento), sesión fría (esqueleto), error de agente (fila en rojo con motivo y reintento).

## 10. Exposición remota y seguridad

**Lo que hay que proteger.** La cookie de navegador del harness es un bearer de hasta 30 días, sin logout, y quien la tenga tiene ejecución de código en la máquina. Además la cookie no lleva `Secure` —el harness sirve por HTTP loopback y lo omite a propósito—, y los assets estáticos son públicos. Nada de esto se puede cambiar desde un plugin; se asume y se diseña alrededor.

**Modelo por defecto: red privada (Tailscale).** El PC y el teléfono entran en el mismo tailnet y se alcanza `https://<equipo>.<tailnet>.ts.net`, con certificado real. No hay superficie pública. El hostname es fijo, así que se declara una vez con `--trusted-host` y el fence de Host/Origin lo acepta.

**Alternativa documentada: Cloudflare Tunnel nombrado con Access.** Para cuando no se quiera instalar nada en el teléfono. El túnel sale del PC, no se abren puertos, y Access pone el segundo factor delante. Hostname fijo, también declarado con `--trusted-host`.

**Fuera de alcance: túnel rápido con hostname aleatorio.** Cambia en cada arranque, así que `--trusted-host` no sirve y haría falta un proxy propio que reescriba el `Host` a loopback. Eso deja el bearer de 30 días como única barrera delante de una capacidad de ejecución remota. Si algún día se implementa, será con su propio apartado de riesgos y etiquetado como modo de desarrollo.

**Primer acceso.** El token de proceso cambia en cada arranque, pero la cookie sobrevive a los reinicios mientras no caduque. Para meter la sesión en el teléfono sin teclear una URL de 70 caracteres, la vista **Acceso** —abierta desde el PC, que es la única que recibe el token— pinta un QR con la URL de login. Se escanea una vez cada 30 días, o cuando se borren las cookies.

**Revocación.** No hay logout. La palanca real es borrar el registro `client-connection/browser-session` de las credenciales y reiniciar el harness; el efecto completo requiere el reinicio porque la Connection activa sigue usando el secreto que cargó. La ruta de revocación borra el registro y responde `restartRequired: true`.

**Qué hace `access`, y qué no.** Diagnostica (¿está la malla arriba?, ¿está el hostname declarado en `trustedHosts`?, ¿responde?) y pinta el QR. **No arranca ni para Tailscale**, porque Tailscale es un servicio del sistema y no un proceso por sesión. La orquestación de `cloudflared` queda para cuando se implemente el modelo público. Esto es una simplificación respecto a lo hablado en el brainstorming, donde este componente arrancaba y paraba el proceso del túnel: menos código y menos superficie.

## 11. Pruebas

| Nivel | Qué cubre |
|---|---|
| Adaptador | Unitarias contra los servicios del host con dobles. Es donde vive el riesgo real. |
| Reductor de deltas | Eventos de sesión → `Delta`, contra un log grabado. |
| Rutas | Contrato de 401 sin cookie y 403 con autoridad no confiable. Se prueba que se llama a `admit`, no que `admit` funcione. |
| `access` | Que `GET /mission/api/access` responde 403 fuera de loopback. |
| Página | Componentes de fila, burbuja y composer. Sin e2e pesado en v1. |
| Smoke manual | Documentado: arrancar, abrir desde el móvil, aprobar, escribir. |

## 12. Entrega e instalación

- Paquete instalable en el perfil `web` como plugin, con `dsh.plugin.json`, `cordis.patch.yml` y build propio — el mismo camino que `dsh-notification`.
- `README.md` en inglés con: instalación, build de la página, y la exposición paso a paso con Tailscale (Cloudflare Tunnel como alternativa).
- Los comandos exactos de Tailscale se verifican contra la versión instalada al escribir el README. Este spec fija el mecanismo, no la sintaxis.

## 13. Riesgos y límites conocidos

1. **Deriva de servicios internos.** `ctx.sessionController`, el registro de subagentes y el medidor de tokens no son un contrato de extensión documentado como sí lo son los slots del cliente. Mitigación: un único módulo adaptador, y la versión de DSH contra la que se desarrolla anotada en el README.
2. **El ámbito del answerer es lo primero que hay que validar.** El waterfall se despacha contra el ámbito del agente. Si un registro raíz no recibe el despacho, el plan debe registrar por agente al crearse la sesión. Esto se prueba antes de construir nada encima.
3. **Coste de métricas con muchas sesiones.** Mitigado con los dos niveles de §D10; hay que medirlo con un centenar de sesiones antes de dar el tablero por bueno.
4. **La cookie sin `Secure`.** Limitación heredada. Se mitiga no exponiendo nunca por HTTP plano.
5. **Sin logout real.** La revocación exige reiniciar el harness. Está documentado y expuesto en el panel.
6. **El SSE detrás de un proxy.** Si el proxy bufferiza, los deltas llegan a ráfagas. Tailscale serve no debería; se verifica en el smoke.
7. **Una sola identidad compartida con la GUI.** Si el navegador del harness está abierto a la vez, ambos ven la misma aprobación y gana el primero que responda. Se acepta explícitamente.

## 14. Trabajo futuro

Notificaciones push propias del cockpit; adjuntos desde el móvil; render rico de tool calls y diffs; edición de la cola; gestión de workspaces; jobs en background; modelo público con túnel rápido y proxy reescritor, con su propio análisis de riesgos.
