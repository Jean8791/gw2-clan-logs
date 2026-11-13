// Estilo comum dos gráficos (Recharts) no tema escuro.
export const AXIS = { stroke: "#5d6575", fontSize: 11, tickLine: false, axisLine: false } as const;
export const GRID = { stroke: "#2a303c", strokeDasharray: "3 4", vertical: false } as const;
export const TOOLTIP = {
  contentStyle: { background: "#1c2029", border: "1px solid #2a303c", borderRadius: 10, fontSize: 12, color: "#e8eaef" },
  labelStyle: { color: "#8f98a8", marginBottom: 4 },
  itemStyle: { color: "#e8eaef" },
  cursor: { fill: "#ffffff08" },
} as const;

/** Cores para séries (jogadores na comparação). A primeira é o dourado do tema. */
export const SERIES = ["#e0b25a", "#6aa7ff", "#4fc38a", "#ef6b6b", "#b679d5", "#5fd3d3"];
