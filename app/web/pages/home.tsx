import { Island } from "../island.jsx";

export type HomeProps = {
  message: string;
};

export function Home({ message }: HomeProps) {
  return (
    <main>
      <h1>R4 + React</h1>
      <p>{message}</p>
      <Island name="counter" props={{ start: 0 }} />
      <p>
        <a href="/about" data-r4-link="">
          About
        </a>
      </p>
      <section>
        <h2>Native BFF</h2>
        <Island name="bff" />
      </section>
    </main>
  );
}
