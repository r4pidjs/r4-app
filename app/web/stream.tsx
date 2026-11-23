export type StreamProps = {
  path: string;
};

/*
 * The stream route renders this document through renderToReadableStream and
 * forwards the chunks, so Axum never buffers the whole page. It stays
 * synchronous: React's Suspense reveal scripts are inline, and the CSP only
 * allows the hashed import map.
 */
export function Stream({ path }: StreamProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>Stream</title>
      </head>
      <body>
        <main>
          <h1>Stream</h1>
          <p>
            Path: <code>{path}</code>
          </p>
          <p data-streamed="document">
            This document was streamed from React through V8 and forwarded chunk
            by chunk.
          </p>
        </main>
      </body>
    </html>
  );
}
