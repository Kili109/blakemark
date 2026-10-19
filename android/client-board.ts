import { loadBlocks } from "../src/lib/market/blocks";
import { loadBoard, loadChart, loadFinePrices, loadMarkHistory } from "../src/lib/market/board.server";
import type { QuoteCcy } from "../src/lib/market/types";

export function getBoard() {
  return loadBoard();
}

export function getFinePrices() {
  return loadFinePrices();
}

export function getMarkHistory() {
  return loadMarkHistory();
}

export function getBlocks() {
  return loadBlocks();
}

export function getXbtChart(input: {
  data: { quote: QuoteCcy; interval: "15m" | "1h" | "4h" | "1d" };
}) {
  return loadChart(input.data.quote, input.data.interval);
}
