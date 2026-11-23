export type AboutProps = Record<string, never>;

export function About() {
  return (
    <main>
      <h1>About</h1>
      <p>
        A Rust-rendered page served by r4, with React islands hydrated in the
        browser.
      </p>
      <p>
        <a href="/" data-r4-link="">
          Back home
        </a>
      </p>
    </main>
  );
}
