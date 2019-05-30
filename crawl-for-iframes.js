"use strict";


const crawlerConfig = Object.freeze({
  recursionDepth: 1, // probably reduce maxSubPages if you increase this!
  maxSubPages: 99, // 100 total, including homepage of site
  scriptTimeout: 20000, // ms
  pageTimeout: 20000, // ms
  sitesListFilePath: require('process').argv[2],
  outputDirPath: "output",
});

const browserConfig = Object.freeze({
  logLevel: 'error',
  path: '/',
  capabilities: {
    browserName: 'firefox',
    'moz:firefoxOptions': {
      args: ['-headless'],  // Comment out this line to see the browser!
    },
  }
});


const { remote } = require('webdriverio');
const fs = require('fs');
const fsPromises = require('fs').promises;
const readline = require('readline');
const process = require('process');


/**
 * This function is copied to, and run in, the window of each webpage we're
 * interested in.  It gathers all the data that we need in one go before
 * returning it via a JSON object.  Doing it this way rather than by using
 * the normal WebDriver document object API calls means that we avoid a lot of
 * IPC traffic, which should be faster.
 */
function gatherPageInfo(getLinks, maxLinkCount) {
  function isSameishHostname(homepageHostname, otherHostname) {
    if (homepageHostname == otherHostname) {
      return true;
    }
    return otherHostname.endsWith("." + homepageHostname.replace(/^www\./, ""));
  }

  function toURL(url) {
    try {
      url = new URL(url);
    } catch (e) {
      // not actually a valid URL
      return null;
    }
    return url;
  }

  function toURLWithoutHash(url) {
    url = toURL(url);
    if (url) {
      url.hash = "";
    }
    return url;
  }

  function getURLForEmbeddingElement(elem) {
    let url = toURL(elem.localName == "object" ? elem.data : elem.src);
    if (!url) {
      return "";
    }
    let prefix = "";
    if (getComputedStyle(elem).display == "none") {
      prefix = "hidden-by-display:";
    } else {
      let bounds = elem.getBoundingClientRect();
      if (bounds.width <= 1 || bounds.height <= 1) {
        prefix = "hidden-by-size:";
      }
    }
    return prefix + url.href;
  }

  function getURLForLink(elem) {
    // We want unique documents, so we ignore any hash in the links
    let url = toURLWithoutHash(elem.href);
    if (!url || (url.protocol != "http:" && url.protocol != "https:")) {
      return ""; // ignore this link
    }
    return url.href;
  }

  function deduplicate(array) {
    return [...new Set(array)]
  }

  const docHostname = document.location.hostname;
  const docURL = document.location.href;

  if (document.readyState == "loading") {
    // If we didn't even reach the "interactive" stage, don't even try to look
    // at the content.
    return JSON.stringify({
      href: "skipping-timeout:" + docURL,
      frames: [],
      links: [],
    });
  }

  const loadStatusPrefix =
    (document.readyState == "complete") ? "" : "incomplete:";

  let frameURLs =
    deduplicate([...document.querySelectorAll("iframe, embed, object")]
                    .map(getURLForEmbeddingElement)
                    .filter(url => !!url));

  let links = [];

  if (getLinks) {
    links =
      deduplicate([...document.links]
                      // only want to crawl site-internal links:
                      .filter(elem => isSameishHostname(docHostname, elem.hostname))
                      .map(getURLForLink)
                      .filter(url => !!url && url != toURLWithoutHash(docURL).href));
    // Limit the number of pages we crawl:
    while (links.length > maxLinkCount) {
      let randomIndex = Math.round(Math.random() * (links.length - 1));
      links.splice(randomIndex, 1); // Remove random link
    }
  }
  
  return JSON.stringify({
    href: loadStatusPrefix + document.location.href,
    frames: frameURLs,
    links: links,
  });
}


let sitesCSVFile = null; // list of sites to crawl
let outputFile = null; // file to output crawl results to
let browser = null;
let processInterupted = false; // user sent SIGINT (^C)


async function cleanup(code) {
  if (browser) {
    // Ensure that we close the WebDriver session otherwise we won't be able
    // to rerun this script without restarting the geckodriver process first:
    await browser.deleteSession();
  }
  if (outputFile) {
    await outputFile.close();
  }
  if (sitesCSVFile) {
    await sitesCSVFile.close();
  }
}


