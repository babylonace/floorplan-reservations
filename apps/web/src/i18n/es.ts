import type { DeepPartial } from "./i18n";
import type { Messages, TableDescription } from "./en";

/** Spanish: the language staff see first. A test checks that it leaves nothing out. */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const es: DeepPartial<Messages> = {
  app: {
    name: "Plano de sala",
    loading: "Cargando…",
  },
  language: {
    label: "Idioma",
  },
  login: {
    title: "Plano de sala",
    email: "Correo electrónico",
    password: "Contraseña",
    submit: "Entrar",
    submitting: "Entrando…",
    wrong: "El correo y la contraseña no coinciden.",
    locked: "Demasiados intentos con este correo. Espera 15 minutos y vuelve a probar.",
    sessionEndedTitle: "Vuelve a entrar",
    sessionEnded:
      "Tu sesión ha terminado. Vuelve a entrar para seguir: lo que no habías guardado sigue en el plano.",
  },
  header: {
    venue: "Local",
    signedInAs: (email: string) => `Has entrado como ${email}`,
    signOut: "Cerrar sesión",
  },
  venues: {
    none: "Tu cuenta todavía no lleva ningún local. Pide a la persona propietaria que te dé acceso.",
    loadingPlan: "Cargando el plano…",
    loadFailed: "No se pudo cargar el plano.",
    retry: "Volver a probar",
    readOnly: "Solo lectura: los cambios los hace la persona propietaria.",
  },
  zones: {
    listLabel: "Zonas",
    add: "Nueva zona",
    none: "Aún no hay zonas. Crea la primera.",
    noneReadOnly: "Este local todavía no tiene zonas.",
    newTitle: "Nueva zona",
    name: "Nombre",
    width: "Ancho (m)",
    height: "Fondo (m)",
    sizeHint: "En metros; con decimales, como 4,5.",
    sortOrder: "Orden en la lista",
    sortOrderHint: "Las zonas con números más bajos salen antes.",
    create: "Crear zona",
    creating: "Creando…",
    created: (name: string) => `Zona «${name}» creada.`,
    panelTitle: "Esta zona",
    save: "Guardar zona",
    saving: "Guardando…",
    saved: (name: string) => `Zona «${name}» guardada.`,
    remove: "Borrar zona",
    removeTitle: (name: string) => `¿Borrar la zona «${name}»?`,
    removeBody:
      "Se borran también sus mesas. Las mesas que tuvieron reservas se guardan en el historial. No se puede deshacer.",
    removed: (name: string) => `Zona «${name}» borrada.`,
    tablesCount: (n: number) => plural(n, "1 mesa", `${String(n)} mesas`),
  },
  tables: {
    addRect: "Añadir mesa rectangular",
    addRound: "Añadir mesa redonda",
    addRectShort: "Rectangular",
    addRoundShort: "Redonda",
    addBar: "Añadir tramo de barra",
    addBarShort: "Barra",
    barPrefix: "B",
    panelTitle: (label: string) => `Mesa ${label}`,
    label: "Nombre o número",
    labelRequired: "Ponle un nombre o un número.",
    shape: "Forma",
    rect: "Rectangular",
    round: "Redonda",
    guests: "Personas",
    minSeats: "Mínimo",
    maxSeats: "Máximo",
    width: "Ancho (m)",
    height: "Fondo (m)",
    rotation: "Giro (grados)",
    position: "Posición (m)",
    x: "Desde la izquierda",
    y: "Desde arriba",
    seats: "Asientos",
    seatsAround: "Alrededor",
    seatsSides: "En algunos lados",
    sides: { top: "Arriba", right: "Derecha", bottom: "Abajo", left: "Izquierda" },
    sidesLegend: "Lados con asientos",
    sidesHint: "Lados de la mesa sin girar. Las mesas nunca se juntan por un lado con asientos.",
    barHint: "Tramo de barra: un grupo ocupa varios tramos seguidos, en línea.",
    bookable: "Se puede reservar por internet",
    bookableHint:
      "Si la desmarcas, la mesa sigue en el plano pero no se ofrece en las reservas por internet.",
    color: "Color",
    colors: {
      linen: "Lino",
      oak: "Roble",
      walnut: "Nogal",
      sage: "Salvia",
      slate: "Pizarra",
    },
    remove: "Quitar mesa",
    newBadge: "Nueva",
  },
  plan: {
    label: (zone: string, width: string, depth: string) =>
      `Plano de ${zone}, de ${width} de ancho y ${depth} de fondo`,
    help: "Tab pasa de una mesa a otra. Las flechas mueven la mesa elegida 5 cm, o 50 cm con Mayús. R la gira 15 grados y Mayús+R al otro lado. Supr la quita. Esc la suelta.",
    helpReadOnly: "Tab pasa de una mesa a otra.",
    empty: "Zona vacía. Añade una mesa con los botones de arriba.",
    emptyReadOnly: "Esta zona todavía no tiene mesas.",
    seats: (min: number, max: number) =>
      min === max ? String(min) : `${String(min)}–${String(max)}`,
    tableName: (d: TableDescription) =>
      [
        `Mesa ${d.label}`,
        d.round ? "redonda" : "rectangular",
        d.minSeats === d.maxSeats
          ? `para ${String(d.maxSeats)}`
          : `de ${String(d.minSeats)} a ${String(d.maxSeats)} personas`,
        `a ${d.x} de la izquierda y ${d.y} de arriba`,
        d.rotation === 0 ? "" : `girada ${String(d.rotation)} grados`,
        d.seatedSides === null
          ? ""
          : d.seatedSides === 1
            ? "asientos en un solo lado"
            : `asientos en ${String(d.seatedSides)} lados`,
        d.bookable ? "" : "no se reserva por internet",
        d.problems === 0 ? "" : plural(d.problems, "1 problema", `${String(d.problems)} problemas`),
      ]
        .filter(Boolean)
        .join(", "),
    toolbar: "Herramientas del plano",
    shortcutsTitle: "Atajos de teclado",
    shortcuts: [
      ["Tab", "siguiente mesa"],
      ["Flechas", "mover 5 cm"],
      ["Mayús + flechas", "mover 50 cm"],
      ["R / Mayús + R", "girar 15°"],
      ["Supr", "quitar la mesa"],
      ["Esc", "soltar"],
      ["Alt al arrastrar", "colocar libre, sin la cuadrícula de 5 cm"],
    ],
  },
  issues: {
    title: "Problemas en el plano",
    noneShort: "Sin problemas",
    count: (n: number) => plural(n, "1 problema", `${String(n)} problemas`),
    overlap: (a: string, b: string) => `Las mesas ${a} y ${b} se pisan.`,
    outside: (a: string) => `La mesa ${a} se sale de la zona.`,
    seats: (a: string) =>
      `La mesa ${a} tiene un número de personas imposible: el mínimo tiene que ser 1 o más y no pasar del máximo.`,
    show: (a: string) => `Ver la mesa ${a}`,
  },
  save: {
    unsaved: (n: number) => plural(n, "1 cambio sin guardar", `${String(n)} cambios sin guardar`),
    allSaved: "Todo guardado",
    needsLabels: "Todas las mesas necesitan un nombre o un número para guardar.",
    save: "Guardar cambios",
    saveShort: "Guardar",
    saving: "Guardando…",
    discard: "Descartar cambios",
    discardShort: "Descartar",
    saved: (n: number) => plural(n, "Cambio guardado.", `${String(n)} cambios guardados.`),
    partial: (saved: number, failed: number) =>
      `${plural(saved, "Se guardó 1 cambio", `Se guardaron ${String(saved)} cambios`)}; ${plural(failed, "1 no se pudo guardar", `${String(failed)} no se pudieron guardar`)}. Siguen en el plano para que los arregles y vuelvas a guardar.`,
    noneSaved: (failed: number) =>
      plural(
        failed,
        "El cambio no se guardó.",
        `No se guardó ninguno de los ${String(failed)} cambios.`,
      ),
    failedFor: (label: string, reason: string) => `Mesa ${label}: ${reason}`,
    stopped: "El guardado se paró antes de acabar. Lo que no se envió sigue en el plano.",
    discardTitle: "¿Descartar los cambios sin guardar?",
    discardBody: (n: number, zone: string) =>
      `${plural(n, "Hay 1 cambio", `Hay ${String(n)} cambios`)} sin guardar en «${zone}». Si sigues, se ${plural(n, "pierde", "pierden")}.`,
    keepEditing: "Seguir editando",
    confirmDiscard: "Descartar cambios",
  },
  announce: {
    moved: (label: string, x: string, y: string) => `Mesa ${label} en ${x}, ${y}.`,
    rotated: (label: string, degrees: number) => `Mesa ${label} girada ${String(degrees)} grados.`,
    resized: (label: string, width: string, depth: string) =>
      `La mesa ${label} mide ahora ${width} por ${depth}.`,
    removed: (label: string) => `Mesa ${label} quitada. Guarda para que sea definitivo.`,
    added: (label: string) => `Mesa ${label} añadida.`,
    addedInLine: (label: string, after: string) => `Tramo de barra ${label} añadido tras ${after}.`,
  },
  errors: {
    network: "No se puede contactar con el servidor. Revisa la conexión y vuelve a probar.",
    signedOut: "Tu sesión ha terminado. Vuelve a entrar.",
    forbidden: "Tu cuenta no puede cambiar este local.",
    tooMany: "Demasiadas peticiones seguidas. Espera un momento y vuelve a probar.",
    busy: "El servidor está muy ocupado. Vuelve a probar en unos segundos.",
    server:
      "Algo ha fallado en el servidor. Vuelve a probar; si se repite, avisa a quien mantiene la aplicación.",
    notFound: "Ya no existe; puede que alguien la haya borrado. El plano se ha vuelto a cargar.",
    duplicateLabel: "ya hay otra mesa con ese nombre en esta zona.",
    duplicateZone: "Ya hay una zona con ese nombre.",
    limit: "Es el máximo permitido: 50 zonas por local y 200 mesas por zona.",
    tableHasReservations: (n: number) =>
      `tiene ${plural(n, "una reserva próxima", `${String(n)} reservas próximas`)}. ${plural(n, "Muévela o cancélala", "Muévelas o cancélalas")} antes, o desmarca «Se puede reservar por internet».`,
    zoneHasReservations: (n: number) =>
      `Las mesas de esta zona tienen ${plural(n, "una reserva próxima", `${String(n)} reservas próximas`)}. ${plural(n, "Muévela o cancélala", "Muévelas o cancélalas")} antes de borrar la zona.`,
    noRoom: (n: number) =>
      `con este cambio, ${plural(n, "una reserva próxima se quedaría", `${String(n)} reservas próximas se quedarían`)} sin sitio. ${plural(n, "Muévela o cancélala", "Muévelas o cancélalas")} antes.`,
    changed: "cambió mientras se guardaba. Vuelve a probar.",
    planInvalid: "el plano quedaría con problemas:",
    zoneInvalid: "La zona no puede ser tan pequeña, porque:",
    rejected: "el servidor no aceptó uno de los datos. Revisa los campos y vuelve a probar.",
    dismiss: "Cerrar aviso",
    metres: (min: string, max: string) => `Entre ${min} y ${max}.`,
  },
  dialog: {
    cancel: "Cancelar",
  },
};
