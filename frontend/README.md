# Frontend 1%

Expo 57 / React Native Web, design Emergent, Google e dati sincronizzati in Supabase.

Uso, stato della migrazione e avvio PC: [README del progetto](../README.md).
Build statica e installazione su Home iPhone: [PWA-PAGES.md](docs/PWA-PAGES.md).

Da questa directory: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build:web`, `pnpm preview:web`. La preview è `http://localhost:8081/`; il relativo callback Google/Supabase è già autorizzato. Per lo sviluppo usare `pnpm start`.

Configurare solo le variabili pubbliche descritte in `.env.example`. Non pubblicare `.env`, token o segreti. La nuova migrazione Supabase è ancora da autorizzare e applicare; leggere il README principale prima di creare note o usare la domenica.
