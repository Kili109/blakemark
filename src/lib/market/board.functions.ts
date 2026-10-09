import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getBoard = createServerFn({ method: "GET" }).handler(async () => {
  const { loadBoard } = await import("./board.server");
  return loadBoard();
});

export const getXbtChart = createServerFn({ method: "GET" })
  .validator(
    z.object({
      quote: z.enum(["USDC", "USDT", "BTC"]),
      interval: z.enum(["15m", "1h", "4h", "1d"]),
    }),
  )
  .handler(async ({ data }) => {
    const { loadChart } = await import("./board.server");
    return loadChart(data.quote, data.interval);
  });
