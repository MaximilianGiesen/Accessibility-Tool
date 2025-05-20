// Proxy-Umgebungsvariablen deaktivieren
delete process.env.HTTP_PROXY;
delete process.env.http_proxy;
delete process.env.HTTPS_PROXY;
delete process.env.https_proxy;

// Import der Module
const {Builder} = require('selenium-webdriver');
const AxeBuilder = require('@axe-core/webdriverjs');
const fs = require('fs');
const urlModule = require('url');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const https = require('https');
const HttpsProxyAgent = require('https-proxy-agent').default;

// Konfiguration
const baseUrl = 'https://www.merci.de.stage.sto.adacor.net/de';
const visitedUrls = new Set();
const resultsDir = 'accessibility-results';
const useProxy = false; // Proxy aktivieren oder deaktivieren

// Basic Auth Konfiguration (für .htaccess-Schutz)
const auth = {
  enabled: true,
  username: 'xxx', // <-- hier ersetzen
  password: 'xxx'      // <-- hier ersetzen
};

// HTTP-Agent je nach Proxy-Nutzung
const agent = useProxy
  ? new HttpsProxyAgent('http://10.0.12.28:3128')
  : new https.Agent({secureProtocol: 'TLS_method'});

// Ergebnisverzeichnis erstellen
if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir);
}

// Globales Ergebnisobjekt
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

// Funktion zum Extrahieren von Links
async function getLinks(pageUrl) {
  const authConfig = auth.enabled ? {
    auth: {
      username: auth.username,
      password: auth.password
    }
  } : {};

  const {data} = await axios.get(pageUrl, {
    httpsAgent: agent,
    ...authConfig
  });

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
    // URL mit eingebetteten Auth-Daten, falls nötig
    let urlWithAuth = url;
    if (auth.enabled) {
      const parsed = new URL(url);
      parsed.username = auth.username;
      parsed.password = auth.password;
      urlWithAuth = parsed.toString();
    }

    await driver.get(urlWithAuth);

    const results = await new AxeBuilder(driver)
      .options({reporter: 'v2'})
      .withTags(['wcag2aa', 'wcag2a', 'bitv'])
      .analyze();

    let urlViolations = 0;
    let urlNodeViolations = 0;
    const urlViolationCounts = {};

    const processedViolations = results.violations.map(violation => {
      urlViolations++;
      urlNodeViolations += violation.nodes.length;

      urlViolationCounts[violation.id] = (urlViolationCounts[violation.id] || 0) + violation.nodes.length;

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

    const urlResult = {
      url,
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
  await runAccessibilityTest(url);

  const links = await getLinks(url);
  for (const link of links) {
    await runAccessibilityTest(link);
  }

  globalResults.totalUrls = visitedUrls.size;
  globalResults.crawledUrls = Array.from(visitedUrls);

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
