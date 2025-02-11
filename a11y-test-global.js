//Import der Module

const { Builder } = require('selenium-webdriver'); // Zum automatisierten Öffnen von Webseiten im Chrome-Browser.
const AxeBuilder = require('@axe-core/webdriverjs'); // Führt Barrierefreiheits-Tests nach WCAG und BITV durch.
const fs = require('fs'); // Zum Speichern der Ergebnisse als Datei.
const urlModule = require('url'); // Verarbeitung von relativen und absoluten Links.
const axios = require('axios'); // Lädt Webseiten-Inhalte (HTML) mit HTTP-Anfragen.
const cheerio = require('cheerio');// Parst das HTML, um Links zu extrahieren.
const path = require('path'); // Arbeitet mit Dateipfaden.

const baseUrl = 'https://denkwerk.com/';
const visitedUrls = new Set();
const resultsDir = 'accessibility-results';

// Erstelle das Ergebnisverzeichnis, falls es nicht existiert
if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir);
}

// Globale Ereignisse initialisieren: Hauptobjekt für alle Ergebnisse
let globalResults = {
  timestamp: new Date().toISOString(), // Zeitpunkt des Tests
  baseUrl: baseUrl,
  totalUrls: 0, // Anzahl getesteter URLs
  statistics: { // Gesamtzahl der Verstöße
    violations: 0, // Liste aller gefundenen Verstöße gegen vordefinierte Regeln -
    nodeViolations: 0 // Liste von Verstößen, die speziell auf einzelne Nodes (DOM-Elemente) zutreffen.
  },
  urlResults: [] // Liste der getesteten URLs mit Details.
};

// Funktion, um alle Links auf einer Seite zu extrahieren
async function getLinks(pageUrl) {
  const { data } = await axios.get(pageUrl);  // Lädt die HTML-Seite
  const $ = cheerio.load(data);               // Parst das HTML mit Cheerio
  const links = [];

  $('a').each((index, element) => {           // Durchläuft alle <a>-Tags
    let href = $(element).attr('href');
    if (href) {
      href = urlModule.resolve(baseUrl, href); // Macht relative URLs absolut
      if (href.startsWith(baseUrl) && !visitedUrls.has(href)) {
        links.push(href);                      // Speichert neue Links
        visitedUrls.add(href);                 // Fügt zur "besuchten" Liste hinzu
      }
    }
  });

  return links;  // Gibt die Liste der gefundenen Links zurück
}

// Funktion zum Durchführen des Accessibility-Tests
async function runAccessibilityTest(url) {
  const driver = await new Builder().forBrowser('chrome').build();

  try {
    await driver.get(url);

    // Axe-core Test durchführen
    const results = await new AxeBuilder(driver)
      .options({ reporter: 'v2' })
      .withTags(['wcag2aa', 'wcag2a', 'bitv'])
      .analyze();

    // Zähle nur noch Verstöße
    let urlViolations = 0;
    let urlNodeViolations = 0;
    const urlViolationCounts = {};

    // Erweiterte Verarbeitung der Verstöße mit detaillierten Nodeinfos
    const processedViolations = results.violations.map(violation => {
      urlViolations++;
      urlNodeViolations += violation.nodes.length;

      if (violation.id in urlViolationCounts) {
        urlViolationCounts[violation.id] += violation.nodes.length;
      } else {
        urlViolationCounts[violation.id] = violation.nodes.length;
      }

      // Erweitere die Node-Informationen
      const processedNodes = violation.nodes.map(node => ({
        ...node,
        location: {
          selector: node.target,
          snippet: node.html,
          xpath: node.target.join(' > ')
        }
      }));

      return {
        ...violation,
        nodes: processedNodes
      };
    });

    // Erstelle ein Ergebnisobjekt für diese URL
    const urlResult = {
      url: url,
      timestamp: new Date().toISOString(),
      summary: {
        totalViolations: urlViolations,
        totalNodeViolations: urlNodeViolations,
        violationCounts: urlViolationCounts
      },
      details: {
        violations: processedViolations
      }
    };

    // Füge die Ergebnisse zum globalen Objekt hinzu
    globalResults.urlResults.push(urlResult);
    globalResults.statistics.violations += urlViolations;
    globalResults.statistics.nodeViolations += urlNodeViolations;

    return {
      violations: urlViolations,
      nodeViolations: urlNodeViolations
    };
  } finally {
    await driver.quit();
  }
}

// Crawling und Tests durchführen
async function crawlAndTest(url) {
  // Teste zuerst die Start-URL
  await runAccessibilityTest(url);

  // Hole dann alle Links und teste diese
  const links = await getLinks(url);
  for (const link of links) {
    await runAccessibilityTest(link);
  }

  // Aktualisiere die Gesamtanzahl der URLs
  globalResults.totalUrls = visitedUrls.size;
  globalResults.crawledUrls = Array.from(visitedUrls);

  // Speichere alle Ergebnisse in einer einzigen JSON-Datei
  const resultPath = path.join(resultsDir, 'accessibility-results.json');
  fs.writeFileSync(resultPath, JSON.stringify(globalResults, null, 2));

  console.log('\nCrawling und Tests abgeschlossen:');
  console.log(`Getestete URLs: ${globalResults.totalUrls}`);
  console.log(`Gesamtanzahl Verstöße: ${globalResults.statistics.violations}`);
  console.log(`Gesamtanzahl betroffener Knoten: ${globalResults.statistics.nodeViolations}`);
  console.log(`\nAlle Ergebnisse wurden in "${resultPath}" gespeichert.`);
}

// Starte den Crawl mit der Basis-URL
visitedUrls.add(baseUrl);
crawlAndTest(baseUrl).catch(console.error);
