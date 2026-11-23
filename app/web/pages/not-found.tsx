export type NotFoundProps = {
  path: string;
};

export function NotFound({ path }: NotFoundProps) {
  return (
    <main>
      <h1>Not found</h1>
      <p>
        Nothing is routed at <code>{path}</code>.
      </p>
      <p>
        <a href="/" data-r4-link="">
          Back home
        </a>
      </p>
    </main>
  );
}
