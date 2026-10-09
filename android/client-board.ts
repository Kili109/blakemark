import { loadBoard, loadChart } from "../src/lib/market/board.server";
import type { QuoteCcy } from "../src/lib/market/types";

export function getBoard() {
  return loadBoard();
}

export function getXbtChart(input: {
  data: { quote: QuoteCcy; interval: "15m" | "1h" | "4h" | "1d" };
}) {
  return loadChart(input.data.quote, input.data.interval);
}