process.once('SIGINT', async (code) => {
  processInterupted = true;
  await cleanup(code);
});


async function createOutputFile() {
  await fsPromises.mkdir(crawlerConfig.outputDirPath, { recursive: true }); // ensure exists

  const dateTime = 
    new Date().toISOString().replace(/T/, '--').replace(/:/g, '-').replace(/\..+/, '');

  return fsPromises.open(crawlerConfig.outputDirPath + "/crawl--" + dateTime + ".txt", 'w');
}


async function recreateBrowser() {
  if (browser) {
    try {
      await browser.deleteSession();
    } catch (e) {
      // Ignore "no session" errors
    }
  }
  browser = await remote(browserConfig);
  await browser.setTimeouts(crawlerConfig.scriptTimeout,
                            crawlerConfig.pageTimeout,
                            undefined);
}


async function handleException(e, pageURL, outputFile, recursionLevelsLeft) {
  if (e.message.indexOf("Timeout loading page after ") != -1) {
    // We just ignore timeouts and continue on to examine the page,
    // even though it's still loading.  (The log output will have
    // "incomplete:" added to the start of the output URL.)
  } else {
    // Skip this page for any other errors.
    // Browser crashed
    // "Request failed due to insecure certificate"
    // "Reached error page"
    // redirect loops
    // etc.
    let crashed =
      // Browser crashed:
      e.message.indexOf("Tried to run command without establishing a connection") != -1 ||
      // Content process crashed:
      e.message.indexOf("Browsing context has been discarded") != -1;
    let logSummary = crashed ? "skipping crashed page" : "skipping page";
    let outPrefix = crashed ? "skipping-crashed:" : "skipping-error:";
    let recursionLevel = crawlerConfig.recursionDepth - recursionLevelsLeft;
    console.log(`Error: ${logSummary} (level: ${recursionLevel}): ${pageURL} (${e.message})`);
    await fsPromises.writeFile(outputFile, outPrefix + pageURL + "\n");

    if (crashed) {
      await recreateBrowser();
    }
    return "skip";
  }
}


async function processPage(pageURL, outputFile, recursionLevelsLeft) {
  if (processInterupted) {
    return; // got SIGINT
  }

  try {
    await browser.navigateTo(pageURL);
  } catch(e) {
    if (await handleException(e, pageURL, outputFile, recursionLevelsLeft) == "skip") {
      return;
    }
  }

  let result;
  try {
    result = JSON.parse(await browser.execute(gatherPageInfo, /*getLinks*/ recursionLevelsLeft > 0, crawlerConfig.maxSubPages));
  } catch(e) {
    if (await handleException(e, pageURL, outputFile, recursionLevelsLeft) == "skip") {
      return;
    }
  }

  await fsPromises.writeFile(outputFile, result.href + "\n");

  if (result.frames.length > 0) {
    for (let frameURL of result.frames) {
      await fsPromises.writeFile(outputFile, "  " + frameURL + "\n");
    }
  }

  if (recursionLevelsLeft > 0) {
    for (let linkURL of result.links) {
      await processPage(linkURL, outputFile, recursionLevelsLeft - 1);
    }
  }
}


async function main() {
  outputFile = await createOutputFile();

  await recreateBrowser();

  sitesCSVFile = readline.createInterface({
    input: fs.createReadStream(crawlerConfig.sitesListFilePath),
    terminal: false,
    crlfDelay: Infinity // allow any line ending types
  });

  for await (let line of sitesCSVFile) {
    let site = line.substr(line.indexOf(',') + 1);
    let siteURL = "http://" + site + "/";

    // Some pages redirect to other websites.  By having this separate "site:"
    // line in the output it makes in easy to tell when the output of the
    // crawl for a new site begins and what its original hostname was.
    await fsPromises.writeFile(outputFile, "site:" + site + "\n");

    await processPage(siteURL, outputFile, crawlerConfig.recursionDepth);

    // To keep memory use from running away, close the browser and start a new
    // instance:
    await recreateBrowser();
  }
}


main().catch(async (e) => {
  console.error(e);
}).finally(cleanup);

