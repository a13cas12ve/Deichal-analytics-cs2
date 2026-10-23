/* Deichal Analytics — idioma de la interfaz (es / en).
   Los textos fijos se traducen por coincidencia exacta del nodo de texto (diccionario I18N).
   Al cambiar de idioma se recarga la página: los textos generados en JS se vuelven a pintar ya traducidos. */
const I18N_EN = {
  // cabecera y navegación
  "Jugadores": "Players", "Equipo": "Team", "Partidas": "Matches", "Reproductor": "Replay", "Demos": "Demos",
  "Metodología": "Methodology", "Apoyar el proyecto": "Support the project", "♥ Apoyar": "♥ Support",
  "Mapa": "Map", "Bando": "Side", "Global": "All", "Todas": "All", "Todos": "All", "Ambos": "Both",
  "Ko-fi": "Ko-fi", "Lado T": "T side", "Lado CT": "CT side",
  // pop-up de apoyo
  "Apoya el proyecto": "Support the project",
  "¿Te está sirviendo la herramienta?": "Is this tool useful to you?",
  "Esta herramienta es gratuita y sigue creciendo. Si te está siendo útil, puedes invitarme a un café en Ko-fi; y si no, seguirme en mis redes ayuda igual a seguir mejorándola.":
    "This tool is free and keeps growing. If it is useful to you, you can buy me a coffee on Ko-fi; if not, following me on social media helps too.",
  "Continuar a la herramienta": "Continue to the tool",
  "Invítame a un café": "Buy me a coffee", "Apoyar ↗": "Support ↗", "Seguir ↗": "Follow ↗",
  "Documentación": "Documentation",
  // filtros
  "Equipo ": "Team ", "Partidas ": "Matches ", "Todas ": "All ", "Mapa ": "Map ", "Bando ": "Side ",
  "Comparar con media del equipo": "Compare with team average",
  "Superponer media por rol:": "Overlay average by role:",
  // títulos de tarjetas
  "Perfil": "Profile", "estilo HLTV": "HLTV style",
  "Métricas clave": "Key metrics", "Score de potencia por mapa": "Power score by map",
  "Impacto según momento de la ronda": "Impact by round moment", "Swing ronda a ronda": "Swing round by round",
  "Mapa de calor": "Heatmap", "Comparativa por bando": "Side comparison", "Clutches": "Clutches",
  "Armas (kills)": "Weapons (kills)", "Rendimiento por mapa": "Performance by map",
  "Perfil medio del equipo": "Team average profile", "Resumen": "Summary", "Resumen estilo HLTV": "Summary HLTV style",
  "Medias transversales por rol": "Average by role", "Win% de ronda por situación": "Round win% by situation",
  "Sitios de plant": "Plant sites", "Pool de mapas": "Map pool", "Economía": "Economy",
  "Cómo se ganan y se pierden las rondas": "How rounds are won and lost", "Evolución por partida": "Trend by match",
  "Utilidad y supervivencia": "Utility and survival", "Mapa de utilidad": "Utility map",
  "Importar demos": "Import demos", "Procesado": "Processing", "Partidas cargadas": "Loaded matches",
  "Archivos en demos/raw": "Files in demos/raw", "Rendimiento por economía": "Performance by economy",
  "Zonas del mapa": "Map zones", "Marcador por partes": "Score by halves", "Economía por ronda": "Economy by round",
  "Rondas": "Rounds", "Multikills": "Multikills", "Clutches ganados": "Clutches won",
  "Cómo se ganaron las rondas": "How rounds were won", "Armas": "Weapons",
  "Perfil de jugador": "Player profile", "Vista de equipo": "Team view", "Biblioteca": "Library",
  "Resumen de partida": "Match summary", "Análisis de demos CS2 · Gratis": "CS2 demo analysis · Free",
  // etiquetas de KPI
  "Rating 2.0*": "Rating 2.0*", "KAST": "KAST", "ADR": "ADR", "K/D": "K/D", "KPR": "KPR", "DPR": "DPR",
  "Impact": "Impact", "HS%": "HS%", "Supervivencia": "Survival", "Opening": "Opening", "Trade kills/ronda": "Trade kills/round",
  "Muertes tradeadas": "Traded deaths", "Clutches ganados": "Clutches won", "% Clutch guardado": "% Clutch saved",
  "Util dmg/ronda": "Util dmg/round", "Cegados/ronda": "Flashed/round", "Rondas con kill": "Rounds with a kill",
  "Multi-kills": "Multi-kills", "Impacto neto": "Net impact", "Score potencia": "Power score",
  "Round swing": "Round swing", "Swing kills": "Swing kills", "Swing muertes": "Swing deaths",
  "Swing rondas ganadas": "Swing in won rounds", "Swing rondas perdidas": "Swing in lost rounds", "Swing bruto": "Raw swing",
  "Vida perdida": "Health lost", "Tiempo de vida": "Time alive", "Kills a cegados": "Kills on flashed",
  "Muertes cegado": "Deaths while flashed", "Granadas / ronda": "Grenades / round", "Eficiencia flash": "Flash efficiency",
  "Mapas": "Maps", "Rating medio*": "Average rating*", "KAST medio": "Average KAST", "ADR medio": "Average ADR",
  "K/D equipo": "Team K/D", "Opening medio": "Average opening", "Trade kills/ronda ": "Trade kills/round ",
  "Ronda más larga": "Longest round", "Primeras kills": "First kills", "Pistol rounds": "Pistol rounds",
  "Plants": "Plants", "Daño de utilidad": "Utility damage", "Flashes": "Flashes", "MVP": "MVP",
  "Humos": "Smokes", "Molotovs": "Molotovs", "HEs": "HEs", "Flashes ": "Flashes ",
  "Mapa de calor ": "Heatmap ",
  // tablas
  "Métrica": "Metric", "Selección": "Selection", "Jugador": "Player", "Rol": "Role", "Economía ": "Economy ",
  "Rondas ": "Rounds ", "Mapa ": "Map ", "Partidas ": "Matches ", "Potencia": "Power", "Swing": "Swing",
  "Win%": "Win%", "Rating": "Rating", "Opening%": "Opening%", "Equip.": "Equip.", "Win%": "Win%",
  "Situación": "Situation", "Veces": "Times", "Ganados": "Won", "Guardados": "Saved", "Rival": "Opponent",
  "Resultado": "Result", "Sitio": "Site", "Sin plant": "No plant", "Sitio A": "Site A", "Sitio B": "Site B",
  "Media del equipo": "Team average", "Compra": "Buy", "Equipo ": "Team ",
  "Anti-eco": "Anti-eco", "Full vs full": "Full vs full", "Force vs full": "Force vs full", "Eco vs full": "Eco vs full",
  "Rondas ganadas": "Rounds won", "Rondas perdidas": "Rounds lost", "Más tiempo en": "Most time in",
  "Kills en (zona del rival)": "Kills in (enemy zone)", "Muertes en": "Deaths in",
  "Pistol": "Pistol", "Eco": "Eco", "Force": "Force", "Full buy": "Full buy",
  "Economía ": "Economy ", "Utilidad lanzada": "Utility thrown",
  "Plantamos (T)": "We plant (T)", "Defendemos (CT)": "We defend (CT)",
  "Humos/r": "Smokes/r", "Flash/r": "Flash/r", "HE/r": "HE/r", "Molo/r": "Molo/r", "Efic. flash": "Flash eff.",
  "Dmg util/r": "Util dmg/r", "Cegados/r": "Flashed/r", "Kills a cegados ": "Kills on flashed ",
  "Muertes cegado ": "Deaths flashed ", "Vida perdida ": "Health lost ", "Vida (s)": "Life (s)",
  "Media del equipo ": "Team average ",
  // botones y etiquetas de controles
  "Nombres": "Names", "Visión": "Vision", "Utilidad": "Utility", "Zonas": "Zones",
  "Mostrar nombres": "Show names", "Reproducir / pausa (espacio)": "Play / pause (space)",
  "Reprocesar": "Reprocess", "Eliminar": "Delete", "Reprocesar todas": "Reprocess all",
  "Procesar demos nuevas de la carpeta": "Process new demos in the folder", "Seleccionar archivos": "Choose files",
  "Arrastra aquí tus demos": "Drag your demos here", "Pendiente": "Pending", "Procesada": "Processed",
  "Partida": "Match", "Bando ": "Side ", "Capa": "Layer", "Tipo": "Type", "Líneas": "Lines",
  "Origen → impacto": "Origin → impact", "Más tiempo": "Most time",
  "Conf.": "Conf.", "Ronda anterior (P)": "Previous round (P)", "Ronda siguiente (N)": "Next round (N)",
  "Ver": "View", "Cerrar": "Close", "Metodología ": "Methodology ",
  "Posición": "Position", "Kills": "Kills", "Muertes": "Deaths",
  // estados vacíos
  "Todavía no hay demos procesadas": "No demos processed yet",
  "Sin datos con este filtro": "No data with this filter",
  "Prueba con otro mapa, bando o equipo.": "Try another map, side or team.",
  "Algo salió mal": "Something went wrong",
  "No se pudo conectar con el servidor": "Could not connect to the server",
  "Sin datos": "No data",
  "Sin trabajos recientes.": "No recent jobs.",
  // marquesina y pie
  "DEICHAL ANALYTICS": "DEICHAL ANALYTICS", "ANÁLISIS DE DEMOS CS2": "CS2 DEMO ANALYSIS",
  "RADAR ESTILO HLTV": "HLTV-STYLE RADAR", "ROUND SWING": "ROUND SWING", "MAPAS DE CALOR": "HEATMAPS", "REPLAY 2D": "2D REPLAY",
  "Herramienta local de análisis de demos CS2": "Local CS2 demo analysis tool",
  "© 2026 Deichal Analytics ": "© 2026 Deichal Analytics ",
  " · Herramienta local de análisis de demos CS2": " · Local CS2 demo analysis tool",
  // metodología (cabeceras)
  "Documentación ": "Documentation ",
  // fragmentos frecuentes
  "kills / ronda": "kills / round", "muertes / ronda": "deaths / round", "fórmula HLTV": "HLTV formula",
  "rondas vivo": "rounds alive", "pp / ronda": "pp / round", "pp / ronda · media": "pp / round · avg",
  "pp en rondas ganadas": "pp in won rounds", "pp en rondas perdidas": "pp in lost rounds",
  "media jugadores": "players avg", "Tamaño": "Size", "Importa, procesa y gestiona tus partidas": "Import, process and manage your matches",
  "T eliminó a CT": "T killed CT", "CT eliminó a T": "CT killed T", "Bomba explotó": "Bomb exploded",
  "Bomba desactivada": "Bomb defused", "Tiempo agotado": "Time ran out",
  "valor medio de equipo al empezar": "team average value at round start",
  "Ronda": "Round", "rondas": "rounds", "Gana": "Wins", "Clutch": "Clutch", "Lurker": "Lurker", "Rifler": "Rifler", "Entry": "Entry", "AWPer": "AWPer", "Support": "Support", "IGL": "IGL",
  "Resumen de partida": "Match summary",
};

