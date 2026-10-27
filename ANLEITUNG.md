# Strength progress als Android-App

Die App ist eine installierbare Web-App (PWA). Sie arbeitet direkt mit der Google Sheets API,
kein Server dazwischen, die Daten gehen nur zwischen Handy und Google hin und her.

- **Dashboard**: liest „Summary Training“ (Original) und „Summary Training (aus Laura Training)“
  und rechnet 1RM, Trends und Accessories auf dem Handy aus.
- **Plan übernehmen**: liest deinen Trainingsplan „Kopie von Laura Training“, extrahiert die Sätze
  mit denselben Regeln und korrigierten Namen wie bisher und schreibt sie nach einer Vorschau in
  „Summary Training (aus Laura Training)“.

Geschrieben wird ausschließlich in „Summary Training (aus Laura Training)“. Der Trainingsplan und das
Original-Sheet werden nur gelesen; die App bricht ab, falls das Ziel eines davon wäre.

Du brauchst einmalig drei Dinge: Hosting (GitHub Pages), eine OAuth-Client-ID (Google Cloud)
und die Installation am Handy. Rechne mit etwa 20 Minuten.

## 1. Dateien hosten (GitHub Pages, kostenlos)

1. Auf github.com anmelden (oder Konto anlegen) → **New repository**, z. B. Name `strength`,
   **Public** (GitHub Pages ist im kostenlosen Plan nur für öffentliche Repos).
   Im Repo liegt nur der Programmcode und die IDs deiner Sheets, keine Trainingsdaten:
   Lesen kann die Sheets nur, wer sich mit einem Google-Konto anmeldet, das Zugriff hat.
2. **Add file → Upload files** und den *Inhalt* dieses Ordners hochladen
   (index.html, app.js, config.js, d3.min.js, sw.js, manifest.webmanifest, Ordner icons).
3. **Settings → Pages** → Source: *Deploy from a branch*, Branch `main`, Ordner `/ (root)` → Save.
4. Nach ein bis zwei Minuten läuft die App unter `https://DEINNAME.github.io/strength/`.

## 2. Google-Zugang einrichten (Google Cloud Console)

1. https://console.cloud.google.com → oben **Projekt auswählen → Neues Projekt**, z. B. „Strength“.
2. **APIs & Dienste → Bibliothek** → „Google Sheets API“ → **Aktivieren**.
3. **APIs & Dienste → OAuth-Zustimmungsbildschirm** (heißt teils „Google Auth Platform“):
   - Nutzertyp **Extern**, App-Name z. B. „Strength progress“, deine E-Mail als Support- und Kontaktadresse.
   - Bei **Zielgruppe / Testnutzer** deine Gmail-Adresse eintragen.
   - Unter **Datenzugriff / Bereiche** kannst du `.../auth/spreadsheets` hinzufügen (optional, die App fragt ihn ohnehin an).
   - Status **Testing** lassen. Dann ist keine Prüfung durch Google nötig, weil nur du die App nutzt.
4. **APIs & Dienste → Anmeldedaten → Anmeldedaten erstellen → OAuth-Client-ID**:
   - Anwendungstyp **Webanwendung**.
   - **Autorisierte JavaScript-Quellen**: `https://DEINNAME.github.io` (ohne `/strength` am Ende).
   - Erstellen und die **Client-ID** kopieren (endet auf `.apps.googleusercontent.com`).
     Ein Client-Secret brauchst du nicht.

## 3. Am Handy installieren

1. In **Chrome** `https://DEINNAME.github.io/strength/` öffnen.
2. Beim ersten Start fragt die App nach der Client-ID. Einfügen → **Speichern und anmelden**.
   (Alternativ trägst du sie in `config.js` bei `clientId` ein, dann fragt sie gar nicht.)
3. Google-Konto wählen. Weil die App im Testmodus ist, zeigt Google
   „Google hat diese App nicht überprüft“ → **Weiter**. Zugriff auf Google Tabellen erlauben.
   Google beschreibt das als „Tabellen ansehen, bearbeiten, erstellen und löschen“, weil es für
   einzelne Dateien keinen feineren Schreibzugriff gibt. Die App selbst schreibt nur in das eine Ziel-Sheet.
4. Chrome-Menü ⋮ → **App installieren** (oder „Zum Startbildschirm hinzufügen“).

## Im Alltag

- Die App zeigt sofort den zuletzt geladenen Stand, auch offline. Oben steht, von wann er ist.
- **Aktualisieren** holt die neuesten Werte aus den Sheets. Die Google-Anmeldung gilt eine Stunde.
  Danach öffnet „Aktualisieren“ kurz das Google-Fenster, meist ohne erneute Nachfrage.
- **Abmelden** widerruft den Zugriff und löscht die gespeicherte Kopie auf dem Handy.
- **Plan übernehmen** nach dem Training: Die App liest den Trainingsplan (alle Tage bis heute) und
  zeigt, welche Sätze neu oder geändert sind und welche entfallen. Erst **Ins Sheet schreiben** ändert
  das Sheet. Ist nichts zu tun, steht dort „Dein Sheet ist aktuell“.
- Das Ziel-Sheet wird dabei komplett aus dem Plan neu geschrieben. Korrekturen (Ausreißer, Tippfehler)
  daher im **Trainingsplan** machen, nicht im Ziel-Sheet, sonst überschreibt der nächste Abgleich sie.
- Unter „Hinweise der letzten 6 Wochen“ stehen Zeilen, die nicht eindeutig lesbar waren
  (z. B. „Max 85“ als Gewicht) oder bei denen Sätze und Werte nicht zusammenpassten.
- Neue Namen oder Umbenennungen stehen in `mappings.js` (z. B. `ACC_RENAME` für Assistenzübungen).
  Datei anpassen, hochladen, fertig.

## Updates der App

Geänderte Dateien wieder ins Repo hochladen. In `sw.js` die Versionsnummer bei `CACHE` erhöhen,
damit das Handy die neue Version übernimmt (beim zweiten Öffnen nach dem Update).
