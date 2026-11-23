import type { ReactNode } from "react";

export type MainProps = {
  dev: boolean;
  importMap: string;
  router: string;
  islands: string;
  stylesheets: string[];
  title: string;
  children: ReactNode;
};

export function Main({
  dev,
  importMap,
  router,
  islands,
  stylesheets,
  title,
  children,
}: MainProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <script
          type="importmap"
          dangerouslySetInnerHTML={{ __html: importMap }}
        />
        {stylesheets.map(href => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
        {/*
          The framework ships the client router at ROUTER_PATH. It marks the
          script with data-r4-router and reads the generated island registry
          from data-islands to hydrate markers after each navigation.
        */}
        <script
          type="module"
          src={router}
          data-r4-router=""
          data-islands={islands}
          data-preload="none"
        />
        {dev ? <script src="/__r4/dev.js" /> : null}
      </head>
      <body>
        <nav>
          <a className="brand" href="/" data-r4-link="">
            <img src="/logo.svg" alt="R4 + React" height="28" />
          </a>
          <a href="/" data-r4-link="">
            Home
          </a>
          <a href="/about" data-r4-link="">
            About
          </a>
        </nav>
        <div data-r4-root="">{children}</div>
      </body>
    </html>
  );
}
