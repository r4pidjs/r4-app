import { useState } from "react";

export type CounterProps = {
  start?: number;
};

export default function Counter({ start = 0 }: CounterProps) {
  const [count, setCount] = useState(start);

  return (
    <p>
      <button type="button" onClick={() => setCount(count + 1)}>
        Count: {count}
      </button>
    </p>
  );
}
