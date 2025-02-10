const { Builder } = require('selenium-webdriver');
const AxeBuilder = require('@axe-core/webdriverjs');
const fs = require('fs');
const urlModule = require('url');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const baseUrl = 'https://haribo.com/';
const visitedUrls = new Set();
const resultsDir = 'accessibility-results';

// Erstelle das Ergebnisverzeichnis, falls es nicht existiert
if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir);
}

// Hauptobjekt für alle Ergebnisse
let globalResults = {
  timestamp: new Date().toISOString(),
  baseUrl: baseUrl,
  totalUrls: 0,
  statistics: {
    violations: 0,
    nodeViolations: 0
  },
  urlResults: []
};

// Funktion, um alle Links auf einer Seite zu extrahieren
async function getLinks(pageUrl) {
  const { data } = await axios.get(pageUrl);
  const $ = cheerio.load(data);
  const links = [];
  $('a').each((index, element) => {
    let href = $(element).attr('href');
    if (href) {
      href = urlModule.resolve(baseUrl, href);
      if (href.startsWith(baseUrl) && !visitedUrls.has(href)) {
        links.push(href);
        visitedUrls.add(href);
      }
    }
  });
  return links;
}

// Funktion zum Durchführen des Accessibility-Tests
async function runAccessibilityTest(url) {
  const driver = await new Builder().forBrowser('chrome').build();

  try {
    await driver.get(url);

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
