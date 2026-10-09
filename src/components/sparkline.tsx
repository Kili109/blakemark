import { useEffect, useState } from "react";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";

export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (values.length < 2) {
    return <div className="flex h-10 w-16 shrink-0 items-center justify-end text-xs text-muted">—</div>;
  }
  const up = values[values.length - 1]! >= values[0]!;
  const data = values.map((v, i) => ({ i, v }));
  return (
    <div className="h-10 w-16 shrink-0" aria-hidden="true">
      {ready ? (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <YAxis hide domain={["dataMin", "dataMax"]} />
            <Line
              type="monotone"
              dataKey="v"
              stroke={up ? "var(--color-up)" : "var(--color-down)"}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : null}
      <span className="sr-only">{label} trend</span>
    </div>
  );
}
