# Build PWA e pubblicazione GitHub Pages

La build conserva la grafica e le schermate Emergent, aggiungendo manifest, icone 1% e apertura standalone. Richiede Internet per autenticazione, dati e allegati: il service worker non intercetta richieste, non crea cache offline e non sottoscrive notifiche push.

## Apertura su questo PC Windows

Fare doppio clic su `emergent/Apri-1percent.cmd`. Il file trova Node.js, avvia la build di `frontend/dist` e apre il browser su `http://localhost:8081/`. Tenere aperta la console; Ctrl+C arresta il server. Non viene configurato alcun avvio automatico. Il percorso `localhost` mantiene lo stesso indirizzo previsto per il callback Google.

Un secondo doppio clic riapre la stessa app se il server sulla porta 8081 serve una build identica. Se la porta contiene un'altra app, una vecchia build o il precedente server senza marker, l'avvio si ferma con istruzioni: chiudere manualmente quella console, poi riprovare. Non vengono terminati processi né cambiata porta. La verifica comprende tutti i file pubblici della build, tenuti in memoria dal server per evitare di mescolare file durante una ricompilazione.

In alternativa, dalla cartella `frontend`: `pnpm preview:web --open`, oppure `node scripts/serve-web.mjs --open`. Se la build manca, eseguire prima `pnpm build:web`. Un export Pages con percorso di base viene aperto allo stesso percorso indicato nel manifest; per questo PC usare una build con `EXPO_PUBLIC_BASE_PATH` vuoto.

## Compilazione

Dalla directory `frontend`, configurare `.env` a partire da `.env.example`, usando esclusivamente URL Supabase e chiave pubblicabile. Il segreto OAuth Google rimane nelle impostazioni del provider Supabase.

```powershell
# Vuoto per localhost o un sito alla radice; /nome-repository per un progetto Pages.
$env:EXPO_PUBLIC_BASE_PATH = '/nome-repository'
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build:web
```

`package-pages.mjs` completa l'export Expo in `dist/`. Il percorso di base deve essere impostato prima della compilazione e restare uguale durante il packaging: influenza JavaScript, icone, manifest e callback. `start_url` e `scope` seguono lo stesso percorso. [Riferimento manifest](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/start_url).

Sono inclusi `auth/callback/index.html` e `404.html`, copie della SPA che non riscrivono il query string OAuth. Il primo rende disponibile il ritorno statico; il secondo permette l'apertura diretta di dettagli con ID dinamici sui servizi compatibili. GitHub può rispondere con stato HTTP 404 a un percorso dinamico, pur caricando l'app. [Pagina 404 di GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-custom-404-page-for-your-github-pages-site).

Prima del primo accesso sul sito pubblicato, aggiungere in Supabase l'esatto callback HTTPS scelto, per esempio `https://account.github.io/nome-repository/auth/callback`, mantenendo anche gli indirizzi localhost ancora utilizzati. Non modificare il callback Google verso Supabase. Il workflow pubblica soltanto il frontend: non modifica tabelle, dati, provider Google o configurazione remota Supabase.

## Workflow di pubblicazione

