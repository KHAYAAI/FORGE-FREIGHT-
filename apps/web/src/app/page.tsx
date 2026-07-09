export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "4rem 1.5rem" }}>
      <h1>FORGE Freight</h1>
      <p>
        Digital freight forwarding for African trade corridors — instant
        quotes, real container visibility, AI-prepared customs entries, and
        trade finance built into the same ledger that runs your payments.
      </p>
      <ul>
        <li>
          <strong>Customer portal</strong> — where is my stuff (milestone 9)
        </li>
        <li>
          <strong>Ops console</strong> — what needs a human today (milestone 3)
        </li>
        <li>
          <strong>Partner console</strong> — franchise network (milestone 10)
        </li>
      </ul>
      <p>
        API: <code>POST /quotes</code> on port 3001 — see the repo README for
        the demo quote request.
      </p>
    </main>
  );
}
