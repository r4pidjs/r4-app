import { renderToReadableStream, renderToString } from "react-dom/server.browser";
import { Main } from "./layouts/main.tsx";
import { About } from "./pages/about.tsx";
import { Home } from "./pages/home.tsx";
import { NotFound } from "./pages/not-found.tsx";
import { Stream } from "./stream.tsx";

const pages = {
  home: Home,
  about: About,
  "not-found": NotFound,
};

const layouts = {
  main: Main,
};

function readJob(request) {
  const header = (request.headers ?? []).find(
    ([name]) => String(name).toLowerCase() === "x-r4-props",
  );

  return header ? JSON.parse(header[1]) : {};
}

function renderJob(job) {
  const Page = pages[job.page];

  if (typeof Page !== "function") {
    throw new Error("Unknown page: " + job.page);
  }

  const page = <Page {...job.props} />;

  if (!job.layout) {
    return page;
  }

  const Layout = layouts[job.layout];

  if (typeof Layout !== "function") {
    throw new Error("Unknown layout: " + job.layout);
  }

  return <Layout {...job.layoutProps}>{page}</Layout>;
}

globalThis.__renderStream = async path => {
  try {
    const stream = await renderToReadableStream(<Stream path={path} />);
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      Deno.core.ops.op_emit_chunk(decoder.decode(value, { stream: true }));
    }
  } catch (error) {
    Deno.core.ops.op_stream_error(
      String(error && error.stack ? error.stack : error),
    );
  }
};

globalThis.__handleRequest = async requestJson => {
  const request = JSON.parse(requestJson);
  const job = readJob(request);
  const html = renderToString(renderJob(job));

  return JSON.stringify({
    status: 200,
    headers: [["content-type", "text/html; charset=utf-8"]],
    body: "<!doctype html>" + html,
  });
};
