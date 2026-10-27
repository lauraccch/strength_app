// Einstellungen der App. Die Client-ID kommt aus der Google Cloud Console
// (APIs & Dienste → Anmeldedaten → OAuth-Client-ID, Typ „Webanwendung“).
// Bleibt sie leer, fragt die App beim ersten Start danach.
window.APP_CONFIG = {
  clientId: '',
  // Quelle für „Plan übernehmen“: dein Trainingsplan (wird nur gelesen)
  plan: { id: '1f6vs3B9mXbV09NDLt_yOZ7GAlAbvx4PB1ptj74c71e4' },                                      // Kopie von Laura Training
  sheets: {
    training: { id: '1mqJH6yPchvLhy_klIwj1PJw53T69zPsq7vkt65WdK-M', range: 'Tabellenblatt1!A1:H' },       // Summary Training (Original, wird nur gelesen)
    training_plan: { id: '1tw2hPxkWfYvcQsxNGqc6G9UIWDvXXohyKtZoyLeLyWQ', range: 'Tabellenblatt1!A1:H' }, // Summary Training (aus Laura Training): hier schreibt „Plan übernehmen“
  },
};
