// Import Module
const { Builder } = require('selenium-webdriver');
const AxeBuilder = require('@axe-core/webdriverjs');
const fs = require('fs');
const urlModule = require('url');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const https = require('https');

// Konfiguration
const baseUrl = 'https://www.denkwerk.com/';
const visitedUrls = new Set();
const resultsDir = 'accessibility-results';

// HTTPS-Agent (ohne Proxy, ohne Env-Variablen)
const httpsAgent = new https.Agent({ keepAlive: true });

if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir);
}

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

// Extrahieren der Links
async function getLinks(pageUrl) {
  const { data } = await axios.get(pageUrl, {
    httpsAgent,
    proxy: false // sicherstellen, dass kein Proxy verwendet wird
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

// Accessibility-Tests
async function runAccessibilityTest(url) {
  const driver = await new Builder().forBrowser('chrome').build();

  try {
    await driver.get(url);

    const results = await new AxeBuilder(driver)
      .options({ reporter: 'v2' })
      .withTags(['wcag2aa', 'wcag2a'])
      .analyze();

    let urlViolations = 0;
    let urlNodeViolations = 0;
    const urlViolationCounts = {};

    const processedViolations = results.violations.map(violation => {
      urlViolations++;
      urlNodeViolations += violation.nodes.length;

      urlViolationCounts[violation.id] =
        (urlViolationCounts[violation.id] || 0) + violation.nodes.length;

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

// Crawling und Tests
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

// Crawl mit der Basis-URL
visitedUrls.add(baseUrl);
crawlAndTest(baseUrl).catch(console.error);
