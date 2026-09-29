# 1% — versione Emergent con Supabase

Questo è il nuovo progetto web ricavato da `APP-COMPLETA.tar.gz`. Mantiene l'interfaccia e le funzioni Emergent e usa Google/Supabase per autenticazione, dati e immagini private. Il precedente backend Emergent non serve per eseguire questa versione.

## Aprire sul PC

Fare doppio clic su **Apri-1percent.cmd** in questa cartella. Apre **http://localhost:8081/** nel browser, servendo la build già preparata in `frontend/dist/`. Lasciare la console aperta; Ctrl+C la arresta. Non crea servizi o avvii automatici e non occupa le porte delle precedenti app.

La build pronta è presente nel workspace originale e nel pacchetto per PC. Un clone GitHub o il pacchetto dei soli sorgenti non contiene `dist`: configurare prima `frontend/.env`, poi eseguire `pnpm install --frozen-lockfile` e `pnpm build:web` dalla cartella `frontend`. Dopo questa preparazione il launcher funziona anche nel clone.

Richiede Node.js (già disponibile su questo PC) e Internet per accedere e leggere/salvare i dati. Non occorre eseguire Emergent né acquistare crediti Emergent. Il frontend resta un sito statico: HTML, JavaScript, font e icone vanno tenuti insieme. L'HTML aperto come `file://` non può completare questo accesso Google.

## Stato e dati

- Login Google reale, profilo e lettura dei record Supabase verificati nella preview locale. I salvataggi sono implementati con controllo della revisione per evitare sovrascritture fra dispositivi; la pagina recupera gli aggiornamenti al ritorno in primo piano e ogni 30 secondi mentre è attiva.
- Le nuove note Emergent e la domenica nell'orario richiedono **`supabase/migrations/202609290001_emergent_compat.sql`**. La migrazione è testata su PostgreSQL locale ma **non ancora applicata al progetto remoto**. Fino all'applicazione, non usare la nuova creazione/salvataggio note o domenica. Non rieseguire la migrazione iniziale del vecchio progetto.
- La nota già salvata con il precedente editor di 1% resta intatta: questa versione la segnala come incompatibile e non la modifica. Aprirla nella precedente app cloud; il formato Emergent viene usato per nuovi quaderni separati.
- L'archivio ricevuto contiene i sorgenti, **non i dati personali salvati nel MongoDB di Emergent**. Un eventuale trasferimento di note, eventi, operazioni e immagini da Emergent richiede un export distinto, da esaminare prima dell'importazione. Anche i dati locali della precedente build HTML non vengono trasferiti automaticamente.
- Upload privati, pagamenti manualmente registrati e operazioni sulle cartelle sono implementati; i test usano fixture isolate, non dati dimostrativi nell'account reale. Le prove complete di scrittura con due sessioni reali e Safari/iPhone restano da eseguire.

## Sviluppo

Node.js 24 e pnpm 10.32.1. Dalla cartella `frontend`:

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build:web
pnpm preview:web
```

Per lo sviluppo interattivo: `pnpm start`. I comandi hanno un lockfile autonomo; non installare le dipendenze dalla cartella del vecchio progetto. `pnpm build:web` produce `frontend/dist` e non pubblica nulla.

La configurazione di questo PC è già in `frontend/.env` e rimane esclusa da Git. In un nuovo ambiente, copiare `frontend/.env.example` in `.env`: usare soltanto URL Supabase e chiave pubblicabile. Client Secret Google, chiavi server e token personali non devono entrare nei sorgenti o nel bundle.

La sessione della nuova versione ha una chiave dedicata. Logout rimuove sessione, bozze temporanee e avvisi da questo browser; i record cloud salvati restano nel proprio account. Le notifiche contengono messaggi generici e richiedono consenso esplicito in Settings. Possono arrivare soltanto mentre la pagina resta attiva: non sono notifiche push a pagina chiusa. Non è implementata la sincronizzazione offline.

## GitHub Pages e Home iPhone

La pubblicazione è stata richiesta dall'utente. Sono pronti manifest, icone, callback statico e fallback delle rotte; **il sito non è ancora pubblicato**. Restano da completare l'accesso GitHub e la scelta del repository/visibilità. La destinazione determina `EXPO_PUBLIC_BASE_PATH` e il callback HTTPS da autorizzare in Supabase. Il callback Google verso Supabase rimane quello esistente.

Il workflow `.github/workflows/pages-deploy.yml` verifica e pubblica il frontend da push sul branch predefinito o avvio manuale. `.github/workflows/pages-artifact.yml` rimane disponibile per produrre soltanto l'artefatto di revisione. Il repository deve contenere i sorgenti attivi di questa cartella `emergent` nella propria radice. Configurazione Pages, variabili pubbliche e dettagli in [frontend/docs/PWA-PAGES.md](frontend/docs/PWA-PAGES.md).

Dopo la pubblicazione: aprire l'indirizzo HTTPS in Safari su iPhone → Condividi → Aggiungi alla schermata Home. Usando lo stesso account Google, PC e iPhone leggono i record nello stesso Supabase. L'installazione non è ancora stata provata su un iPhone fisico.

## Struttura

- `frontend/src/screens`, `components`, `notes`: interfaccia Emergent e quaderni.
- `frontend/src/cloud`, `src/api.ts`: Auth, adattamento dei dati e chiamate Supabase con proprietà e revisioni.
- `frontend/tests`: test del contratto UI, date/importi, OAuth, quaderni, PostgreSQL, notifiche e pacchetto statico. `tests/fixtures/core-schema.sql` è una copia immutabile dello schema iniziale **solo per test**, non una nuova migrazione da applicare.
- `supabase/migrations`: compatibilità additiva da applicare soltanto dopo revisione e autorizzazione.
- `backend`, `tests`, `memory`, `test_result.md` nella radice: riferimenti storici importati da Emergent. Non vengono eseguiti o pubblicati nel sito; i loro esiti non descrivono questa conversione. I test Python originari cancellano record QA e non vanno avviati sul progetto personale.

La copia filtrata originale e l'archivio ricevuto sono conservati separatamente. Nessun commit, pubblicazione o acquisto è stato eseguito durante la conversione.

I pacchetti in `outputs/` del workspace contengono rispettivamente la build per PC con launcher e i sorgenti attivi senza `.env` o dipendenze installate. Il backend Python storico resta nel workspace e nell'archivio originale, fuori dal pacchetto dei nuovi sorgenti.
