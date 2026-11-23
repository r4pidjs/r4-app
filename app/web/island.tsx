import type { ComponentType } from "react";
import { islands } from "./.generated/islands.jsx";

type IslandProps = {
  name: keyof typeof islands;
  props?: Record<string, unknown>;
};

export function Island({ name, props = {} }: IslandProps) {
  const Component = islands[name] as
    | ComponentType<Record<string, unknown>>
    | undefined;

  if (typeof Component !== "function") {
    throw new Error("Unknown island: " + String(name));
  }

  return (
    <div data-island={name} data-props={JSON.stringify(props)}>
      <Component {...props} />
    </div>
  );
}
