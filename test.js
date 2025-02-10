const { Builder } = require('selenium-webdriver');
const AxeBuilder = require('@axe-core/webdriverjs');
const fs = require('fs');
const urlModule = require('url');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const baseUrl = 'https://arag.de/';
const visitedUrls = new Set();
const resultsDir = 'accessibility-results'; // Verzeichnis für die Ergebnisse

// Erstelle das Ergebnisverzeichnis, falls es nicht existiert
if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir);
}

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

// Funktion zum Erstellen eines sicheren Dateinamens aus der URL
function createSafeFilename(url) {
  return url
    .replace(baseUrl, '')
    .replace(/[^a-z0-9]/gi, '_')
    .toLowerCase()
    .slice(0, 200); // Begrenzen der Länge
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

    // Zähle Verstöße und bestandene Prüfungen für diese URL
    let urlViolations = 0;
    let urlNodeViolations = 0;
    const urlViolationCounts = {};

    results.violations.forEach(violation => {
      urlViolations++;
      urlNodeViolations += violation.nodes.length;
      if (violation.id in urlViolationCounts) {
        urlViolationCounts[violation.id] += violation.nodes.length;
      } else {
        urlViolationCounts[violation.id] = violation.nodes.length;
      }
    });

    let urlPasses = 0;
    const urlPassCounts = {};

    results.passes.forEach(pass => {
      urlPasses++;
      if (pass.id in urlPassCounts) {
        urlPassCounts[pass.id] += pass.nodes.length;
      } else {
        urlPassCounts[pass.id] = pass.nodes.length;
      }
    });

    // Erstelle ein Ergebnisobjekt für diese URL
    const urlResults = {
      url: url,
      timestamp: new Date().toISOString(),
      summary: {
        totalViolations: urlViolations,
        totalNodeViolations: urlNodeViolations,
        violationCounts: urlViolationCounts,
        totalPasses: urlPasses,
        passCounts: urlPassCounts
      },
      details: {
        violations: results.violations,
        passes: results.passes
      }
    };

    // Speichere die Ergebnisse in einer separaten JSON-Datei
    const safeFilename = createSafeFilename(url);
    const filePath = path.join(resultsDir, `${safeFilename}.json`);
    fs.writeFileSync(filePath, JSON.stringify(urlResults, null, 2));

    console.log(`Die Ergebnisse für ${url} wurden in "${filePath}" gespeichert.`);

    return {
      violations: urlViolations,
      nodeViolations: urlNodeViolations,
      passes: urlPasses
    };
  } finally {
    await driver.quit();
  }
}

// Crawling und Tests durchführen
async function crawlAndTest(url) {
  let totalStats = {
    violations: 0,
    nodeViolations: 0,
    passes: 0
  };

  // Teste zuerst die Start-URL
  const startResults = await runAccessibilityTest(url);
  totalStats.violations += startResults.violations;
  totalStats.nodeViolations += startResults.nodeViolations;
  totalStats.passes += startResults.passes;

  // Hole dann alle Links und teste diese
  const links = await getLinks(url);
  for (const link of links) {
    const results = await runAccessibilityTest(link);
    totalStats.violations += results.violations;
    totalStats.nodeViolations += results.nodeViolations;
    totalStats.passes += results.passes;
  }

  // Speichere eine Zusammenfassung
  const summary = {
    timestamp: new Date().toISOString(),
    baseUrl: baseUrl,
    totalUrls: visitedUrls.size,
    statistics: totalStats,
    crawledUrls: Array.from(visitedUrls)
  };

  fs.writeFileSync(
    path.join(resultsDir, 'crawl-summary.json'),
    JSON.stringify(summary, null, 2)
  );

  console.log('\nCrawling und Tests abgeschlossen:');
  console.log(`Getestete URLs: ${visitedUrls.size}`);
  console.log(`Gesamtanzahl Verstöße: ${totalStats.violations}`);
  console.log(`Gesamtanzahl betroffener Knoten: ${totalStats.nodeViolations}`);
  console.log(`Gesamtanzahl bestandener Prüfungen: ${totalStats.passes}`);
  console.log(`\nAlle Ergebnisse wurden im Verzeichnis "${resultsDir}" gespeichert.`);
}

// Starte den Crawl mit der Basis-URL
visitedUrls.add(baseUrl);
crawlAndTest(baseUrl).catch(console.error);