const LANG = (() => {
  try { return localStorage.getItem("deichal-lang") === "en" ? "en" : "es"; } catch { return "es"; }
})();

// Traduce un texto de JS (usado en las cabeceras del HUD y en avisos).
function tr(s) {
  if (LANG !== "en") return s;
  const k = String(s).trim();
  return I18N_EN[k] !== undefined ? String(s).replace(k, I18N_EN[k]) : s;
}

function translateTextNode(n) {
  const raw = n.nodeValue;
  const k = raw.trim();
  if (!k || I18N_EN[k] === undefined) return;
  n.nodeValue = raw.replace(k, I18N_EN[k]);
}

function translateTree(root) {
  if (LANG !== "en" || !root) return;
  if (root.nodeType === 3) return translateTextNode(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.parentNode && n.parentNode.tagName !== "SCRIPT" && n.parentNode.tagName !== "STYLE") translateTextNode(n);
  }
}

function setupI18n() {
  document.documentElement.lang = LANG;
  const sel = document.getElementById("lang");
  if (sel) {
    sel.value = LANG;
    sel.onchange = () => {
      try { localStorage.setItem("deichal-lang", sel.value); } catch {}
      location.reload();
    };
  }
  if (LANG !== "en") return;
  translateTree(document.body);
  // todo lo que se pinte después (pestañas, tablas, paneles) también se traduce
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) translateTree(n);
  }).observe(document.body, { childList: true, subtree: true });
}
document.addEventListener("DOMContentLoaded", setupI18n);
