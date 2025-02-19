const { Builder, By, until } = require('selenium-webdriver');
const AxeBuilder = require('@axe-core/webdriverjs');
const fs = require('fs');

const baseUrl = 'https://www.arag-partner.de';
const postcodes = ["10115", "20095", "60311", "50667", "70173", "80331", "01067", "04109", "28195", "99084"];
const visitedUrls = new Set();
const allResults = []; // Array für alle Ergebnisse
const violationCounts = {}; // Zähler für Verstöße
const passCounts = {}; // Zähler für bestandene Tests
let totalViolations = 0; // Gesamte Anzahl an Verstößen
let totalNodeViolations = 0; // Gesamte Anzahl an betroffenen Knoten
let totalPasses = 0; // Gesamte Anzahl bestandener Tests

async function runAccessibilityTest(driver, url) {
  const results = await new AxeBuilder(driver)
    .options({ reporter: "v2" })
    .withTags(['wcag2aa', 'wcag2a', 'bitv'])
    .analyze();

  // Ergebnisse speichern
  allResults.push({
    url: url,
    violations: results.violations,
    passes: results.passes
  });

  // Verstöße zählen
  results.violations.forEach(violation => {
    totalViolations++;
    totalNodeViolations += violation.nodes.length;
    if (violation.id in violationCounts) {
      violationCounts[violation.id] += violation.nodes.length;
    } else {
      violationCounts[violation.id] = violation.nodes.length;
    }
  });

  // Bestandene Prüfschritte zählen
  results.passes.forEach(pass => {
    totalPasses++;
    if (pass.id in passCounts) {
      passCounts[pass.id] += pass.nodes.length;
    } else {
      passCounts[pass.id] = pass.nodes.length;
    }
  });

  console.log(`Accessibility-Check abgeschlossen für ${url}`);
}

async function acceptCookies(driver) {
  try {
    const shadowRoot = await getShadowRootElement(driver, '#usercentrics-root');
    const acceptButton = await shadowRoot.findElement(By.css('[data-testid="uc-accept-all-button"]')).catch(() => null);
    if (acceptButton) {
      await driver.executeScript("arguments[0].scrollIntoView(true);", acceptButton);
      await driver.wait(until.elementIsVisible(acceptButton), 5000);
      await acceptButton.click();
      console.log('Cookies akzeptiert.');
    } else {
      console.log('Kein Cookie-Banner gefunden.');
    }
  } catch (error) {
    console.log('Kein Cookie-Banner gefunden oder Fehler beim Akzeptieren:', error.message);
  }
}

async function getShadowRootElement(driver, cssSelector) {
  const rootElement = await driver.findElement(By.css(cssSelector));
  const shadowRoot = await driver.executeScript('return arguments[0].shadowRoot', rootElement);
  return shadowRoot;
}

async function testPostcode(driver, postcode) {
  await driver.get(baseUrl);

  try {
    await driver.wait(until.elementLocated(By.css('#usercentrics-root')), 10000);
    await acceptCookies(driver);
  } catch (error) {
    console.error("Kein Cookie-Banner gefunden oder Fehler beim Akzeptieren:", error);
  }

  await driver.findElement(By.name('query')).sendKeys(postcode);
  await driver.findElement(By.css('button')).click();
  await driver.sleep(2000);

  const currentUrl = await driver.getCurrentUrl();
  if (!visitedUrls.has(currentUrl)) {
    visitedUrls.add(currentUrl);
    await runAccessibilityTest(driver, currentUrl);
  }
}

(async function main() {
  const driver = await new Builder().forBrowser('chrome').build();

  try {
    for (const postcode of postcodes) {
      await testPostcode(driver, postcode);
    }

    // Ergebnisse in JSON-Datei speichern
    const filename = 'all-axe-results-partner.json';
    const output = {
      totalViolations: totalViolations,
      totalNodeViolations: totalNodeViolations,
      totalPasses: totalPasses,
      violationCounts: violationCounts,
      passCounts: passCounts,
      results: allResults
    };
    fs.writeFileSync(`${__dirname}/${filename}`, JSON.stringify(output, null, 2));
    console.log(`Alle Ergebnisse wurden in "${filename}" gespeichert.`);
  } finally {
    await driver.quit();
  }
})();