Il repository deve avere come radice il contenuto di `emergent`, con `frontend/` e `.github/workflows/` allo stesso livello. In **Settings → Pages → Build and deployment → Source**, selezionare **GitHub Actions**. In **Settings → Secrets and variables → Actions → Variables**, impostare `EXPO_PUBLIC_SUPABASE_URL` e `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Sono la configurazione pubblica prevista dal browser; non inserire segreti OAuth, chiavi `service_role` o chiavi `sb_secret_`.

Il workflow `.github/workflows/pages-deploy.yml` si attiva quando arriva un push sul branch predefinito oppure da **Actions → Deploy web app to GitHub Pages → Run workflow**, selezionando quel branch. I branch diversi dal predefinito non vengono pubblicati. Installa le versioni del lockfile, esegue typecheck, lint e test, compila Expo e verifica gli asset prima del deploy. Il job build ha soltanto `contents:read` e `pages:read`; `pages:write` e `id-token:write` sono limitati al job deploy, con environment `github-pages`. [Workflow personalizzati Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

Il percorso viene letto automaticamente dai metadati Pages: `/nome-repository` per un sito di progetto, stringa vuota per `owner.github.io` o per un dominio configurato alla radice. Per un override persistente impostare la variabile del repository `PAGES_BASE_PATH`; nell'avvio manuale `base_path` ha precedenza. Lasciarlo vuoto usa la variabile o il rilevamento automatico; `auto` forza il rilevamento, `/` forza la radice, `/nome-repository` imposta un percorso. Ogni cambiamento richiede una nuova build e un callback Supabase coerente. [Metadati configure-pages](https://github.com/actions/configure-pages/blob/v6.0.0/action.yml).

Le azioni del deploy sono fissate alle release ufficiali verificate: checkout `v7.0.1`, setup-node `v7.0.0`, pnpm/action-setup `v6.1.0`, configure-pages `v6.0.0`, upload-pages-artifact `v5.0.0` e deploy-pages `v5.0.1`. La compilazione resta su Node 24 e sulla versione pnpm dichiarata in `frontend/package.json`. [Release checkout](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-node](https://github.com/actions/setup-node/releases/tag/v7.0.0), [pnpm/action-setup](https://github.com/pnpm/action-setup/releases/tag/v6.1.0), [deploy-pages](https://github.com/actions/deploy-pages/releases/tag/v5.0.1).

L'upload usa `include-hidden-files: true`: Expo con pnpm esporta i font in `assets/node_modules/.pnpm`, che la versione 4 di upload-pages-artifact escludeva. La versione 5 supporta esplicitamente questa opzione. Prima dell'upload, `pages-ci.mjs verify` rifiuta dotfile inattesi, file di credenziali, link e output troppo grandi; ammette soltanto `.nojekyll` e la directory pubblica `.pnpm` prevista. Sono conservati anche i bundle `_expo`, senza una fase Jekyll. [Implementazione ufficiale dell'upload v5](https://github.com/actions/upload-pages-artifact/blob/v5.0.0/action.yml).

La dimensione massima del sito pubblicato è 1 GB, il deploy ha un limite di 10 minuti e la banda ha una soglia indicativa di 100 GB al mese. Pages offre hosting statico; l'app usa Supabase per autenticazione, dati e allegati. [Limiti GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

## Artefatto per revisione senza pubblicazione

Il workflow `.github/workflows/pages-artifact.yml` rimane disponibile con solo avvio manuale. Usa le stesse variabili pubbliche e i medesimi controlli della build; nell'avvio indicare `base_path` appropriato. Compila e allega `frontend/dist` per revisione senza deploy né permesso `pages:write`. Include i file nascosti pubblici necessari a Expo.

## Notifiche e installazione

Settings richiede il consenso soltanto premendo Enable notifications. Il test invia subito una richiesta reale al browser. I timer controllano le scadenze ogni 15 secondi mentre la pagina rimane aperta; sospensione o chiusura possono impedire la consegna. Il service worker gestisce soltanto visualizzazione e apertura dell'inbox. [API di visualizzazione](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification).

Il manifest consente l'installazione nei browser compatibili. Su iPhone usare Condividi → Aggiungi alla schermata Home, quindi verificare il supporto alle notifiche nell'app aperta da quel collegamento. L'installazione non abilita sincronizzazione offline o consegna a pagina chiusa.

Test isolati: `pnpm exec vitest run tests/pages-artifact.test.mjs tests/pages-ci.test.mjs tests/notifications-web.test.ts tests/serve-web.test.mjs`. Verificano percorsi alla radice e sotto repository, configurazione Pages, esclusione dei segreti, conservazione dei font `.pnpm`, icone, callback/fallback, consenso, deduplicazione, messaggi generici, cancellazione dopo logout, avvio loopback, riuso della build e conflitti di porta. Il launcher Windows viene eseguito in una fixture senza aprire il browser. Non equivalgono a un deploy su GitHub, a una consegna reale di una notifica su iPhone o a un nuovo login Google.
